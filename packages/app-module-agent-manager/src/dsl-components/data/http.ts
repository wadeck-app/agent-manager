import { appFetcher } from '@wadeck-app/app-core-sdk/shell';
import { getErrorMessage } from '../logic/errorText.js';
import { CSRF_HEADER, CSRF_PATH, isSensitiveRequest } from '../shared.js';
// violations-suppress: ts/no-deep-relative the module has no path alias; commons/ is shared by the backend and the page
import { unmarkMessage } from '../../commons/errorMarks.js';

/** Where the routes of this module live (relative: the shell and the module share an origin). */
export const API_BASE = '/api/modules/agent-manager';

/** Where the pages of this module live in the shell (a link to `/agents` alone is "Page not found": the shell serves a module under /modules/<id>/). */
export const PAGE_BASE = '/modules/agent-manager';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A failure carries the machine code of the server's error when it sent one (the folder pickers tell a path outside the roots from a folder that does not exist). */
export type Outcome<T> = { ok: true; value: T } | { ok: false; text: string; code?: string };

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

/**
 * What the user reads when a PIN-protected call fails through the shell fetcher (it throws an Error with the server's message and a status).
 * Cancelled dialog, shell too old and PIN not set get their own instruction; anything else is the server's message.
 */
export function shellFailureText(error: unknown): string {
  const message = getErrorMessage(error);
  const status = error instanceof Error ? Reflect.get(error, 'status') : undefined;
  if (message.includes('Sensitive action cancelled')) {
    return 'Sensitive action cancelled: PIN not entered. Do the action again and enter the PIN to send it.';
  }
  if (message.includes('the app-core shell does not provide')) {
    return "This action is protected by a PIN and this app-core is too old to ask for it (needs app-core-cli 2026.11.20-212 or later). Run 'app-core-cli update', restart app-core, reload this page, then retry.";
  }
  if (status === 403 && message.includes('pin set')) {
    return "This action is protected by a PIN and no PIN is set. Run 'app-core-cli pin set' in a terminal (once), then retry and enter the PIN when asked.";
  }
  return typeof status === 'number' ? message : networkText(error);
}

function errorCode(body: unknown): string | undefined {
  const error = isRecord(body) ? body['error'] : undefined;
  return isRecord(error) && typeof error['code'] === 'string' ? error['code'] : undefined;
}

// The shell fetcher cannot be cancelled: when a caller gives up (a filter changed) its call may still be showing the PIN dialog. It is kept here, and the next
// sensitive call waits for it, so the user types the PIN once (the shell keeps the token) instead of meeting a second dialog on top of the first.
let abandoned: Promise<void> = Promise.resolve();

const abortError = (): DOMException => new DOMException('The request was cancelled', 'AbortError');

/** appFetcher with the caller's AbortSignal: on abort it rejects at once with an AbortError and the late answer of the shell is dropped, never applied. */
async function sensitiveCall(url: string, body: unknown, headers: Record<string, string>, signal: AbortSignal | undefined): Promise<unknown> {
  // A function, read at each check: the signal may be aborted while this call waits for an abandoned dialog.
  const aborted = (): boolean => signal?.aborted === true;
  if (aborted()) {
    throw abortError();
  }
  await abandoned;
  if (aborted()) {
    throw abortError();
  }
  const call = appFetcher(url, undefined, body, headers);
  if (signal === undefined) {
    return call;
  }
  return new Promise<unknown>((resolve, reject) => {
    const onAbort = (): void => {
      abandoned = call.then(
        () => undefined,
        () => undefined,
      );
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    call.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/**
 * GET, POST or PUT JSON. Resolves with the parsed body or a user-readable failure, never rejects (an aborted request resolves as an empty failure).
 * Every non-GET request carries the CSRF header (see commons/csrf.ts). On a 403 'csrf-invalid' (the module restarted) the token is fetched again and the
 * request is sent ONCE more; any other refusal ('csrf-required' ...) is shown as the server wrote it, with its hint.
 */
export async function requestJson<T>(path: string, init?: { method?: Method; body?: unknown; signal?: AbortSignal }): Promise<Outcome<T>> {
  const method = init?.method ?? 'GET';
  try {
    const sensitive = isSensitiveRequest(method, path);
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
      if (sensitive) {
        // The shell's own fetcher: Bearer token, refresh, PIN dialog, one retry. It throws the server's message (see forShellFetcher in routeKit.ts).
        try {
          const value = await sensitiveCall(`${method} ${API_BASE}${path}`, init?.body, headers, init?.signal);
          return { ok: true, value: value as T };
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            return { ok: false, text: '' };
          }
          // A refusal before the handler ran (stale CSRF token after a module restart): fetch a new token and send ONCE more. Not for the PIN refusals.
          if (attempt === 0 && error instanceof Error && Reflect.get(error, 'status') === 403 && !getErrorMessage(error).includes('pin set')) {
            tokenPromise = undefined;
            continue;
          }
          // A machine code that the route put in front of the text (the shell fetcher throws nothing else): taken off, and returned as `code`.
          const { text, code } = unmarkMessage(shellFailureText(error));
          return { ok: false, text, ...(code === undefined ? {} : { code }) };
        }
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
        return { ok: false, text: failureText(body, response.status), ...(errorCode(body) === undefined ? {} : { code: errorCode(body) }) };
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
