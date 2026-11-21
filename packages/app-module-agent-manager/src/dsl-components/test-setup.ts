import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { markMessage } from '../commons/errorMarks.js';
import { seedCsrfToken } from './data/http.js';

/**
 * Stands in for the app-core shell (`globalThis.__APP_CORE_SHELL__`, what `appFetcher` of @wadeck-app/app-core-sdk/shell reads): like the real fetcher it
 * sends 'METHOD /path' through the global fetch (which the tests stub) and throws an Error with the server's message and status on a refusal.
 * Tests of the PIN behaviour install their own (data/http.pin.test.ts).
 */
const fakeShell = {
  elevate: async (): Promise<void> => undefined,
  fetcher: async (url: string, _params?: Record<string, string>, body?: unknown, extraHeaders?: Record<string, string>): Promise<unknown> => {
    const [method = 'GET', path = ''] = url.split(' ');
    const response = await fetch(path, { method, headers: { 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify(body ?? {}) });
    const data = (await response.json().catch(() => undefined)) as { message?: string; hint?: string; error?: unknown } | undefined;
    if (!response.ok) {
      // The route kit adds a top-level "message. hint" to the error body of a sensitive route (backend/routeKit.ts, tested there): the stubs of the
      // tests answer the nested shape, so this stand-in does the same folding.
      const nested = data?.error !== null && typeof data?.error === 'object' ? (data.error as { message?: string; hint?: string; code?: string }) : data;
      const folded = nested?.message === undefined ? undefined : nested.hint === undefined || nested.message.includes(nested.hint) ? nested.message : `${nested.message.replace(/\.$/, '')}. ${nested.hint}`;
      const reason = folded === undefined ? data?.error : markMessage((nested as { code?: string } | undefined)?.code, folded);
      throw Object.assign(new Error(typeof reason === 'string' ? reason : `${method} ${path} answered ${response.status}`), { status: response.status });
    }
    return data;
  },
};

// Every test starts with the write token already "fetched": the tests of the token itself (data/http.test.ts) reset it.
beforeEach(() => {
  seedCsrfToken('test-token');
  Reflect.set(globalThis, '__APP_CORE_SHELL__', fakeShell);
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(globalThis, '__APP_CORE_SHELL__');
});
