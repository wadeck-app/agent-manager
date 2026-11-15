import { CSRF_HEADER, CSRF_PATH } from '../shared.js';

/** Where the routes of this module live (relative: the shell and the module share an origin). */
export const API_BASE = '/api/modules/agent-manager';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; text: string };

/**
 * The one line to show for a failed answer: "message. hint". Understands the two error shapes of this module ({ message, hint } from the
 * session routes and { ok: false, error: { message, hint } } from the log and reply routes) and falls back to the HTTP status. Never throws.
 */
export function failureText(body: unknown, status: number): string {
  if (isRecord(body)) {
    const record = body;
    const nested = record['error'];
    const source = isRecord(nested) ? nested : record;
    const message = typeof source['message'] === 'string' ? source['message'] : typeof record['errorText'] === 'string' ? record['errorText'] : undefined;
    const hint = typeof source['hint'] === 'string' ? source['hint'] : undefined;
    if (message !== undefined) {
      return hint === undefined || message.includes(hint) ? message : `${message.replace(/\.$/, '')}. ${hint}`;
    }
  }
  return `The server answered HTTP ${status} without an explanation. Check that app-core is running and the module is registered.`;
}

/** What a failed fetch means to the user: the network, not the module. */
export function networkText(error: unknown): string {
  const detail = String(error);
  return `Cannot reach the app-core server (${detail}). Check that it is running, then retry.`;
}

type Method = 'GET' | 'POST' | 'PUT';

// The token of the write routes (GET /csrf): one request per page load, shared by every write (the promise is cached); forgotten when the server says it is stale.
let tokenPromise: Promise<{ header: string; token: string } | { error: string }> | undefined;

async function fetchToken(): Promise<{ header: string; token: string } | { error: string }> {
  try {
    const response = await fetch(`${API_BASE}${CSRF_PATH}`);
    const body: unknown = await response.json();
    if (response.ok && isRecord(body) && typeof body['token'] === 'string') {
      return { header: typeof body['header'] === 'string' ? body['header'] : CSRF_HEADER, token: body['token'] };
    }
    return { error: `The write token could not be fetched. ${failureText(body, response.status)}` };
  } catch (error) {
    return { error: `The write token could not be fetched. ${networkText(error)}` };
  }
}

function csrfToken(): Promise<{ header: string; token: string } | { error: string }> {
  tokenPromise ??= fetchToken();
  return tokenPromise;
}

/** For tests: starts with this token already fetched (a test that does not care about the token fetch need not answer GET /csrf). */
export function seedCsrfToken(token: string): void {
  tokenPromise = Promise.resolve({ header: CSRF_HEADER, token });
}

/** For tests: forgets the cached write token. */
export function resetCsrfToken(): void {
  tokenPromise = undefined;
}

function errorCode(body: unknown): string | undefined {
  const error = isRecord(body) ? body['error'] : undefined;
  return isRecord(error) && typeof error['code'] === 'string' ? error['code'] : undefined;
}

/**
 * GET, POST or PUT JSON. Resolves with the parsed body or a user-readable failure, never rejects (an aborted request resolves as an empty failure).
 * Every non-GET request carries the CSRF header (see commons/csrf.ts). On a 403 'csrf-invalid' (the module restarted) the token is fetched again and the
 * request is sent ONCE more; any other refusal ('csrf-required' ...) is shown as the server wrote it, with its hint.
 */
export async function requestJson<T>(path: string, init?: { method?: Method; body?: unknown; signal?: AbortSignal }): Promise<Outcome<T>> {
  const method = init?.method ?? 'GET';
  try {
    for (let attempt = 0; ; attempt += 1) {
      const headers: Record<string, string> = {};
      if (init?.body !== undefined) {
        headers['content-type'] = 'application/json';
      }
      if (method !== 'GET') {
        const token = await csrfToken();
        if ('error' in token) {
          tokenPromise = undefined;
          return { ok: false, text: token.error };
        }
        headers[token.header] = token.token;
      }
      const response = await fetch(`${API_BASE}${path}`, {
        method,
        headers: Object.keys(headers).length === 0 ? undefined : headers,
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
        signal: init?.signal,
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return { ok: false, text: `The server answered HTTP ${response.status} with something that is not JSON. Check the app-core output.` };
      }
      if (response.status === 403 && method !== 'GET' && errorCode(body) === 'csrf-invalid' && attempt === 0) {
        tokenPromise = undefined;
        continue;
      }
      if (!response.ok) {
        return { ok: false, text: failureText(body, response.status) };
      }
      return { ok: true, value: body as T };
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, text: '' };
    }
    return { ok: false, text: networkText(error) };
  }
}
