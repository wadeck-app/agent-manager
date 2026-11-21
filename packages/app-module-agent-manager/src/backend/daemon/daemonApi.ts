import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultConfigDir, getErrorMessage } from '@wadeck-app/agent-manager-core';
import type { InterruptReceipt, MessageStatus, OwnedSessionView, OwnedState, PendingPermission } from '@wadeck-app/agent-manager-core/launch';
// violations-suppress: ts/no-deep-relative the module's own commons/ contract, one level above this subfolder
import type { DaemonStatusDto } from '../../commons/api.js';

/*
 * The client of the agent-manager daemon, for the module backend. It finds the daemon the way the CLI does (the same config folder resolution, the control port
 * of `config.port`, the token of `health_token`) and then talks to the sessions API over loopback with the bearer token:
 *   <config dir>/config.port    {"port": <control port>, "pid": ...}            written by singleton-daemon-kit while the daemon runs
 *   GET http://127.0.0.1:<control port>/version                                  no token: {"apiPort": ..., "version": ...}
 *   <config dir>/health_token   the bearer token of both servers
 *   <method> http://127.0.0.1:<apiPort>/sessions...                              Authorization: Bearer <token>
 * The CLI client (packages/agent-manager-cli/src/daemon/daemonClient.ts) uses singleton-daemon-kit for the control server only; it does not read the API port
 * (no CLI command talks to the sessions API yet), so there is nothing to move to core: this file is the first reader of `apiPort` and duplicates only the
 * 5 lines that read `config.port`. The shared types come from @wadeck-app/agent-manager-core/launch.
 * A token never appears in an error, a log or an answer.
 */

export const START_COMMAND = 'agent-manager start --detach';

const KNOWN_STATES: readonly string[] = ['idle', 'running', 'requires_action', 'exited', 'interrupted', 'unobserved'];
const KNOWN_MESSAGE_STATES: readonly string[] = ['queued', 'started', 'completed', 'cancelled', 'lost'];

/** A message of the daemon; a state this module does not know (a newer daemon) is 'unknown' with the raw value in `rawState`, never an exception. */
export type OwnedMessage = Omit<MessageStatus, 'state'> & { state: MessageStatus['state'] | 'unknown'; rawState?: string };

/** A session of the daemon as the module uses it: like OwnedSessionView, but a state it does not know is 'unknown' (raw value in `rawState`). */
export type OwnedView = Omit<OwnedSessionView, 'state' | 'messages'> & { state: OwnedState | 'unknown'; rawState?: string; messages: OwnedMessage[] };

/** Maps the states of an answer of the daemon to the ones this module knows; anything else stays visible as 'unknown'. */
export function normalizeView(view: OwnedSessionView): OwnedView {
  const state: string = view.state;
  const messages = Array.isArray(view.messages) ? view.messages : [];
  return {
    ...view,
    state: KNOWN_STATES.includes(state) ? view.state : 'unknown',
    ...(KNOWN_STATES.includes(state) ? {} : { rawState: String(state) }),
    messages: messages.map((message): OwnedMessage => {
      const raw: string = message.state;
      return KNOWN_MESSAGE_STATES.includes(raw) ? message : { ...message, state: 'unknown', rawState: String(raw) };
    }),
  };
}

/** What kind of trouble a call had; `code` and `fix` are what the user sees. */
export type DaemonErrorKind =
  /** Nobody listens: no config.port, or it names a daemon that is gone. */
  | 'not-running'
  /** Something listens but did not answer in time or answered nonsense. */
  | 'unreachable'
  /** The token is missing, unreadable or refused. */
  | 'unauthorized'
  /** The answer is not what this version of the module understands. */
  | 'bad-answer'
  /** The daemon understood and refused the call (a validation error, a state conflict): `status`, `code`, `reason` and `fix` are the daemon's own. */
  | 'rejected';

export class DaemonError extends Error {
  constructor(
    readonly kind: DaemonErrorKind,
    readonly code: string,
    readonly reason: string,
    readonly fix: string,
    /** The HTTP status of a 'rejected' call. */
    readonly status?: number,
    /** A write whose result is not known (timeout, lost connection, unreadable answer): the daemon may have done it. Never retry blindly. */
    readonly outcomeUnknown = false,
  ) {
    super(reason);
    this.name = 'DaemonError';
  }
}

export interface DaemonApi {
  status(): Promise<DaemonStatusDto>;
  /** The owned sessions, newest launch first. One daemon call per `cacheMs` (default 1.5 s) however many requests ask; a write drops the cache. */
  list(): Promise<OwnedView[]>;
  launch(body: Record<string, unknown>): Promise<OwnedView>;
  send(id: string, text: string): Promise<{ uuid: string; state: string }>;
  interrupt(id: string): Promise<InterruptReceipt>;
  setPermissionMode(id: string, mode: string): Promise<{ mode: string }>;
  stop(id: string): Promise<OwnedView>;
  resume(id: string, acknowledgeLeftover: boolean): Promise<OwnedView>;
  forget(id: string): Promise<{ id: string; supervisorNote?: string }>;
  permissions(id: string): Promise<PendingPermission[]>;
  decide(id: string, requestId: string, body: { decision: 'allow' | 'deny'; message?: string }): Promise<{ requestId: string; decision: 'allow' | 'deny' }>;
}

export interface DaemonApiOptions {
  /** Default: the config folder of this process (AGENT_MANAGER_CONFIG_DIR, XDG_CONFIG_HOME, ~/.config/agent-manager), resolved at every call. */
  configDir?: () => string;
  /** Default: global fetch. */
  fetch?: typeof fetch;
  /** Reads and short writes (send, interrupt, decisions). Default 4 s. */
  timeoutMs?: number;
  /** launch and resume start a claude process (its `initialize` took 4.5 s when measured). Default 30 s. */
  slowTimeoutMs?: number;
  /** Default 1500. */
  cacheMs?: number;
  clock?: () => number;
}

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_SLOW_TIMEOUT_MS = 30_000;
const DEFAULT_CACHE_MS = 1500;
const PORT_FILE = 'config.port';
/** Errors of a connection that was open and went away (undici names its own socket error). */
const RESET_CODES = ['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CLOSED'];
const TOKEN_FILE = 'health_token';

interface Endpoint {
  configDir: string;
  apiPort: number;
  token: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The Node error code of a failed fetch (undici puts it in `cause`), or 'TIMEOUT'. */
function networkCode(error: unknown): string {
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return 'TIMEOUT';
  }
  const cause: unknown = error instanceof Error ? error.cause : undefined;
  const code = isRecord(cause) ? cause['code'] : undefined;
  return typeof code === 'string' ? code : '';
}

const notRunning = (reason: string): DaemonError => new DaemonError('not-running', 'daemon-not-running', `the agent-manager daemon is not running: ${reason}`, `run \`${START_COMMAND}\` (it also replaces a daemon that died)`);

export function createDaemonApi(options: DaemonApiOptions = {}): DaemonApi {
  const configDirOf = options.configDir ?? ((): string => defaultConfigDir(process.env));
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const slowTimeoutMs = options.slowTimeoutMs ?? DEFAULT_SLOW_TIMEOUT_MS;
  const cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS;
  const clock = options.clock ?? Date.now;

  let endpoint: Endpoint | undefined;
  let discovering: Promise<Endpoint> | undefined;
  let listCache: { at: number; configDir: string; promise: Promise<OwnedView[]> } | undefined;

  async function readText(file: string): Promise<{ text: string } | { code: string; message: string }> {
    try {
      return { text: await readFile(file, 'utf8') };
    } catch (error) {
      return { code: (error as NodeJS.ErrnoException).code ?? '', message: getErrorMessage(error) };
    }
  }

  async function discover(configDir: string): Promise<Endpoint> {
    const portFile = join(configDir, PORT_FILE);
    const port = await readText(portFile);
    if ('code' in port) {
      if (port.code === 'ENOENT') {
        throw notRunning(`${portFile} does not exist (config folder ${configDir})`);
      }
      throw new DaemonError('unreachable', 'daemon-unreachable', `${portFile} cannot be read (${port.message})`, `check the permissions of ${configDir}, or run \`${START_COMMAND}\` after fixing them`);
    }
    let control: number | undefined;
    let pid: number | undefined;
    try {
      const parsed: unknown = JSON.parse(port.text);
      control = isRecord(parsed) && typeof parsed['port'] === 'number' ? parsed['port'] : undefined;
      pid = isRecord(parsed) && typeof parsed['pid'] === 'number' ? parsed['pid'] : undefined;
    } catch {
      control = undefined;
    }
    if (control === undefined || !Number.isInteger(control) || control < 1 || control > 65_535) {
      throw new DaemonError('unreachable', 'daemon-unreachable', `${portFile} is not a daemon port file (no valid "port")`, `delete ${portFile} and run \`${START_COMMAND}\``);
    }
    if (pid === undefined) {
      throw new DaemonError('unreachable', 'daemon-unreachable', `${portFile} has no "pid": it is not a daemon port file of this version`, `delete ${portFile} and run \`${START_COMMAND}\``);
    }
    let versionAnswer: unknown;
    try {
      const response = await doFetch(`http://127.0.0.1:${control}/version`, { signal: AbortSignal.timeout(timeoutMs) });
      versionAnswer = await response.json();
    } catch (error) {
      const code = networkCode(error);
      if (code === 'ECONNREFUSED') {
        throw notRunning(`${portFile} names port ${control}${pid === undefined ? '' : ` (pid ${pid})`} but nothing listens there: the daemon ended without removing it`);
      }
      throw new DaemonError('unreachable', 'daemon-unreachable', `the daemon control port ${control} did not answer (${code === 'TIMEOUT' ? `no answer in ${timeoutMs} ms` : getErrorMessage(error)})`, `if the daemon is stuck, end its process${pid === undefined ? '' : ` (pid ${pid})`} and run \`${START_COMMAND}\``);
    }
    // The token goes to the port that /version names: first check that the responder is the daemon the port file describes (the pid in both must agree).
    const answeredPid = isRecord(versionAnswer) ? versionAnswer['pid'] : undefined;
    if (answeredPid !== pid) {
      throw new DaemonError('unreachable', 'daemon-mismatch', `the process that answers on port ${control} is not the daemon of ${portFile} (its pid is ${JSON.stringify(answeredPid)}, the file says ${pid}): the token is not sent`, `if the daemon was replaced, run \`${START_COMMAND}\`; if another program uses port ${control}, free it or set AGENT_MANAGER_DAEMON_PORT`);
    }
    const apiPort = isRecord(versionAnswer) ? versionAnswer['apiPort'] : undefined;
    if (typeof apiPort !== 'number' || !Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65_535) {
      throw new DaemonError('bad-answer', 'daemon-bad-answer', `the daemon on port ${control} does not publish its sessions API port (GET /version has no apiPort): it is not this version of agent-manager`, 'update agent-manager (`agent-manager cli update`), stop the old daemon (`agent-manager stop`) and run `' + START_COMMAND + '`');
    }
    const tokenFile = join(configDir, TOKEN_FILE);
    const token = await readText(tokenFile);
    if ('code' in token) {
      throw new DaemonError('unauthorized', 'daemon-unauthorized', token.code === 'ENOENT' ? `${tokenFile} does not exist` : `${tokenFile} cannot be read (${token.message})`, `check the permissions of ${tokenFile}, or restart the daemon (\`agent-manager stop\`, then \`${START_COMMAND}\`)`);
    }
    if (token.text.trim() === '') {
      throw new DaemonError('unauthorized', 'daemon-unauthorized', `${tokenFile} is empty`, `restart the daemon (\`agent-manager stop\`, then \`${START_COMMAND}\`)`);
    }
    return { configDir, apiPort, token: token.text.trim() };
  }

  async function endpointFor(configDir: string): Promise<Endpoint> {
    if (endpoint !== undefined && endpoint.configDir === configDir) {
      return endpoint;
    }
    discovering ??= discover(configDir).finally(() => {
      discovering = undefined;
    });
    const found = await discovering;
    endpoint = found;
    return found;
  }

  /** One HTTP call. The endpoint is forgotten (and found again once) when the daemon went away or the token changed, so a restarted daemon is picked up. */
  async function call<T>(method: string, path: string, init: { body?: unknown; slow?: boolean } = {}): Promise<T> {
    const configDir = configDirOf();
    for (let attempt = 0; ; attempt += 1) {
      const target = await endpointFor(configDir);
      let response: Response;
      let text: string;
      try {
        response = await doFetch(`http://127.0.0.1:${target.apiPort}${path}`, {
          method,
          headers: { authorization: `Bearer ${target.token}`, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
          signal: AbortSignal.timeout(init.slow === true ? slowTimeoutMs : timeoutMs),
        });
        text = await response.text();
      } catch (error) {
        endpoint = undefined;
        const code = networkCode(error);
        // The daemon may have been restarted on other ports: find it again once. Refused = the request never arrived, so any call may be repeated; a reset or
        // closed connection (a pooled connection to the old daemon) may have cut a request that was handled, so only a read is repeated.
        if (attempt === 0 && (code === 'ECONNREFUSED' || (method === 'GET' && RESET_CODES.includes(code)))) {
          continue;
        }
        if (code === 'ECONNREFUSED') {
          throw notRunning(`its sessions API port ${target.apiPort} refuses connections`);
        }
        if (code === 'TIMEOUT') {
          // A timeout of a WRITE does not say that nothing happened (the daemon may have done it): say so.
          const limit = init.slow === true ? slowTimeoutMs : timeoutMs;
          throw new DaemonError('unreachable', 'daemon-unreachable', `the daemon did not answer ${method} ${path} within ${limit} ms${method === 'GET' ? '' : ' (it may still have done it: look at the session list before trying again)'}`, 'if it stays stuck, end the daemon process and run `' + START_COMMAND + '`', undefined, method !== 'GET');
        }
        const lost = method !== 'GET' && RESET_CODES.includes(code);
        throw new DaemonError('unreachable', 'daemon-unreachable', `the daemon call ${method} ${path} failed (${getErrorMessage(error)})${lost ? ' (the connection was lost: it may still have done it, look at the session list before trying again)' : ''}`, `check that the daemon runs (\`agent-manager status\`), or run \`${START_COMMAND}\``, undefined, lost);
      }
      let body: unknown;
      try {
        body = text === '' ? undefined : JSON.parse(text);
      } catch {
        throw new DaemonError('bad-answer', 'daemon-bad-answer', `the daemon answered ${method} ${path} with something that is not JSON (HTTP ${response.status})`, 'update agent-manager (`agent-manager cli update`) and restart the daemon', undefined, method !== 'GET');
      }
      if (response.ok) {
        return body as T;
      }
      const failure = isRecord(body) && isRecord(body['error']) ? body['error'] : undefined;
      const code = failure !== undefined && typeof failure['code'] === 'string' ? failure['code'] : `http-${response.status}`;
      const reason = failure !== undefined && typeof failure['reason'] === 'string' ? failure['reason'] : `the daemon answered HTTP ${response.status}`;
      const fix = failure !== undefined && typeof failure['fix'] === 'string' ? failure['fix'] : 'see the daemon log (`agent-manager status`)';
      if (response.status === 401 || response.status === 403) {
        endpoint = undefined;
        if (attempt === 0 && response.status === 401) {
          // The token file may have been rewritten by a restart: read it again once.
          continue;
        }
        throw new DaemonError('unauthorized', 'daemon-unauthorized', `the daemon refused this module (${reason})`, `restart the daemon (\`agent-manager stop\`, then \`${START_COMMAND}\`); ${fix}`);
      }
      throw new DaemonError('rejected', code, reason, fix, response.status);
    }
  }

  const enc = encodeURIComponent;
  const dropCache = (): void => {
    listCache = undefined;
  };
  /** A write: the cached list is stale whatever the result (a timeout may hide a success). */
  async function write<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } finally {
      dropCache();
    }
  }

  function arrayOf<T>(value: unknown, key: string, what: string): T[] {
    const list = isRecord(value) ? value[key] : undefined;
    if (!Array.isArray(list)) {
      throw new DaemonError('bad-answer', 'daemon-bad-answer', `the daemon answer for ${what} has no "${key}" list`, 'update agent-manager (`agent-manager cli update`) and restart the daemon');
    }
    return list as T[];
  }

  // The answer of a WRITE that does not have the expected shape: the daemon handled the request, so the result is unknown (never retried, said so).
  function badWriteAnswer(what: string, expected: string): DaemonError {
    return new DaemonError('bad-answer', 'daemon-bad-answer', `the daemon answer for ${what} is not ${expected}: the action may have been done, look at the session list before trying again`, 'update agent-manager (`agent-manager cli update`) and restart the daemon', undefined, true);
  }

  function sessionOf(value: unknown, what: string): OwnedView {
    const session = isRecord(value) ? value['session'] : undefined;
    if (!isRecord(session) || typeof session['id'] !== 'string') {
      throw badWriteAnswer(what, 'a {"session": ...}');
    }
    return normalizeView(session as unknown as OwnedSessionView);
  }

  const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

  return {
    async status() {
      const answer = await call<unknown>('GET', '/status');
      if (!isRecord(answer) || !isRecord(answer['owned'])) {
        throw new DaemonError('bad-answer', 'daemon-bad-answer', 'the daemon answer for GET /status has no "owned" counts', 'update agent-manager (`agent-manager cli update`) and restart the daemon');
      }
      return answer as unknown as DaemonStatusDto;
    },
    list() {
      const now = clock();
      const configDir = configDirOf();
      if (listCache !== undefined && listCache.configDir === configDir && now - listCache.at < cacheMs) {
        return listCache.promise;
      }
      // Failures are cached for the same short time: a daemon that does not answer must not make every poll wait for its timeout.
      const promise = call<unknown>('GET', '/sessions').then((answer) => arrayOf<OwnedSessionView>(answer, 'sessions', 'GET /sessions').map(normalizeView));
      listCache = { at: now, configDir, promise };
      promise.catch(() => undefined);
      return promise;
    },
    launch: (body) => write(async () => sessionOf(await call('POST', '/sessions/launch', { body, slow: true }), 'the launch')),
    send: (id, text) =>
      write(async () => {
        const answer = await call<unknown>('POST', `/sessions/${enc(id)}/send`, { body: { text } });
        if (!isRecord(answer) || typeof answer['uuid'] !== 'string' || typeof answer['state'] !== 'string') {
          throw badWriteAnswer('the send', '{"uuid", "state"}');
        }
        return { uuid: answer['uuid'], state: answer['state'] };
      }),
    interrupt: (id) =>
      write(async () => {
        const answer = await call<unknown>('POST', `/sessions/${enc(id)}/interrupt`);
        if (!isRecord(answer) || !isStrings(answer['stillQueued']) || (answer['cancelled'] !== undefined && !isStrings(answer['cancelled']))) {
          throw badWriteAnswer('the interrupt', '{"stillQueued": [...]}');
        }
        return { stillQueued: answer['stillQueued'], ...(answer['cancelled'] === undefined ? {} : { cancelled: answer['cancelled'] }) };
      }),
    setPermissionMode: (id, mode) =>
      write(async () => {
        const answer = await call<unknown>('POST', `/sessions/${enc(id)}/permission-mode`, { body: { mode } });
        if (!isRecord(answer) || typeof answer['mode'] !== 'string') {
          throw badWriteAnswer('the permission mode change', '{"mode"}');
        }
        return { mode: answer['mode'] };
      }),
    stop: (id) => write(async () => sessionOf(await call('POST', `/sessions/${enc(id)}/stop`, { slow: true }), 'the stop')),
    resume: (id, acknowledgeLeftover) => write(async () => sessionOf(await call('POST', `/sessions/${enc(id)}/resume`, { slow: true, ...(acknowledgeLeftover ? { body: { acknowledgeLeftover: true } } : {}) }), 'the resume')),
    forget: (id) =>
      write(async () => {
        const answer = await call<unknown>('POST', `/sessions/${enc(id)}/forget`);
        if (!isRecord(answer) || typeof answer['id'] !== 'string') {
          throw badWriteAnswer('the forget', '{"id"}');
        }
        const note = answer['supervisorNote'];
        return { id: answer['id'], ...(typeof note === 'string' ? { supervisorNote: note } : {}) };
      }),
    async permissions(id) {
      return arrayOf<PendingPermission>(await call<unknown>('GET', `/sessions/${enc(id)}/permissions`), 'permissions', 'the permission list');
    },
    decide: (id, requestId, body) =>
      write(async () => {
        const answer = await call<unknown>('POST', `/sessions/${enc(id)}/permissions/${enc(requestId)}`, { body });
        if (!isRecord(answer) || typeof answer['requestId'] !== 'string' || (answer['decision'] !== 'allow' && answer['decision'] !== 'deny')) {
          throw badWriteAnswer('the permission decision', '{"requestId", "decision"}');
        }
        return { requestId: answer['requestId'], decision: answer['decision'] };
      }),
  };
}
