// Test-only: a tiny HTTP server that speaks the sessions API of the agent-manager daemon (Phase 2) on a free loopback port, and writes the files a real
// daemon leaves in its config folder (config.port, health_token). No claude, no real daemon: the sessions are the ones the test puts in `sessions`.
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OwnedSessionView, PendingPermission } from '@wadeck-app/agent-manager-core/launch';

export interface FakeRequest {
  method: string;
  path: string;
  body: unknown;
  headers: IncomingMessage['headers'];
}

export interface FakeDaemon {
  readonly port: number;
  readonly token: string;
  sessions: OwnedSessionView[];
  permissions: Record<string, PendingPermission[]>;
  /** Every API request received (the /version discovery calls are not listed). */
  requests: FakeRequest[];
  /** Makes the next requests of this `METHOD /path` answer this HTTP status with a daemon error body (until cleared). */
  fail: Map<string, { status: number; code: string; reason: string; fix: string }>;
  /** `METHOD /path` keys whose request is received and never answered (a timeout for the caller). */
  hang: Set<string>;
  /** `METHOD /path` keys whose connection is destroyed after the request was received (a lost connection). */
  reset: Set<string>;
  /** When set, POST /sessions/:id/switch answers this body (a malformed one, to test the module). Default: the session on the other host. */
  switchAnswer?: unknown;
  /** When set, every `GET /sessions` after this many answered ones fails with HTTP 500 (a daemon that goes away in the middle of one request). */
  failListAfter?: number;
  /** Writes config.port and health_token (done at start; a test calls it again after a stop to simulate a restart). */
  publish(): void;
  /** Stops listening and leaves config.port in place (a daemon that died without cleaning up). */
  stop(): Promise<void>;
  /** Stops listening and removes the files (a clean stop). */
  stopCleanly(): Promise<void>;
}

export function ownedView(over: Partial<OwnedSessionView> & { id: string }): OwnedSessionView {
  return {
    hostKind: 'stream-json',
    cwd: '/work/shop',
    claudeVersion: '2.1.326',
    startedAt: 1_000_000,
    status: 'live',
    state: 'idle',
    resumable: false,
    pendingPermissions: 0,
    messages: [],
    pid: 4242,
    ...over,
  };
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

const error = (res: ServerResponse, status: number, code: string, reason = code, fix = 'fix it'): void => reply(res, status, { error: { code, reason, fix } });

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? undefined : JSON.parse(text);
}

export async function startFakeDaemon(configDir: string, options: { token?: string } = {}): Promise<FakeDaemon> {
  const token = options.token ?? 'fake-token-0123456789abcdef';
  const daemon: FakeDaemon = {
    port: 0,
    token,
    sessions: [],
    permissions: {},
    requests: [],
    fail: new Map(),
    hang: new Set(),
    reset: new Set(),
    publish() {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'config.port'), JSON.stringify({ sdkVersion: 1, port: daemon.port, pid: process.pid, startedAt: new Date().toISOString() }));
      writeFileSync(join(configDir, 'health_token'), token);
    },
    stop: () => closeServer(),
    async stopCleanly() {
      await closeServer();
      rmSync(join(configDir, 'config.port'), { force: true });
      rmSync(join(configDir, 'health_token'), { force: true });
    },
  };
  let counter = 0;
  let listCalls = 0;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (method === 'GET' && path === '/version') {
      reply(res, 200, { apiPort: daemon.port, version: '0.0.0-fake', pid: process.pid, port: daemon.port });
      return;
    }
    const body = await readBody(req);
    daemon.requests.push({ method, path, body, headers: req.headers });
    if (req.headers.origin !== undefined) {
      error(res, 403, 'bad-origin', 'the request carries an Origin header');
      return;
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      error(res, 401, 'unauthorized', 'a valid bearer token is required', 'send the token');
      return;
    }
    if (daemon.hang.has(`${method} ${path}`)) {
      return;
    }
    if (daemon.reset.has(`${method} ${path}`)) {
      req.socket.destroy();
      return;
    }
    if (method === 'GET' && path === '/sessions' && daemon.failListAfter !== undefined && listCalls++ >= daemon.failListAfter) {
      error(res, 500, 'internal', 'the daemon failed');
      return;
    }
    const injected = daemon.fail.get(`${method} ${path}`);
    if (injected !== undefined) {
      error(res, injected.status, injected.code, injected.reason, injected.fix);
      return;
    }
    const parts = path.split('/').filter((part) => part !== '');
    if (method === 'GET' && path === '/status') {
      const owned = { total: daemon.sessions.length, live: daemon.sessions.filter((s) => s.status === 'live').length, idle: 0, running: 0, requiresAction: 0, exited: 0, interrupted: 0, unobserved: 0 };
      reply(res, 200, { pid: process.pid, startedAt: 1, uptimeMs: 2, owned, leftovers: 0, stopping: false, version: '0.0.0-fake', port: daemon.port, apiPort: daemon.port, configDir });
      return;
    }
    if (parts[0] !== 'sessions') {
      error(res, 404, 'not-found');
      return;
    }
    if (parts.length === 1 && method === 'GET') {
      reply(res, 200, { sessions: daemon.sessions });
      return;
    }
    if (parts[1] === 'launch' && method === 'POST') {
      counter += 1;
      const request = body as { hostKind: OwnedSessionView['hostKind']; cwd: string; name?: string; model?: string; permissionMode?: string; forkOf?: string; resumeSessionAt?: string; forkedAtQuote?: string };
      const session = ownedView({ id: `00000000-0000-4000-8000-${String(900 + counter).padStart(12, '0')}`, hostKind: request.hostKind, cwd: request.cwd, ...(request.name === undefined ? {} : { name: request.name }), ...(request.model === undefined ? {} : { model: request.model }), ...(request.permissionMode === undefined ? {} : { permissionMode: request.permissionMode }), ...(request.forkOf === undefined ? {} : { forkedFrom: request.forkOf }), ...(request.resumeSessionAt === undefined ? {} : { forkedAtMessage: request.resumeSessionAt }), ...(request.forkedAtQuote === undefined ? {} : { forkedAtQuote: request.forkedAtQuote }) });
      daemon.sessions.unshift(session);
      reply(res, 201, { session });
      return;
    }
    const id = parts[1] ?? '';
    const session = daemon.sessions.find((candidate) => candidate.id === id);
    if (session === undefined) {
      error(res, 404, 'unknown-session', `no owned session ${id}`, 'refresh the list');
      return;
    }
    const action = parts[2];
    if (parts.length === 2 && method === 'GET') {
      reply(res, 200, { session });
    } else if (action === 'permissions' && parts.length === 3 && method === 'GET') {
      reply(res, 200, { permissions: daemon.permissions[id] ?? [] });
    } else if (action === 'permissions' && parts.length === 4 && method === 'POST') {
      const pending = daemon.permissions[id] ?? [];
      if (!pending.some((request) => request.requestId === parts[3])) {
        error(res, 404, 'unknown-permission-request', 'no such request', 'refresh');
        return;
      }
      daemon.permissions[id] = pending.filter((request) => request.requestId !== parts[3]);
      reply(res, 200, { requestId: parts[3], decision: (body as { decision: 'allow' | 'deny' }).decision });
    } else if (action === 'send' && method === 'POST') {
      counter += 1;
      const uuid = `msg-${counter}`;
      session.messages.push({ uuid, state: 'queued', at: Date.now() });
      reply(res, 200, { uuid, state: 'queued' });
    } else if (action === 'interrupt' && method === 'POST') {
      reply(res, 200, { stillQueued: [], cancelled: [] });
    } else if (action === 'permission-mode' && method === 'POST') {
      reply(res, 200, { mode: (body as { mode: string }).mode });
    } else if (action === 'stop' && method === 'POST') {
      session.status = 'exited';
      session.state = 'exited';
      reply(res, 200, { session });
    } else if (action === 'resume' && method === 'POST') {
      session.status = 'live';
      session.state = 'idle';
      reply(res, 200, { session });
    } else if (action === 'switch' && method === 'POST') {
      if (daemon.switchAnswer !== undefined) {
        reply(res, 200, daemon.switchAnswer);
        return;
      }
      const request = body as { target: OwnedSessionView['hostKind']; force?: boolean };
      const from = session.hostKind;
      session.hostKind = request.target;
      if (request.target === 'hc') {
        session.hcAddress = 't9';
        delete session.pid;
      } else {
        session.pid = 4343;
        delete session.hcAddress;
      }
      reply(res, 200, { session, from, to: request.target, forced: request.force === true, readiness: { state: 'free', reasons: [] }, notes: [] });
    } else if (action === 'forget' && method === 'POST') {
      daemon.sessions = daemon.sessions.filter((candidate) => candidate.id !== id);
      reply(res, 200, { id });
    } else {
      error(res, 404, 'not-found', `no route ${method} ${path}`);
    }
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((caught: unknown) => {
      error(res, 500, 'internal', String(caught));
    });
  });
  function closeServer(): Promise<void> {
    return new Promise((resolve) => {
      server.closeAllConnections();
      if (!server.listening) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  Object.assign(daemon, { port: (server.address() as { port: number }).port });
  daemon.publish();
  return daemon;
}
