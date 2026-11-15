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

/** GET or POST JSON. Resolves with the parsed body or a user-readable failure, never rejects (an aborted request resolves as an empty failure). */
export async function requestJson<T>(path: string, init?: { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal }): Promise<Outcome<T>> {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: init?.method ?? 'GET',
      headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init?.signal,
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, text: `The server answered HTTP ${response.status} with something that is not JSON. Check the app-core output.` };
    }
    if (!response.ok) {
      return { ok: false, text: failureText(body, response.status) };
    }
    return { ok: true, value: body as T };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ok: false, text: '' };
    }
    return { ok: false, text: networkText(error) };
  }
}
