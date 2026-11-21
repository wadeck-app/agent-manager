import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { LaunchError, parseDecisionBody, parseLaunchBody, parsePermissionModeBody, parseSendBody } from '@wadeck-app/agent-manager-core/launch';
import type { SessionHost } from '@wadeck-app/agent-manager-core/launch';
import { SAFE_ID } from '@wadeck-app/agent-manager-core/reply';
import { getErrorMessage } from '../errors.js';

/*
 * The session-host API: JSON over loopback, one bearer token (the `health_token` of the daemon) on every route. This server is separate from the
 * control server of singleton-daemon-kit (which only knows `POST /<command>`): that one carries status and shutdown, this one carries the sessions
 * and the event stream. Every request is checked in this order: Host header (loopback, this port) -> Origin / Sec-Fetch-Site (no cross-site page)
 * -> bearer token -> body size and type -> route. A token never appears in a response, a log or an error.
 */

export const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
export const DEFAULT_MAX_SSE_CLIENTS = 16;
export const DEFAULT_SSE_HEARTBEAT_MS = 15_000;
/** A client that lets this many bytes pile up in its connection is dropped: it reconnects with Last-Event-ID and replays. */
export const MAX_SSE_BUFFERED_BYTES = 1024 * 1024;

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

export interface ApiServerOptions {
  host: SessionHost;
  /** The token every request must carry; undefined while the daemon is still starting (every request is then refused with 503). */
  getToken: () => string | undefined;
  /** Extra fields of GET /status (ports, version, config dir). */
  statusExtra: () => Record<string, unknown>;
  maxBodyBytes?: number;
  maxSseClients?: number;
  sseHeartbeatMs?: number;
  /** A stream whose connection holds at least this many unsent bytes is dropped (0 drops it at its first write: tests only) (it reconnects with Last-Event-ID). Default MAX_SSE_BUFFERED_BYTES. */
  maxSseBufferedBytes?: number;
  /** Where unexpected errors go (a 500 never leaves the daemon silent). */
  onError?: (text: string) => void;
}

export interface ApiServer {
  listen(port: number): Promise<number>;
  close(): Promise<void>;
  readonly port: number;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly reason: string,
    readonly fix: string,
  ) {
    super(`${reason}. Fix: ${fix}`);
    this.name = 'HttpError';
  }
}

const CONFLICT = new Set([
  'not-owned',
  'session-not-live',
  'already-live',
  'session-live',
  'too-many-sessions',
  'too-many-threads',
  'session-list-full',
  'host-stopping',
  'leftover-alive',
  'duplicate-session',
  'permission-being-answered',
  'session-exited',
  'session-closing',
  'bg-action-in-progress',
]);
const NOT_FOUND = new Set(['unknown-session', 'unknown-permission-request', 'fork-source-not-found', 'fork-anchor-not-found']);
const VALIDATION = new Set([
  'invalid-body',
  'unknown-field',
  'invalid-field',
  'cwd-missing-field',
  'invalid-cwd',
  'cwd-not-absolute',
  'cwd-not-a-folder',
  'cwd-missing',
  'invalid-host-kind',
  'invalid-name',
  'text-too-long',
  'invalid-images',
  'invalid-image',
  'image-too-large',
  'mime-mismatch',
  'empty-message',
  'empty-deny-message',
  'invalid-decision',
  'invalid-permission-mode',
  'invalid-model',
  'invalid-session-id',
  'invalid-terminal-name',
  'invalid-argument',
  'force-refused',
  'invalid-id',
  'invalid-job-id',
  'invalid-fork-source',
  'fork-host-unsupported',
  'invalid-resume-session-at',
  'resume-at-without-fork',
  'invalid-quote',
  'quote-without-anchor',
]);
const SERVER_SIDE = new Set(['state-file-write-failed', 'state-file-unreadable', 'kill-failed', 'host-not-ready', 'host-already-initialized', 'fork-anchor-unreadable']);

/** The HTTP status of a LaunchError: what the caller did wrong (400), what does not exist (404), what the session state forbids (409), the daemon's own trouble (500), else the launch could not be done (422). */
export function statusOfLaunchError(code: string): number {
  if (NOT_FOUND.has(code)) {
    return 404;
  }
  if (CONFLICT.has(code)) {
    return 409;
  }
  if (VALIDATION.has(code)) {
    return 400;
  }
  if (SERVER_SIDE.has(code)) {
    return 500;
  }
  return 422;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store' });
  res.end(text);
}

function headerText(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function createApiServer(options: ApiServerOptions): ApiServer {
  const { host } = options;
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const maxClients = options.maxSseClients ?? DEFAULT_MAX_SSE_CLIENTS;
  const heartbeatMs = options.sseHeartbeatMs ?? DEFAULT_SSE_HEARTBEAT_MS;
  const maxBuffered = options.maxSseBufferedBytes ?? MAX_SSE_BUFFERED_BYTES;
  const sseClients = new Set<() => void>();
  let actualPort = 0;

  function checkOrigin(req: IncomingMessage): void {
    const hostHeader = headerText(req.headers.host);
    const match = hostHeader === undefined ? null : /^(127\.0\.0\.1|localhost|\[::1\]):(\d+)$/i.exec(hostHeader);
    if (match === null || !LOOPBACK_HOSTS.includes((match[1] ?? '').toLowerCase()) || Number(match[2]) !== actualPort) {
      throw new HttpError(403, 'bad-host', `the Host header ${JSON.stringify(hostHeader ?? '')} is not this daemon on the loopback`, `call http://127.0.0.1:${actualPort}/ (a name that resolves to another address is refused: DNS rebinding)`);
    }
    // Only server-side callers use this API (the app-core module backend, the CLI): Node's fetch sends no Origin. A request that carries one comes from
    // a browser, whatever the page (even a loopback page on another port), and is refused.
    const origin = headerText(req.headers.origin);
    if (origin !== undefined) {
      throw new HttpError(403, 'bad-origin', `the request carries an Origin header (${JSON.stringify(origin)}): it comes from a browser page`, 'this API is not for browsers; use the agent-manager module of app-core (its backend calls this daemon)');
    }
    if (headerText(req.headers['sec-fetch-site']) === 'cross-site') {
      throw new HttpError(403, 'cross-site', 'a cross-site request is refused', 'call the API from a local process, not from a web page of another site');
    }
  }

  function checkToken(req: IncomingMessage): void {
    const token = options.getToken();
    if (token === undefined) {
      throw new HttpError(503, 'daemon-starting', 'the daemon is still starting', 'retry in a moment');
    }
    const authorization = headerText(req.headers.authorization) ?? '';
    const provided = /^Bearer\s+(\S+)$/.exec(authorization)?.[1];
    // Digests have the same length whatever was sent: no length leak, constant-time compare.
    if (provided === undefined || !timingSafeEqual(digest(provided), digest(token))) {
      throw new HttpError(401, 'unauthorized', 'a valid bearer token is required', 'send "Authorization: Bearer <the content of the health_token file in the agent-manager config folder>"');
    }
  }

  async function readJson(req: IncomingMessage, required: boolean): Promise<unknown> {
    const declared = Number(headerText(req.headers['content-length']) ?? '0');
    if (declared > maxBody) {
      throw new HttpError(413, 'body-too-large', `the body is ${declared} bytes, the limit is ${maxBody}`, 'send less (an image must be downscaled or re-encoded)');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const piece = chunk as Buffer;
      size += piece.length;
      if (size > maxBody) {
        throw new HttpError(413, 'body-too-large', `the body is over the limit of ${maxBody} bytes`, 'send less (an image must be downscaled or re-encoded)');
      }
      chunks.push(piece);
    }
    if (size === 0) {
      if (required) {
        throw new HttpError(400, 'invalid-body', 'the body is empty', 'send a JSON object with Content-Type: application/json');
      }
      return {};
    }
    const type = headerText(req.headers['content-type']) ?? '';
    if (!/^application\/json\b/i.test(type)) {
      throw new HttpError(415, 'unsupported-media-type', `Content-Type ${JSON.stringify(type)} is not accepted`, 'send the body as application/json');
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      throw new HttpError(400, 'invalid-json', `the body is not valid JSON (${getErrorMessage(error)})`, 'send a JSON object');
    }
  }

  function idOf(value: string | undefined, kind: string): string {
    if (value === undefined || !SAFE_ID.test(value)) {
      throw new HttpError(400, 'invalid-id', `the ${kind} ${JSON.stringify(value ?? '')} is not a valid identifier`, 'use the id as GET /sessions shows it');
    }
    return value;
  }

  function serveEvents(req: IncomingMessage, res: ServerResponse): void {
    if (sseClients.size >= maxClients) {
      throw new HttpError(503, 'too-many-streams', `${sseClients.size} event streams are open (the limit is ${maxClients})`, 'close one (one stream per consumer is enough: the module relays to its tabs)');
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const after = headerText(req.headers['last-event-id']) ?? url.searchParams.get('after') ?? undefined;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    // Everything `end` touches is declared before the first write: a connection can be dropped in the middle of the replay.
    let unsubscribe: () => void = () => undefined;
    let heartbeat: NodeJS.Timeout | undefined;
    let ended = false;
    const end = (): void => {
      ended = true;
      clearInterval(heartbeat);
      unsubscribe();
      sseClients.delete(end);
      if (!res.writableEnded) {
        res.end();
      }
    };
    const write = (text: string): void => {
      if (ended || res.writableEnded || res.destroyed) {
        return;
      }
      res.write(text);
      if (res.writableLength >= maxBuffered) {
        // The client does not read: drop it; it reconnects with Last-Event-ID and replays what the buffer still holds.
        end();
      }
    };
    const frame = (id: string | undefined, type: string, data: unknown): string => `${id === undefined ? '' : `id: ${id}\n`}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    // Subscribe and replay in the same tick: no event falls between them.
    const replay = host.events.replay(after);
    write('retry: 3000\n\n');
    if (replay.gap) {
      write(frame(undefined, 'replay.gap', { reason: replay.gapReason, lastEventId: after ?? null, fix: 'refetch GET /sessions, then continue from the events that follow' }));
    }
    for (const event of replay.events) {
      write(frame(event.id, event.type, event));
    }
    req.on('close', end);
    res.on('close', end);
    if (ended) {
      return;
    }
    unsubscribe = host.events.subscribe((event) => write(frame(event.id, event.type, event)));
    heartbeat = setInterval(() => write(': keepalive\n\n'), heartbeatMs);
    heartbeat.unref();
    sseClients.add(end);
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const parts = path.split('/').filter((part) => part !== '');
    const [first, second, third, fourth] = parts;
    const notAllowed = (allowed: string): never => {
      throw new HttpError(405, 'method-not-allowed', `${method} is not accepted on ${path}`, `use ${allowed}`);
    };
    const getOnly = (answer: () => void): void => {
      if (method !== 'GET') {
        notAllowed('GET');
      }
      answer();
    };
    if (first === 'status' && parts.length === 1) {
      getOnly(() => sendJson(res, 200, { ...host.status(), ...options.statusExtra() }));
      return;
    }
    if (first === 'events' && parts.length === 1) {
      getOnly(() => serveEvents(req, res));
      return;
    }
    if (first !== 'sessions') {
      throw new HttpError(404, 'not-found', `no route ${path}`, 'see the routes in the architecture document: /status, /events, /sessions...');
    }
    if (parts.length === 1) {
      getOnly(() => sendJson(res, 200, { sessions: host.list() }));
      return;
    }
    if (second === 'launch' && parts.length === 2) {
      if (method !== 'POST') {
        notAllowed('POST');
      }
      const session = await host.launch(await parseLaunchBody(await readJson(req, true)));
      sendJson(res, 201, { session });
      return;
    }
    const id = idOf(second, 'session id');
    if (parts.length === 2) {
      getOnly(() => sendJson(res, 200, { session: host.get(id) }));
      return;
    }
    if (parts.length === 3 && third === 'permissions') {
      getOnly(() => sendJson(res, 200, { permissions: host.permissions(id) }));
      return;
    }
    if (parts.length === 4 && third === 'permissions') {
      if (method !== 'POST') {
        notAllowed('POST');
      }
      const requestId = idOf(fourth, 'permission request id');
      sendJson(res, 200, await host.decide(id, requestId, parseDecisionBody(await readJson(req, true))));
      return;
    }
    if (parts.length === 3 && method !== 'POST' && ['send', 'interrupt', 'permission-mode', 'stop', 'resume', 'forget'].includes(third ?? '')) {
      notAllowed('POST');
    }
    if (parts.length === 3 && method === 'POST') {
      switch (third) {
        case 'send':
          sendJson(res, 200, await host.send(id, parseSendBody(await readJson(req, true))));
          return;
        case 'interrupt':
          await readJson(req, false);
          sendJson(res, 200, await host.interrupt(id));
          return;
        case 'permission-mode':
          sendJson(res, 200, await host.setPermissionMode(id, parsePermissionModeBody(await readJson(req, true)).mode));
          return;
        case 'stop':
          await readJson(req, false);
          sendJson(res, 200, { session: await host.stop(id) });
          return;
        case 'resume': {
          const body = await readJson(req, false);
          const acknowledge = typeof body === 'object' && body !== null ? Reflect.get(body, 'acknowledgeLeftover') : undefined;
          if (acknowledge !== undefined && typeof acknowledge !== 'boolean') {
            throw new LaunchError('invalid-field', 'acknowledgeLeftover must be true or false', 'send {"acknowledgeLeftover": true} or no body');
          }
          sendJson(res, 200, { session: await host.resume(id, { acknowledgeLeftover: acknowledge === true }) });
          return;
        }
        case 'forget':
          await readJson(req, false);
          sendJson(res, 200, await host.forget(id));
          return;
        default:
          throw new HttpError(404, 'not-found', `no route ${method} ${path}`, 'see GET /status for the daemon and the routes in the architecture document');
      }
    }
    throw new HttpError(404, 'not-found', `no route ${method} ${path}`, 'routes: GET /sessions, GET /sessions/:id, POST /sessions/launch, POST /sessions/:id/{send,interrupt,permission-mode,stop,resume,forget}, GET /sessions/:id/permissions, POST /sessions/:id/permissions/:requestId, GET /events, GET /status');
  }

  const server: Server = createServer((req, res) => {
    void (async () => {
      try {
        checkOrigin(req);
        checkToken(req);
        await route(req, res);
      } catch (error) {
        if (res.headersSent) {
          // A stream or a half-sent answer: nothing more can be said to this client.
          res.destroy();
          options.onError?.(`a request failed after its answer started (${getErrorMessage(error)})`);
          return;
        }
        if (error instanceof HttpError) {
          sendJson(res, error.status, { error: { code: error.code, reason: error.reason, fix: error.fix } });
        } else if (error instanceof LaunchError) {
          sendJson(res, statusOfLaunchError(error.code), { error: { code: error.code, reason: error.reason, fix: error.fix } });
        } else {
          const text = getErrorMessage(error);
          options.onError?.(`unexpected error on ${req.method ?? '?'} ${req.url ?? '?'}: ${text}`);
          sendJson(res, 500, { error: { code: 'internal', reason: `unexpected error (${text})`, fix: 'this is a bug of agent-manager: report it with the daemon log' } });
        }
      }
    })();
  });

  return {
    get port() {
      return actualPort;
    },
    listen(port) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', reject);
          actualPort = (server.address() as { port: number }).port;
          resolve(actualPort);
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        for (const end of [...sseClients]) {
          end();
        }
        server.closeAllConnections();
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
      });
    },
  };
}
