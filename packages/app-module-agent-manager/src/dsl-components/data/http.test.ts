import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CSRF_HEADER } from '../shared.js';
import { requestJson, resetCsrfToken } from './http.js';

type Call = { url: string; method: string; headers: Record<string, string> };
let calls: Call[];

const json = (body: unknown, status = 200): Response => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

/** A fetch whose answers are decided per call by `answer`; every call is recorded. */
function serve(answer: (call: Call, index: number) => Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string; headers?: Record<string, string> }) => {
      const call = { url, method: init?.method ?? 'GET', headers: init?.headers ?? {} };
      calls.push(call);
      return answer(call, calls.length - 1);
    }),
  );
}

const tokenAnswer = (token: string): Response => json({ ok: true, header: CSRF_HEADER, token });
const refusal = (code: string): Response => json({ ok: false, error: { code, message: `refused: ${code}`, hint: 'the hint' } }, 403);

beforeEach(() => {
  calls = [];
  resetCsrfToken();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetCsrfToken();
});

describe('requestJson and the write token', () => {
  it('a GET carries no token and does not fetch one', async () => {
    serve(() => json({ ok: true }));
    await requestJson('/sessions');
    expect(calls.map((call) => call.url)).toEqual(['/api/modules/agent-manager/sessions']);
    expect(calls[0]?.headers[CSRF_HEADER]).toBeUndefined();
  });

  it('POST and PUT carry the token header; the token is fetched once for all the writes of the page', async () => {
    serve((call) => (call.url.endsWith('/csrf') ? tokenAnswer('tok-1') : json({ ok: true })));
    await requestJson('/sessions/a/pin', { method: 'POST', body: { pinned: true } });
    await requestJson('/sessions/a/reply/transport', { method: 'PUT', body: { transportId: 'socket' } });
    await requestJson('/reply/transport/default', { method: 'PUT', body: { transportId: null } });
    expect(calls.filter((call) => call.url.endsWith('/csrf'))).toHaveLength(1);
    const writes = calls.filter((call) => call.method !== 'GET');
    expect(writes.map((call) => call.method)).toEqual(['POST', 'PUT', 'PUT']);
    writes.forEach((call) => expect(call.headers[CSRF_HEADER]).toBe('tok-1'));
  });

  it("a 403 'csrf-invalid' fetches a new token and sends the request once more", async () => {
    let issued = 0;
    serve((call) => {
      if (call.url.endsWith('/csrf')) {
        issued += 1;
        return tokenAnswer(`tok-${issued}`);
      }
      return call.headers[CSRF_HEADER] === 'tok-2' ? json({ ok: true, done: true }) : refusal('csrf-invalid');
    });
    const result = await requestJson<{ done: boolean }>('/sessions/a/seen', { method: 'POST' });
    expect(result).toEqual({ ok: true, value: { ok: true, done: true } });
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2);
    expect(issued).toBe(2);
  });

  it('retries ONCE: a second csrf-invalid is shown, never a loop', async () => {
    serve((call) => (call.url.endsWith('/csrf') ? tokenAnswer('tok') : refusal('csrf-invalid')));
    const result = await requestJson('/sessions/a/seen', { method: 'POST' });
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2);
    expect(result).toEqual({ ok: false, text: 'refused: csrf-invalid. the hint' });
  });

  it("'csrf-required' is surfaced as the server wrote it (message and hint), without a retry", async () => {
    serve((call) => (call.url.endsWith('/csrf') ? tokenAnswer('tok') : refusal('csrf-required')));
    const result = await requestJson('/sessions/a/pin', { method: 'POST', body: {} });
    expect(result).toEqual({ ok: false, text: 'refused: csrf-required. the hint' });
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('a token that cannot be fetched is said, and the write is not sent', async () => {
    serve(() => json({ ok: false, error: { code: 'x', message: 'nope', hint: 'start the module' } }, 500));
    const result = await requestJson('/sessions/a/pin', { method: 'POST', body: {} });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.text).toMatch(/write token could not be fetched. nope. start the module/);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    // The failure is not cached: the next write asks again.
    serve((call) => (call.url.endsWith('/csrf') ? tokenAnswer('tok') : json({ ok: true })));
    expect((await requestJson('/sessions/a/pin', { method: 'POST', body: {} })).ok).toBe(true);
  });
});
