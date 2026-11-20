// agent-manager start | stop | status -- the daemon lifecycle. The daemon owns the sessions agent-manager launches (decision L1, see daemon/runtime.ts).
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { createControlClient, daemonCallError } from '../daemon/daemonClient.js';
import type { DaemonCommands } from '../daemon/daemonClient.js';
import { resolveDaemonPort } from '../daemon/daemonPort.js';
import { startDaemon } from '../daemon/runtime.js';
import type { DaemonRuntime, DaemonRuntimeOptions, DaemonStatusPayload } from '../daemon/runtime.js';
import type { Command, CommandOutput, Context } from '../command.js';
import { CliError, DaemonUnreachableError, getErrorMessage } from '../errors.js';
import { exitCodesOf } from '../exitCodes.js';
import { ownBundlePath } from '../ownBundle.js';
import { currentVersion } from '../version.js';

const DETACH_WAIT_MS = 20_000;
const STOP_WAIT_MS = 45_000;
const POLL_MS = 200;

/** A daemon started with --detach: its pid, and what happened to it if it ended. */
export interface DetachedChild {
  pid: number | undefined;
  /** Resolves when the process ends (code, or the signal), never rejects. */
  exited: Promise<{ code: number | null; signal: string | null }>;
}

export interface DaemonCommandDeps {
  startDaemon: (options: DaemonRuntimeOptions) => Promise<DaemonRuntime>;
  /** Starts `agent-manager start` as a detached, hidden process whose output goes to `logFile`. */
  spawnDetached: (options: { env: NodeJS.ProcessEnv; cwd: string; logFile: string }) => DetachedChild;
  detachWaitMs: number;
  stopWaitMs: number;
  pollMs: number;
  /** Extra options of the daemon runtime. Production passes none; tests pass the fake claude and short timeouts here. */
  runtimeExtras: () => Partial<DaemonRuntimeOptions>;
}

/** What spawnDetachedProcess uses from the system: replaced in the tests, which must not start a daemon. */
export interface SpawnSystem {
  openLog: (file: string) => number;
  closeLog: (fd: number) => void;
  spawn: typeof spawn;
  script: () => string;
}

const REAL_SYSTEM: SpawnSystem = { openLog: (file) => openSync(file, 'a'), closeLog: closeSync, spawn, script: ownBundlePath };

export function spawnDetachedProcess(options: { env: NodeJS.ProcessEnv; cwd: string; logFile: string }, system: SpawnSystem = REAL_SYSTEM): DetachedChild {
  mkdirSync(join(options.logFile, '..'), { recursive: true });
  const log = system.openLog(options.logFile);
  let child: ReturnType<typeof spawn>;
  try {
    // `process.execPath` is node; the script is this bundle (the Go launcher only starts node on it). Hidden window, no console, survives this process.
    child = system.spawn(process.execPath, [system.script(), 'start'], { detached: true, stdio: ['ignore', log, log], windowsHide: true, env: options.env, cwd: options.cwd, shell: false });
  } finally {
    // The child has its own copy of the descriptor: this process does not keep the log file open (a leak, and a lock on the file on Windows).
    system.closeLog(log);
  }
  child.unref();
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', () => resolve({ code: null, signal: 'spawn-error' }));
  });
  return { pid: child.pid, exited };
}

export const DEFAULT_DAEMON_DEPS: DaemonCommandDeps = {
  startDaemon,
  spawnDetached: spawnDetachedProcess,
  detachWaitMs: DETACH_WAIT_MS,
  stopWaitMs: STOP_WAIT_MS,
  pollMs: POLL_MS,
  runtimeExtras: () => ({}),
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 65 -> "1m 5s". */
export function formatUptime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const parts = [days > 0 ? `${days}d` : '', hours > 0 ? `${hours}h` : '', minutes > 0 ? `${minutes}m` : '', days === 0 && hours === 0 ? `${seconds}s` : ''].filter((part) => part !== '');
  return parts.join(' ');
}

export function statusLines(status: DaemonStatusPayload): string[] {
  const { owned } = status;
  return [
    `agent-manager daemon is running${status.stopping ? ' (stopping)' : ''}`,
    `  pid:             ${status.pid}`,
    `  port:            ${status.port} (control), ${status.apiPort} (sessions API and events)`,
    `  version:         ${status.version}`,
    `  uptime:          ${formatUptime(status.uptimeMs)}`,
    `  config folder:   ${status.configDir}`,
    `  owned sessions:  ${owned.total} (live ${owned.live}: idle ${owned.idle}, running ${owned.running}, waiting for a permission ${owned.requiresAction}; exited ${owned.exited}; interrupted ${owned.interrupted}; hc terminals ${owned.unobserved})`,
    ...(owned.interrupted > 0 ? [`  ${owned.interrupted} interrupted session(s): their claude ended with the previous daemon; resume them through the sessions API (POST /sessions/<id>/resume)`] : []),
    ...(status.leftovers > 0 ? [`  WARNING: ${status.leftovers} claude process(es) of an earlier daemon may still be alive (see the daemon log or 'GET /sessions': leftoverPid); end them by hand`] : []),
  ];
}

async function runningStatus(context: Context): Promise<DaemonStatusPayload> {
  try {
    return await createControlClient(context.configDir).send('status');
  } catch (error) {
    throw daemonCallError(error, context.configDir);
  }
}

function logFileOf(configDir: string): string {
  return join(configDir, 'logs', `daemon-${new Date().toISOString().slice(0, 10)}.log`);
}

export function createDaemonCommands(deps: DaemonCommandDeps = DEFAULT_DAEMON_DEPS): { start: Command; stop: Command; status: Command } {
  const start: Command = {
    name: 'start',
    summary: 'Start the daemon (it hosts the sessions agent-manager launches) in this terminal; with --detach in the background. Does nothing if it already runs',
    args: [],
    options: { detach: { type: 'boolean', description: 'Run it as a hidden background process (its output goes to <config folder>/logs/daemon-<day>.log)' } },
    exitCodes: exitCodesOf('start'),
    run: async (context): Promise<CommandOutput> => {
      const client = createControlClient(context.configDir);
      if (await client.isRunning()) {
        const status = await runningStatus(context);
        return { json: { ok: true, alreadyRunning: true, ...status }, lines: ['The daemon is already running; nothing was started (stop it first with: agent-manager stop).', ...statusLines(status)] };
      }
      const port = resolveDaemonPort(context.env);
      if (context.options.flag('detach')) {
        const logFile = logFileOf(context.configDir);
        const child = deps.spawnDetached({ env: context.env, cwd: context.cwd, logFile });
        const deadline = Date.now() + deps.detachWaitMs;
        let ended: { code: number | null; signal: string | null } | undefined;
        void child.exited.then((result) => {
          ended = result;
        });
        while (Date.now() < deadline) {
          if (ended !== undefined) {
            throw new CliError(`the daemon exited while starting (exit code ${String(ended.code)}${ended.signal === null ? '' : `, ${ended.signal}`}). Read ${logFile}, or run 'agent-manager start' in a terminal to see why (a port in use: set AGENT_MANAGER_DAEMON_PORT; an unreadable owned-sessions.json: fix or move it aside)`);
          }
          if (await client.isRunning()) {
            try {
              const status = await client.send('status');
              return { json: { ok: true, alreadyRunning: false, background: true, logFile, ...status }, lines: [`The daemon started in the background (pid ${status.pid}); its output goes to ${logFile}`, ...statusLines(status)] };
            } catch {
              // Listening but not answering yet: look again until the deadline.
            }
          }
          await sleep(deps.pollMs);
        }
        throw new CliError(`the daemon did not answer ${deps.detachWaitMs / 1000} s after it was started (pid ${child.pid ?? 'unknown'}). Read ${logFile}; if its process is stuck, end it, then retry`);
      }
      let runtime: DaemonRuntime;
      try {
        runtime = await deps.startDaemon({
          configDir: context.configDir,
          port,
          version: currentVersion(),
          log: (text) => context.io.err(text),
          ...deps.runtimeExtras(),
        });
      } catch (error) {
        throw startFailure(error, context.configDir, port);
      }
      const started = { event: 'started', pid: runtime.pid, port: runtime.port, apiPort: runtime.apiPort, configDir: context.configDir, version: currentVersion(), interrupted: runtime.init.interrupted.length, leftovers: runtime.init.leftovers.length };
      if (context.options.flag('json')) {
        context.io.out(JSON.stringify(started));
      } else {
        context.io.out(`agent-manager daemon started: pid ${runtime.pid}, control port ${runtime.port}, sessions API port ${runtime.apiPort}, config folder ${context.configDir}`);
        if (runtime.init.interrupted.length > 0) {
          context.io.out(`${runtime.init.interrupted.length} session(s) were live when the previous daemon ended: listed as interrupted (resume them through the sessions API; the lost turn is not replayed)`);
        }
        context.io.out("Stop it with 'agent-manager stop' (or Ctrl+C here): every owned claude process is closed first.");
      }
      const reason = await runtime.done;
      return { json: { event: 'stopped', reason }, lines: [`agent-manager daemon stopped (${reason})`] };
    },
  };

  const stop: Command = {
    name: 'stop',
    summary: 'Stop the daemon: it closes every claude process it owns (stdin first, killed after a timeout), writes its state, then exits. The sessions can be resumed after the next start',
    args: [],
    options: {},
    exitCodes: exitCodesOf('stop'),
    run: async (context): Promise<CommandOutput> => {
      const client = createControlClient(context.configDir);
      let answer: ReturnType<DaemonCommands['shutdown']>;
      let pid: number | undefined;
      try {
        pid = (await client.version()).pid;
        answer = await client.send('shutdown');
      } catch (error) {
        const failure = daemonCallError(error, context.configDir);
        if (failure instanceof DaemonUnreachableError) {
          return { json: { ok: true, wasRunning: false }, lines: [`The daemon is not running: nothing to stop (config folder ${context.configDir})`] };
        }
        throw failure;
      }
      const deadline = Date.now() + deps.stopWaitMs;
      while (Date.now() < deadline) {
        if (!(await client.isRunning())) {
          return {
            json: { ok: true, wasRunning: true, pid: pid ?? null, closedSessions: answer.live },
            lines: [`The daemon stopped (pid ${pid ?? 'unknown'}); ${answer.live} live session(s) were closed and can be resumed after the next start`],
          };
        }
        await sleep(deps.pollMs);
      }
      throw new CliError(
        `the daemon (pid ${pid ?? 'unknown'}) is still running ${deps.stopWaitMs / 1000} s after the stop request: a claude process it owns probably does not end. Fix: look at the daemon log in ${join(context.configDir, 'logs')} (run it in a terminal to see its output); end the pid ${pid ?? 'of the daemon'} and the claude processes it started by hand (task manager); agent-manager lists leftovers at the next start`,
      );
    },
  };

  const status: Command = {
    name: 'status',
    summary: 'Show the daemon: pid, ports, version, uptime and the owned sessions (exit 3 when it is not running)',
    args: [],
    options: {},
    exitCodes: exitCodesOf('status'),
    run: async (context): Promise<CommandOutput> => {
      const payload = await runningStatus(context);
      return { json: payload, lines: statusLines(payload) };
    },
  };

  return { start, stop, status };
}

/** A start that failed: the reason and what to do, for the ones that are known. */
function startFailure(error: unknown, configDir: string, port: number): CliError {
  const message = getErrorMessage(error);
  if (/EADDRINUSE|Could not bind/i.test(message)) {
    return new CliError(`the daemon cannot listen on port ${port} (${message}). Fix: free the port, or set AGENT_MANAGER_DAEMON_PORT to another one`);
  }
  return new CliError(`the daemon did not start (${message}); config folder ${configDir}`);
}

const commands = createDaemonCommands();
export const startCommand = commands.start;
export const stopCommand = commands.stop;
export const statusCommand = commands.status;
