// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestJson, resetCsrfToken, seedCsrfToken } from './http.js';

type ShellCall = { url: string; params: unknown; body: unknown; headers: Record<string, string> | undefined };
let shellCalls: ShellCall[];
let plainCalls: string[];

/** The shell global the SDK reads (`__APP_CORE_SHELL__`): `fetcher` is the shell's own, `answer` decides what it does. */
function shell(answer: (call: ShellCall, index: number) => unknown): void {
  Reflect.set(globalThis, '__APP_CORE_SHELL__', {
    elevate: async () => undefined,
    fetcher: async (url: string, params?: unknown, body?: unknown, headers?: Record<string, string>) => {
      const call = { url, params, body, headers };
      shellCalls.push(call);
      return answer(call, shellCalls.length - 1);
    },
  });
}

const failure = (message: string, status?: number): Error => Object.assign(new Error(message), status === undefined ? {} : { status });

beforeEach(() => {
  shellCalls = [];
  plainCalls = [];
  seedCsrfToken('tok');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      plainCalls.push(url);
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, '__APP_CORE_SHELL__');
  resetCsrfToken();
});

describe('sensitive routes go through the app-core shell fetcher (PIN)', () => {
  it('a sensitive route uses appFetcher with METHOD and the module path, the body and the CSRF header; no plain fetch', async () => {
    shell(() => ({ ok: true, sessionId: 's' }));
    const result = await requestJson('/owned/abc/permission-mode', { method: 'POST', body: { mode: 'plan' } });
    expect(result).toEqual({ ok: true, value: { ok: true, sessionId: 's' } });
    expect(shellCalls).toHaveLength(1);
    expect(shellCalls[0]).toMatchObject({ url: 'POST /api/modules/agent-manager/owned/abc/permission-mode', params: undefined, body: { mode: 'plan' } });
    expect(shellCalls[0]?.headers?.['X-Agent-Manager-Csrf']).toBe('tok');
    expect(plainCalls).toEqual([]);
  });

  it.each([
    ['POST', '/owned/launch'],
    ['POST', '/owned/a/resume'],
    ['POST', '/owned/a/stop'],
    ['POST', '/owned/a/interrupt'],
    ['POST', '/owned/a/forget'],
    ['POST', '/owned/a/permissions/r1'],
    ['POST', '/sessions/a/reply'],
  ])('%s %s is sensitive', async (method, path) => {
    shell(() => ({ ok: true }));
    await requestJson(path, { method: method as 'POST' });
    expect(shellCalls).toHaveLength(1);
  });

  it('pin, seen, the transport preferences and every GET stay on the plain client', async () => {
    shell(() => {
      throw new Error('the shell must not be used');
    });
    await requestJson('/sessions/a/pin', { method: 'POST', body: { pinned: true } });
    await requestJson('/sessions/a/seen', { method: 'POST' });
    await requestJson('/sessions/a/reply/transport', { method: 'PUT', body: { transportId: 'socket' } });
    await requestJson('/reply/transport/default', { method: 'PUT', body: { transportId: null } });
    await requestJson('/owned');
    expect(plainCalls).toHaveLength(5);
    expect(shellCalls).toEqual([]);
  });

  it('a cancelled PIN dialog says so and how to retry; the action is not repeated', async () => {
    shell(() => {
      throw failure('Sensitive action cancelled: PIN not entered');
    });
    const result = await requestJson('/owned/a/stop', { method: 'POST' });
    expect(result).toEqual({ ok: false, text: 'Sensitive action cancelled: PIN not entered. Do the action again and enter the PIN to send it.' });
    expect(shellCalls).toHaveLength(1);
  });

  it('a shell too old for appFetcher says what to run (no fallback to a plain fetch)', async () => {
    // No shell global at all: the SDK throws its own error.
    Reflect.deleteProperty(globalThis, '__APP_CORE_SHELL__');
    const result = await requestJson('/sessions/a/reply', { method: 'POST', body: { text: 'hi' } });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.text).toMatch(/too old.*2026\.11\.20-212.*'app-core-cli update'.*reload/);
    expect(plainCalls).toEqual([]);
  });

  it('403 pin-not-set says to run app-core-cli pin set, and is not repeated', async () => {
    shell(() => {
      throw failure('Run "app-core-cli pin set" to choose the PIN that unlocks sensitive actions.', 403);
    });
    const result = await requestJson('/owned/launch', { method: 'POST', body: {} });
    expect(result.ok === false && result.text).toContain("'app-core-cli pin set'");
    expect(shellCalls).toHaveLength(1);
  });

  it('a stale CSRF token (403 from the module) fetches a new token and sends once more', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        plainCalls.push(url);
        return { ok: true, status: 200, json: async () => ({ ok: true, header: 'X-Agent-Manager-Csrf', token: 'fresh' }) } as unknown as Response;
      }),
    );
    shell((_call, index) => {
      if (index === 0) {
        throw failure('The token is not one issued by this module run. Fetch a new token with GET /csrf and retry once.', 403);
      }
      return { ok: true };
    });
    const result = await requestJson('/owned/a/stop', { method: 'POST' });
    expect(result.ok).toBe(true);
    expect(shellCalls.map((call) => call.headers?.['X-Agent-Manager-Csrf'])).toEqual(['tok', 'fresh']);
  });

  it('any other server refusal shows its message', async () => {
    shell(() => {
      throw failure('The body must be a JSON object. Send no body.', 400);
    });
    const result = await requestJson('/owned/a/resume', { method: 'POST' });
    expect(result).toEqual({ ok: false, text: 'The body must be a JSON object. Send no body.' });
  });
});

describe('a sensitive call that the caller gives up (AbortSignal)', () => {
  it('answers an empty failure at once, drops the late answer of the shell, and the next call waits for the first PIN dialog instead of opening a second one', async () => {
    const releases: ((value: unknown) => void)[] = [];
    shell(() => new Promise((resolve) => releases.push(resolve)));
    const first = new AbortController();
    const firstResult = requestJson('/guardrails/denials/commands?day=a', { signal: first.signal });
    await vi.waitFor(() => expect(shellCalls).toHaveLength(1));
    // The user changes a filter while the PIN dialog of the first call is open.
    first.abort();
    expect(await firstResult).toEqual({ ok: false, text: '' });
    const second = requestJson('/guardrails/denials/commands?day=b');
    // The second call does not reach the shell while the first dialog is still open.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(shellCalls).toHaveLength(1);
    // The PIN is typed: the first answer is dropped, the second call goes through (the shell has its token now).
    releases[0]!({ ok: true, which: 'first' });
    await vi.waitFor(() => expect(shellCalls).toHaveLength(2));
    releases[1]!({ ok: true, which: 'second' });
    expect(await second).toEqual({ ok: true, value: { ok: true, which: 'second' } });
  });

  it('a signal already aborted never calls the shell', async () => {
    shell(() => ({ ok: true }));
    const controller = new AbortController();
    controller.abort();
    expect(await requestJson('/guardrails/denials/commands', { signal: controller.signal })).toEqual({ ok: false, text: '' });
    expect(shellCalls).toEqual([]);
  });
});
