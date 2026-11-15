import { describe, expect, it } from 'vitest';
import { putSession, useSandbox } from './apiFixtures.js';
import { makeModule } from './testKit.js';

const box = useSandbox();

const NO_SITE = { 'sec-fetch-site': undefined };
const NO_TOKEN = { 'x-agent-manager-csrf': undefined };

describe('write routes need the web UI (T-08)', () => {
  const id = (): string => putSession(box, process.pid);
  const writes = (sessionId: string): { name: string; method: string; path: string; body: unknown }[] => [
    { name: 'pin', method: 'POST', path: `/sessions/${sessionId}/pin`, body: { pinned: true } },
    { name: 'seen', method: 'POST', path: `/sessions/${sessionId}/seen`, body: undefined },
    { name: 'reply', method: 'POST', path: `/sessions/${sessionId}/reply`, body: { text: 'hello' } },
    { name: 'session transport', method: 'PUT', path: `/sessions/${sessionId}/reply/transport`, body: { transportId: 'socket' } },
    { name: 'default transport', method: 'PUT', path: '/reply/transport/default', body: { transportId: 'socket' } },
  ];

  it('GET /csrf serves the header name and a token; two calls give two tokens', async () => {
    const m = makeModule({ dataDir: box.data });
    const first = (await m.call('GET', '/csrf')).body;
    expect(first).toMatchObject({ ok: true, header: 'X-Agent-Manager-Csrf', token: expect.stringMatching(/^[0-9a-f]{32}\.[0-9a-f]{64}$/) });
    expect((await m.call('GET', '/csrf')).body.token).not.toBe(first.token);
  });

  it.each(['pin', 'seen', 'reply', 'session transport', 'default transport'])('%s: refused with 403 without Sec-Fetch-Site (curl, node fetch, agents), nothing is done', async (name) => {
    const sessionId = id();
    const route = writes(sessionId).find((entry) => entry.name === name)!;
    const m = makeModule({ dataDir: box.data });
    const answer = await m.call(route.method, route.path, { body: route.body, headers: NO_SITE });
    expect(answer.status).toBe(403);
    expect(answer.body).toMatchObject({ ok: false, error: { code: 'csrf-required', message: expect.stringContaining('no Sec-Fetch-Site header'), hint: expect.stringContaining('a script must not call this route (T-08)') } });
  });

  it.each(['pin', 'seen', 'reply', 'session transport', 'default transport'])('%s: refused with 403 without the token header, and the message names it', async (name) => {
    const sessionId = id();
    const route = writes(sessionId).find((entry) => entry.name === name)!;
    const answer = await makeModule({ dataDir: box.data }).call(route.method, route.path, { body: route.body, headers: NO_TOKEN });
    expect(answer.status).toBe(403);
    expect(answer.body.error).toMatchObject({ code: 'csrf-required', message: expect.stringContaining('X-Agent-Manager-Csrf') });
  });

  it('refuses a cross-site request, a forged token and a token of another module run', async () => {
    const sessionId = id();
    const m = makeModule({ dataDir: box.data });
    const path = `/sessions/${sessionId}/pin`;
    const crossSite = await m.call('POST', path, { body: { pinned: true }, headers: { 'sec-fetch-site': 'cross-site' } });
    expect(JSON.stringify(crossSite.body)).toContain('Sec-Fetch-Site: cross-site');
    expect((await m.call('POST', path, { body: { pinned: true }, headers: { 'x-agent-manager-csrf': 'abc.def' } })).body.error.code).toBe('csrf-invalid');
    const other = makeModule({ dataDir: box.data });
    const foreign = (await other.call('GET', '/csrf')).body.token as string;
    const answer = await m.call('POST', path, { body: { pinned: true }, headers: { 'x-agent-manager-csrf': foreign } });
    expect(answer.status).toBe(403);
    expect(answer.body.error).toMatchObject({ code: 'csrf-invalid', hint: expect.stringContaining('GET /csrf') });
  });

  it('GET routes need neither header', async () => {
    const answer = await makeModule({ dataDir: box.data }).call('GET', '/sessions', { headers: { ...NO_SITE, ...NO_TOKEN } });
    expect(answer.status).toBe(200);
  });

  it('a request with both headers works (the test kit sends them by default)', async () => {
    const sessionId = id();
    const answer = await makeModule({ dataDir: box.data }).call('POST', `/sessions/${sessionId}/pin`, { body: { pinned: true } });
    expect(answer.status).toBe(200);
  });
});
