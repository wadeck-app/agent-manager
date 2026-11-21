import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SessionHost } from '@wadeck-app/agent-manager-core/launch';
import type { HcLauncherLike, HostStatus, InitResult, SessionHostOptions } from '@wadeck-app/agent-manager-core/launch';
import { createDaemon } from '@wadeck-app/singleton-daemon-kit';
import type { ShutdownReason } from '@wadeck-app/singleton-daemon-kit';
import { getErrorMessage } from '../errors.js';
import { createApiServer } from './apiServer.js';
import type { ApiServer } from './apiServer.js';

/*
 * The daemon process: the session host (owned sessions, decision L1) behind two loopback servers that share one bearer token.
 *   control server  singleton-daemon-kit (port 47930 / AGENT_MANAGER_DAEMON_PORT): port file, startup lock, takeover, `GET /version` (no token),
 *                   `GET /health`, `POST /status`, `POST /shutdown`, `POST /quit` (token). The CLI commands start, status and stop use it.
 *   api server      an OS-chosen port, published as `apiPort` in `GET /version` and `POST /status`: the routes of the session host and the SSE stream.
 * Startup order: read owned-sessions.json (a corrupt file ends the start here, nothing listens yet) -> listen on the API port -> createDaemon (writes
 * health_token, then the port file) -> read the token into the API server. A request that comes in between gets 503.
 * Shutdown order: close every child (stdin, then kill after the close timeout) and write the file -> close the API server -> stop the control server.
 * A crash of the daemon runs none of this: the children end with their owner and the next start lists those sessions as interrupted.
 */

export interface DaemonRuntimeOptions {
  configDir: string;
  /** The control port; 0 = any free port (tests). */
  port: number;
  /** The API port; default 0 = any free port (published in /version). */
  apiPort?: number;
  version: string;
  /** Test seams, passed to the session host. Production passes none: `claude` and `hc` on the PATH. */
  claude?: SessionHostOptions['claude'];
  hcLauncher?: HcLauncherLike;
  closeTimeoutMs?: number;
  controlTimeoutMs?: number;
  maxLiveSessions?: number;
  /** Test seam: the period of the poll of `claude agents --json` while a bg session is live (default 5 s). */
  bgObserveIntervalMs?: number;
  sseHeartbeatMs?: number;
  maxSseClients?: number;
  maxSseBufferedBytes?: number;
  maxBodyBytes?: number;
  /** Test seam: reads the health_token file (a test makes it fail to prove the start is undone). Default: reads `<config folder>/health_token`. */
  readToken?: (path: string) => Promise<string>;
  /** Receives every warning and unexpected error of the daemon (the `start` command writes them to stderr). */
  log?: (text: string) => void;
}

export interface DaemonStatusPayload extends HostStatus {
  version: string;
  port: number;
  apiPort: number;
  configDir: string;
}

export interface DaemonRuntime {
  port: number;
  apiPort: number;
  pid: number;
  host: SessionHost;
  init: InitResult;
  /** Resolves with the reason once the daemon is fully stopped (children closed, servers closed). */
  done: Promise<ShutdownReason>;
  stop(reason?: ShutdownReason): Promise<void>;
}

export async function startDaemon(options: DaemonRuntimeOptions): Promise<DaemonRuntime> {
  const log = options.log ?? (() => undefined);
  // The control server writes health_token into this folder.
  await mkdir(options.configDir, { recursive: true });
  const host = new SessionHost({
    configDir: options.configDir,
    ...(options.claude === undefined ? {} : { claude: options.claude }),
    ...(options.hcLauncher === undefined ? {} : { hcLauncher: options.hcLauncher }),
    ...(options.closeTimeoutMs === undefined ? {} : { closeTimeoutMs: options.closeTimeoutMs }),
    ...(options.controlTimeoutMs === undefined ? {} : { controlTimeoutMs: options.controlTimeoutMs }),
    ...(options.maxLiveSessions === undefined ? {} : { maxLiveSessions: options.maxLiveSessions }),
    ...(options.bgObserveIntervalMs === undefined ? {} : { bgObserveIntervalMs: options.bgObserveIntervalMs }),
    onWarning: (text) => log(`warning: ${text}`),
  });
  // Read-only: a state file that cannot be read stops the start here (LaunchError with the path and the fix), before anything listens or takes the
  // place of a running daemon. The file is only REWRITTEN (init) once this process holds the singleton, below.
  await host.check();

  let token: string | undefined;
  let controlPort = 0;
  let apiPort = 0;
  const statusPayload = (): DaemonStatusPayload => ({ ...host.status(), version: options.version, port: controlPort, apiPort, configDir: options.configDir });
  const api: ApiServer = createApiServer({
    host,
    getToken: () => token,
    statusExtra: () => ({ version: options.version, port: controlPort, apiPort, configDir: options.configDir }),
    ...(options.sseHeartbeatMs === undefined ? {} : { sseHeartbeatMs: options.sseHeartbeatMs }),
    ...(options.maxBodyBytes === undefined ? {} : { maxBodyBytes: options.maxBodyBytes }),
    ...(options.maxSseClients === undefined ? {} : { maxSseClients: options.maxSseClients }),
    ...(options.maxSseBufferedBytes === undefined ? {} : { maxSseBufferedBytes: options.maxSseBufferedBytes }),
    onError: (text) => log(`error: ${text}`),
  });
  apiPort = await api.listen(options.apiPort ?? 0);

  let resolveDone: (reason: ShutdownReason) => void = () => undefined;
  let rejectDone: (error: unknown) => void = () => undefined;
  const done = new Promise<ShutdownReason>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  // Nobody may be waiting on `done` when a stop fails: the failure is logged below, and a caller that awaits still sees it.
  done.catch(() => undefined);

  // The ordered end, once: whoever asks first (stop(), the shutdown command, a signal or /quit through the kit) runs it, the others wait for it.
  let orderly: Promise<void> | undefined;
  const closeEverything = (): Promise<void> => {
    orderly ??= (async () => {
      const result = await host.shutdown();
      for (const failure of result.failed) {
        log(`error: the claude process of session ${failure.sessionId} did not end at shutdown: ${failure.reason}`);
      }
      await api.close();
    })();
    return orderly;
  };

  let handle: Awaited<ReturnType<typeof createDaemon>>;
  try {
    handle = await createDaemon({
      configDir: options.configDir,
      port: options.port,
      // The daemon stays up until stopped: an idle shutdown is a decision for a later phase (spec O-4).
      idleTimeout: null,
      appVersion: options.version,
      versionExtra: () => ({ apiPort }),
      health: () => ({ status: host.stopping ? 'degraded' : 'ok', apiPort }),
      commands: {
        status: () => statusPayload(),
        shutdown: () => {
          // The answer goes out first; the stop closes the connections.
          setImmediate(() => {
            void stop('command').catch((error: unknown) => log(`error: the shutdown failed (${getErrorMessage(error)})`));
          });
          return { stopping: true, live: host.status().owned.live };
        },
      },
      hooks: {
        onShutdown: (reason) => {
          closeEverything().then(
            () => resolveDone(reason),
            (error: unknown) => rejectDone(error),
          );
        },
        onCommandError: (name, error) => log(`error: command ${name} failed (${getErrorMessage(error)})`),
      },
    });
  } catch (error) {
    // The control server did not start (port range busy, startup lock): nothing was launched, the API server is closed again.
    await closeEverything();
    throw error;
  }
  controlPort = handle.port;
  let init: InitResult;
  try {
    // The singleton is held (createDaemon returned): only now may interrupted sessions be marked and the file rewritten. A racer that lost never gets here.
    init = await host.init();
    token = (await (options.readToken ?? ((path) => readFile(path, 'utf8')))(join(options.configDir, 'health_token'))).trim();
  } catch (error) {
    // The servers are up but the daemon cannot serve: take them down again, never leave a half-started daemon with a port file.
    await handle.stop('error').catch((stopError: unknown) => log(`error: could not stop the control server after a failed start (${getErrorMessage(stopError)})`));
    await closeEverything();
    throw error;
  }

  async function stop(reason: ShutdownReason = 'command'): Promise<void> {
    await closeEverything();
    await handle.stop(reason);
    await done;
  }

  return { port: controlPort, apiPort, pid: process.pid, host, init, done, stop };
}
