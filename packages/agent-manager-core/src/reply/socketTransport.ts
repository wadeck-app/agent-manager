import { createHash } from 'node:crypto';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as realFs from 'node:fs/promises';
import { getErrorMessage } from '../errors.js';
import { isPidAlive } from '../pidAlive.js';
import type { Session } from '../session.js';
import { resolveSessionsDir } from '../sessionsDir.js';
import { ReplyError, assertSafeId } from './errors.js';
import { errorCode } from './fsTypes.js';
import type { ReplyFs } from './fsTypes.js';
import { wireMsgId } from './messageIds.js';
import { REPLY_PRIORITIES } from './types.js';
import type { ProbeCheck, ProbeContext, ProbeResult, ReplyMessage, ReplyTransport, SendResult } from './types.js';

/*
 * The inbox socket of Claude Code, reimplemented from the reference sender (w-agent-wake claude-inbox.js) and its contract test.
 * UNSTABLE: the protocol is private and the socket never answers. Documented by Claude Code: the socket path and the auth line only.
 * Observed: <pid>.<sha256 of the socket path, lower-cased on Windows>.key holds {"peerToken": 32 hex}; one JSON line per message.
 */

export const SOCKET_TRANSPORT_ID = 'socket';
export const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
/** The server never acknowledges: closing right after the write could cut the line, so the connection is kept briefly. */
export const DEFAULT_GRACE_MS = 300;
const TOKEN_FORMAT = /^[0-9a-f]{32}$/;

export interface SocketTransportOptions {
  /** Folder of the `<pid>.json` and `<pid>.<hash>.key` files. Default: AGENT_MANAGER_SESSIONS_DIR or ~/.claude/sessions, resolved at each call. */
  sessionsDir?: string;
  /** User settings read (never written) for `crossSessionInbound`. Default: ~/.claude/settings.json, resolved at each call. */
  settingsPath?: string;
  /** Default: process.platform. 'win32' makes the auth line mandatory. */
  platform?: NodeJS.Platform;
  connectTimeoutMs?: number;
  graceMs?: number;
  clock?: () => number;
  fs?: ReplyFs;
  /** Default: isPidAlive. */
  isAlive?: (pid: number) => boolean;
}

/** The JSON line of a user message (decision 37): the full frame. `msg_id` is a UUID (wireMsgId) so that Claude Code keeps it as `origin.msg_id` in the transcript. */
export function buildSocketFrame(input: { text: string; id: string; priority: string; sessionId: string }): string {
  assertSafeId('message id', input.id);
  if (typeof input.text !== 'string' || input.text.length === 0) {
    throw new ReplyError('empty-reply', 'the message text must be a non-empty string', 'type a text or attach an image');
  }
  if (!(REPLY_PRIORITIES as readonly string[]).includes(input.priority)) {
    throw new ReplyError('invalid-priority', `the priority must be one of ${REPLY_PRIORITIES.join(', ')}, got ${JSON.stringify(input.priority)}`, 'use now, next or later');
  }
  return JSON.stringify({ type: 'user', message: { role: 'user', content: input.text }, msgV: 1, msg_id: wireMsgId(input.id), priority: input.priority, session_id: input.sessionId });
}

/** `<pid>.<sha256(socket path)>.key`; the path is lower-cased on Windows (observed on 15 live sessions by the reference sender). */
export function tokenFileName(pid: number, socketPath: string, platform: NodeJS.Platform): string {
  const hashed = platform === 'win32' ? socketPath.toLowerCase() : socketPath;
  return `${pid}.${createHash('sha256').update(hashed).digest('hex')}.key`;
}

type TokenRead = { ok: true; token: string } | { ok: false; reason: 'missing' | 'unreadable' | 'malformed'; file: string };

/**
 * Reads the peer token of a session. The token is returned to the caller that writes the auth line and goes nowhere else: no log, no result, no
 * message. The parse error of JSON.parse is NOT passed on (it quotes a piece of the file).
 */
async function readPeerToken(fs: ReplyFs, sessionsDir: string, session: Session, socketPath: string, platform: NodeJS.Platform): Promise<TokenRead> {
  const file = tokenFileName(session.pid, socketPath, platform);
  let text: string;
  try {
    text = await fs.readFile(join(sessionsDir, file), 'utf8');
  } catch (error) {
    return { ok: false, reason: errorCode(error) === 'ENOENT' ? 'missing' : 'unreadable', file };
  }
  try {
    const token = (JSON.parse(text) as { peerToken?: unknown }).peerToken;
    if (typeof token === 'string' && TOKEN_FORMAT.test(token)) {
      return { ok: true, token };
    }
  } catch {
    // fall through: reported as malformed, without the content
  }
  return { ok: false, reason: 'malformed', file };
}

function tokenFix(file: string, sessionsDir: string): string {
  return `check that ${file} exists in ${sessionsDir} and holds {"peerToken": <32 hex characters>}; if the file has another name, Claude Code changed its naming rule: run the socket contract test of w-agent-wake and update tokenFileName`;
}

function connectFailure(path: string, error: unknown): ReplyError {
  const code = errorCode(error) ?? 'unknown';
  if (code === 'ENOENT' || code === 'ECONNREFUSED') {
    return new ReplyError('pipe-refused', `the session socket ${path} refused the connection (${code}): stale registry entry, the session probably ended`, 'refresh the session list; if the session is still open, restart it so that it registers a new socket');
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new ReplyError('pipe-denied', `the session socket ${path} denied access (${code})`, 'run agent-manager as the same user as the Claude Code session');
  }
  return new ReplyError('pipe-error', `cannot connect to the session socket ${path} (${code}: ${getErrorMessage(error)})`, 'check that the Claude Code session is still running, then retry');
}

type PipeAnswer = { ok: true } | { ok: false; error: ReplyError };

/** Connects and closes WITHOUT writing: proves the pipe accepts connections and nothing else. */
function probePipe(path: string, timeoutMs: number): Promise<PipeAnswer> {
  return new Promise((resolve) => {
    const socket = connect(path);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, error: new ReplyError('pipe-timeout', `no answer from the session socket ${path} within ${timeoutMs} ms`, 'the session may be frozen or its pid reused by another program; refresh the session list') });
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ ok: true });
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ ok: false, error: connectFailure(path, error) });
    });
  });
}

/** Connects, writes the payload, keeps the connection for `graceMs`. Resolves with whether the server closed the connection during the grace. */
function writePayload(path: string, payload: string, timeoutMs: number, graceMs: number): Promise<{ closedByServer: boolean }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let closedByServer = false;
    const socket = connect(path);
    const finish = (error?: ReplyError): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error === undefined) {
        resolve({ closedByServer });
      } else {
        reject(error);
      }
    };
    const timer = setTimeout(() => finish(new ReplyError('pipe-timeout', `timeout connecting to the session socket ${path} after ${timeoutMs} ms`, 'the session may be frozen or its pid reused by another program; refresh the session list')), timeoutMs);
    socket.once('close', () => {
      closedByServer = true;
    });
    socket.on('error', (error) => finish(connectFailure(path, error)));
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.write(payload, (error) => {
        if (error) {
          finish(connectFailure(path, error));
          return;
        }
        setTimeout(() => finish(), graceMs);
      });
    });
  });
}

type SettingsRead = { value?: string; note: string };

async function readCrossSessionInbound(fs: ReplyFs, settingsPath: string): Promise<SettingsRead> {
  let text: string;
  try {
    text = await fs.readFile(settingsPath, 'utf8');
  } catch (error) {
    return { note: errorCode(error) === 'ENOENT' ? `${settingsPath} does not exist` : `${settingsPath} cannot be read (${errorCode(error) ?? 'error'})` };
  }
  try {
    const value = (JSON.parse(text) as { crossSessionInbound?: unknown }).crossSessionInbound;
    if (typeof value === 'string') {
      return { value, note: `read from ${settingsPath}` };
    }
    return { note: value === undefined ? `crossSessionInbound is not set in ${settingsPath}` : `crossSessionInbound in ${settingsPath} is not a string` };
  } catch {
    return { note: `${settingsPath} is not valid JSON` };
  }
}

function isBypass(mode: string | undefined): boolean {
  return mode !== undefined && mode.toLowerCase().replace(/[-_ ]/g, '') === 'bypasspermissions';
}

/** The socket transport. Its paths are resolved at each call from the environment unless given. */
export function createSocketTransport(options: SocketTransportOptions = {}): ReplyTransport {
  const platform = (): NodeJS.Platform => options.platform ?? process.platform;
  const fs = options.fs ?? realFs;
  const clock = options.clock ?? Date.now;
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  const isAlive = options.isAlive ?? ((pid: number) => isPidAlive(pid));
  const sessionsDir = (): string => options.sessionsDir ?? resolveSessionsDir(process.env);
  const settingsPath = (): string => options.settingsPath ?? join(homedir(), '.claude', 'settings.json');

  async function probe(session: Session, context: ProbeContext = {}): Promise<ProbeResult> {
    const checks: ProbeCheck[] = [];
    const warnings: string[] = [];
    const details: Record<string, unknown> = { checks, warnings };
    const dir = sessionsDir();

    // crossSessionInbound: read-only, reported even when the transport is unavailable.
    const setting = await readCrossSessionInbound(fs, settingsPath());
    details['crossSessionInbound'] = setting.value ?? null;
    details['crossSessionInboundNote'] = setting.note;
    details['permissionMode'] = context.permissionMode ?? 'unknown (UNVERIFIED: the registry file does not expose it as far as known; the transcript does)';
    if (setting.value !== 'accept') {
      const shown = setting.value === undefined ? 'not set' : JSON.stringify(setting.value);
      if (isBypass(context.permissionMode)) {
        warnings.push(`the session runs in bypass-permissions and crossSessionInbound is ${shown}: Claude Code holds the message (measured), the reply will not be delivered. Set "crossSessionInbound": "accept" in ${settingsPath()}`);
      } else if (context.permissionMode === undefined) {
        warnings.push(`crossSessionInbound is ${shown} and the permission mode of the session is unknown (UNVERIFIED): if the session runs in bypass-permissions the reply is held. Only the user settings file is read; project and --settings layers are not (UNVERIFIED)`);
      }
    }

    const fail = (code: string, name: string, detail: string, reason: string, fix: string): ProbeResult => {
      checks.push({ name, ok: false, detail });
      details['code'] = code;
      return { available: false, reason, fix, details };
    };

    // 1. the registry entry is still there and is this session
    const registryFile = join(dir, session.file);
    let entrySessionId: unknown;
    try {
      entrySessionId = (JSON.parse(await fs.readFile(registryFile, 'utf8')) as { sessionId?: unknown }).sessionId;
    } catch (error) {
      const gone = errorCode(error) === 'ENOENT';
      return fail('stale-registry-entry', 'registry-entry', gone ? `${session.file} is gone` : `${session.file} is unreadable`, `the registry entry ${session.file} ${gone ? 'is gone' : 'cannot be read'}: the session probably ended`, 'refresh the session list; if the session is still open, restart it so that it registers again');
    }
    if (entrySessionId !== session.sessionId) {
      return fail('stale-registry-entry', 'registry-entry', `${session.file} now holds another session`, `the registry entry ${session.file} now belongs to another session`, 'refresh the session list');
    }
    checks.push({ name: 'registry-entry', ok: true, detail: `${session.file} present` });

    // 2. the process is alive
    let alive: boolean;
    try {
      alive = isAlive(session.pid);
    } catch (error) {
      return fail('pid-check-failed', 'pid-alive', getErrorMessage(error), `cannot check that pid ${session.pid} is alive (${getErrorMessage(error)})`, 'refresh the session list');
    }
    if (!alive) {
      return fail('pid-dead', 'pid-alive', `pid ${session.pid} is not running`, `the session process ${session.pid} is not running (stale registry entry)`, 'the session ended; start a new one, the entry disappears by itself');
    }
    checks.push({ name: 'pid-alive', ok: true, detail: `pid ${session.pid} running (pid-only check: a reused pid is not detected)` });

    // 3. the socket path
    const socketPath = session.messagingSocketPath;
    if (socketPath === undefined || socketPath === '') {
      return fail('no-socket-path', 'socket-path', 'the registry entry has no messagingSocketPath', 'the session publishes no inbox socket', 'Claude Code >= 2.1.224 is required for cross-session messaging: update Claude Code, then restart the session');
    }
    checks.push({ name: 'socket-path', ok: true, detail: socketPath });

    // 4. the token file (the token itself is never kept)
    const token = await readPeerToken(fs, dir, session, socketPath, platform());
    if (token.ok) {
      checks.push({ name: 'token-file', ok: true, detail: 'token file readable and well formed' });
    } else if (platform() === 'win32' || token.reason !== 'missing') {
      return fail('no-token-file', 'token-file', `${token.file} is ${token.reason}`, `no usable token file for this session (${token.file} is ${token.reason}); Windows refuses a connection without the auth line`, tokenFix(token.file, dir));
    } else {
      checks.push({ name: 'token-file', ok: true, detail: `${token.file} is missing; this platform does not need the auth line` });
    }

    // 5. the pipe accepts a connection (nothing is written)
    const pipe = await probePipe(socketPath, connectTimeoutMs);
    if (!pipe.ok) {
      return fail(pipe.error.code, 'pipe-connect', pipe.error.reason, pipe.error.reason, pipe.error.fix);
    }
    checks.push({ name: 'pipe-connect', ok: true, detail: 'connected and closed without writing' });

    return { available: true, reason: warnings.length === 0 ? 'the session socket accepts connections' : 'the session socket accepts connections, with warnings (see details.warnings)', fix: '', details };
  }

  async function send(session: Session, message: ReplyMessage): Promise<SendResult> {
    const socketPath = session.messagingSocketPath;
    if (socketPath === undefined || socketPath === '') {
      throw new ReplyError('no-socket-path', `the session ${session.sessionId} publishes no inbox socket`, 'Claude Code >= 2.1.224 is required for cross-session messaging: update Claude Code, then restart the session');
    }
    const frame = buildSocketFrame({ text: message.text, id: message.id, priority: message.priority, sessionId: session.sessionId });
    const dir = sessionsDir();
    const token = await readPeerToken(fs, dir, session, socketPath, platform());
    if (!token.ok && (platform() === 'win32' || token.reason !== 'missing')) {
      throw new ReplyError('no-token-file', `no usable token for session ${session.sessionId} (${token.file} is ${token.reason}); Windows refuses a connection without the auth line`, tokenFix(token.file, dir));
    }
    const lines = token.ok ? [JSON.stringify({ type: 'auth', token: token.token }), frame] : [frame];
    const payload = lines.map((line) => `${line}\n`).join('');
    const { closedByServer } = await writePayload(socketPath, payload, connectTimeoutMs, graceMs);
    return {
      accepted: true,
      detail: `written ${Buffer.byteLength(payload)} bytes to the session socket${closedByServer ? ' (the server closed the connection during the grace period: delivery is doubtful)' : ''}; the socket never acknowledges, delivery is not confirmed`,
      sentAt: clock(),
    };
  }

  return {
    id: SOCKET_TRANSPORT_ID,
    kind: 'direct',
    deliveredAs: 'peer',
    describe: () => 'Claude Code inbox socket (private protocol, no acknowledgement): wakes an idle session, no resident process',
    probe,
    send,
  };
}

/** The socket transport with default paths. */
export const socketTransport: ReplyTransport = createSocketTransport();
