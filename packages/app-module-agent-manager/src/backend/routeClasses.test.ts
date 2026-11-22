import { describe, expect, it } from 'vitest';
import { NOT_SENSITIVE_ROUTES, SENSITIVE_ROUTES, isSensitiveRequest } from '../commons/routeClasses.js';
import { createRouteKit } from './routeKit.js';
import { makeModule } from './testKit.js';
import type { ModuleContext } from '@wadeck-app/app-core-sdk';

describe('PIN class of the routes (T-01, T-12)', () => {
  const { registered } = makeModule();
  const writes = registered.filter((route) => !route.key.startsWith('GET ') && !route.key.startsWith('HEAD '));

  it('every non-GET route is classified: in SENSITIVE_ROUTES or NOT_SENSITIVE_ROUTES, never both', () => {
    const unclassified = writes.map((route) => route.key).filter((key) => !SENSITIVE_ROUTES.includes(key) && !NOT_SENSITIVE_ROUTES.includes(key));
    expect(unclassified, 'add the new write route to routeClasses.ts and pass { sensitive: true } if it is sensitive').toEqual([]);
    expect(SENSITIVE_ROUTES.filter((key) => NOT_SENSITIVE_ROUTES.includes(key))).toEqual([]);
  });

  it('the lists name only routes that exist', () => {
    const keys = registered.map((route) => route.key);
    expect([...SENSITIVE_ROUTES, ...NOT_SENSITIVE_ROUTES].filter((key) => !keys.includes(key))).toEqual([]);
  });

  it("registerRoute gets effect 'sensitive' exactly for SENSITIVE_ROUTES, and no effect for any other route", () => {
    for (const route of registered) {
      expect(route.effect, route.key).toBe(SENSITIVE_ROUTES.includes(route.key) ? 'sensitive' : undefined);
    }
    expect(registered.filter((route) => route.effect === 'sensitive')).toHaveLength(SENSITIVE_ROUTES.length);
  });

  it('the CSRF guard still answers 403 on a sensitive route without the web UI headers', async () => {
    const answer = await makeModule().call('POST', '/owned/launch', { body: {}, headers: { 'sec-fetch-site': undefined } });
    expect(answer.status).toBe(403);
    expect(answer.body).toMatchObject({ ok: false, error: { code: 'csrf-required' } });
  });

  it("a refusal of a sensitive route carries a top-level 'message. hint' (the shell fetcher throws only that); other routes keep their body", async () => {
    const m = makeModule();
    const sensitive = await m.call('POST', '/sessions/a/reply', { body: {}, headers: { 'sec-fetch-site': undefined } });
    expect(sensitive.body).toMatchObject({ ok: false, error: { code: 'csrf-required' }, message: expect.stringMatching(/no Sec-Fetch-Site header.*a script must not call this route/) });
    const plain = await m.call('POST', '/sessions/a/seen', { headers: { 'sec-fetch-site': undefined } });
    expect(plain.body).not.toHaveProperty('message');
  });

  it('RouteKit.route passes the options through to registerRoute', () => {
    const seen: (unknown)[] = [];
    const ctx = { dataDir: '.', registerRoute: (_m: string, _p: string, _h: unknown, options?: unknown) => seen.push(options) } as unknown as ModuleContext;
    const kit = createRouteKit(ctx);
    const run = (): Promise<{ status: number; body: unknown }> => Promise.resolve({ status: 200, body: {} });
    kit.route('POST', '/a', run, { sensitive: true });
    kit.route('POST', '/b', run, { sensitive: false });
    kit.route('POST', '/c', run);
    expect(seen).toEqual([{ effect: 'sensitive' }, undefined, undefined]);
  });
});

describe('the batch reply route (T-21)', () => {
  it('is sensitive: one PIN prompt for the batch, registered with the sensitive effect, and the shell asks for the PIN for its path', () => {
    expect(SENSITIVE_ROUTES).toContain('POST /sessions/batch/reply');
    expect(makeModule().registered.find((route) => route.key === 'POST /sessions/batch/reply')?.effect).toBe('sensitive');
    expect(isSensitiveRequest('POST', '/sessions/batch/reply')).toBe(true);
  });
});
