import { rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ID, useSandbox } from './apiFixtures.js';
import { createDaemonApi } from './daemon/daemonApi.js';
import { startFakeDaemon, ownedView } from './daemon/fakeDaemon.js';
import type { FakeDaemon } from './daemon/fakeDaemon.js';
import { makeModule } from './testKit.js';

const box = useSandbox();
const SESSION = ID(7);
const START = 'agent-manager start --detach';

let daemon: FakeDaemon | undefined;
afterEach(async () => {
  await daemon?.stop();
  daemon = undefined;
});

/** The module with its own daemon client (no cache: every call reaches the fake); the transports are not used here. */
const mod = () => makeModule({ dataDir: box.data, options: { daemon: createDaemonApi({ cacheMs: 0, timeoutMs: 3000 }) } });
const up = async (): Promise<FakeDaemon> => {
  daemon = await startFakeDaemon(box.config);
  daemon.sessions.push(ownedView({ id: SESSION, name: 'x1' }));
  return daemon;
};

const writes = (): { name: string; method: string; path: string; body?: unknown }[] => [
  { name: 'launch', method: 'POST', path: '/owned/launch', body: { hostKind: 'stream-json', cwd: box.data } },
  { name: 'interrupt', method: 'POST', path: `/owned/${SESSION}/interrupt` },
  { name: 'permission-mode', method: 'POST', path: `/owned/${SESSION}/permission-mode`, body: { mode: 'acceptEdits' } },
  { name: 'stop', method: 'POST', path: `/owned/${SESSION}/stop` },
  { name: 'resume', method: 'POST', path: `/owned/${SESSION}/resume` },
  { name: 'forget', method: 'POST', path: `/owned/${SESSION}/forget` },
  { name: 'decision', method: 'POST', path: `/owned/${SESSION}/permissions/req-1`, body: { decision: 'allow' } },
];

describe('the daemon is not running (no config.port)', () => {
  it('GET /owned is 200 with ok:false, the reason and the fix: never an empty list that looks like "no owned sessions"', async () => {
    const { status, body } = await mod().call('GET', '/owned');
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: false, sessions: [], daemon: null, error: { code: 'daemon-not-running', message: expect.stringContaining('the agent-manager daemon is not running'), hint: expect.stringContaining(START) } });
    expect(body.errorText).toContain(START);
  });

  it('GET /owned/:id/permissions is 200 with ok:false and the fix', async () => {
    const { status, body } = await mod().call('GET', `/owned/${SESSION}/permissions`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: false, error: { code: 'daemon-not-running', hint: expect.stringContaining(START) } });
  });

  it.each(writes().map((entry) => entry.name))('write %s: 409 with the fix, nothing is sent anywhere', async (name) => {
    const route = writes().find((entry) => entry.name === name)!;
    const { status, body } = await mod().call(route.method, route.path, { body: route.body });
    expect(status).toBe(409);
    expect(body).toMatchObject({ ok: false, error: { code: 'daemon-not-running', hint: expect.stringContaining(START) } });
  });

  it('a config.port that names a daemon that is gone says so (it died without cleaning up) and gives the same fix', async () => {
    const dead = await startFakeDaemon(box.config);
    await dead.stop();
    const { body } = await mod().call('GET', '/owned');
    expect(body).toMatchObject({ ok: false, error: { code: 'daemon-not-running', message: expect.stringContaining('nothing listens there'), hint: expect.stringContaining(START) } });
  });

  it('a config.port that is not a port file is reported with the file name and what to do (not "not running")', async () => {
    writeFileSync(join(box.config, 'config.port'), 'not json');
    const { body } = await mod().call('GET', '/owned');
    expect(body.error).toMatchObject({ code: 'daemon-unreachable', message: expect.stringContaining('config.port'), hint: expect.stringContaining(START) });
  });
});

describe('the daemon answers', () => {
  it('GET /owned lists the owned sessions with the daemon status; the daemon is called with the bearer token and no Origin', async () => {
    const fake = await up();
    const { status, body } = await mod().call('GET', '/owned');
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, daemon: { pid: process.pid, owned: { total: 1 }, apiPort: fake.port }, sessions: [{ id: SESSION, hostKind: 'stream-json', state: 'idle', name: 'x1' }] });
    expect(fake.requests.length).toBeGreaterThan(0);
    for (const request of fake.requests) {
      expect(request.headers.authorization).toBe(`Bearer ${fake.token}`);
      expect(request.headers.origin).toBeUndefined();
      expect(request.headers.host).toBe(`127.0.0.1:${fake.port}`);
    }
    // The token is in no answer of the module.
    expect(JSON.stringify(body)).not.toContain(fake.token);
  });

  it('a wrong token (the file and the daemon disagree) is a visible error naming the fix, on a read and on a write', async () => {
    const fake = await up();
    writeFileSync(join(box.config, 'health_token'), 'another-token');
    const read = await mod().call('GET', '/owned');
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ ok: false, error: { code: 'daemon-unauthorized', hint: expect.stringContaining(START) } });
    const write = await mod().call('POST', `/owned/${SESSION}/stop`);
    expect(write.status).toBe(502);
    expect(write.body.error.code).toBe('daemon-unauthorized');
    expect(JSON.stringify([read.body, write.body])).not.toContain('another-token');
    expect(JSON.stringify([read.body, write.body])).not.toContain(fake.token);
  });

  it('launch checks the body here (unknown field, missing folder, folder that does not exist: 400, the daemon is not called) and forwards a valid one', async () => {
    const fake = await up();
    const m = mod();
    const before = fake.requests.length;
    expect((await m.call('POST', '/owned/launch', { body: { hostKind: 'stream-json', cwd: box.data, color: 'red' } })).body.error).toMatchObject({ code: 'unknown-field' });
    expect((await m.call('POST', '/owned/launch', { body: { hostKind: 'vscode', cwd: box.data } })).body.error.code).toBe('invalid-host-kind');
    const missing = await m.call('POST', '/owned/launch', { body: { hostKind: 'stream-json', cwd: join(box.data, 'nope') } });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatchObject({ code: 'cwd-missing', hint: expect.stringContaining('create the folder') });
    expect((await m.call('POST', '/owned/launch', { body: 'text' })).status).toBe(400);
    expect(fake.requests.length).toBe(before);

    const ok = await m.call('POST', '/owned/launch', { body: { hostKind: 'hc', cwd: box.data, name: 'probe', model: 'haiku', permissionMode: 'plan' } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, session: { hostKind: 'hc', name: 'probe', model: 'haiku', permissionMode: 'plan' } });
    expect(fake.requests.at(-1)).toMatchObject({ method: 'POST', path: '/sessions/launch', body: { hostKind: 'hc', cwd: box.data, name: 'probe', model: 'haiku', permissionMode: 'plan' } });
  });

  it('interrupt, permission-mode, stop, resume and forget reach the daemon and answer its result', async () => {
    const fake = await up();
    const m = mod();
    expect((await m.call('POST', `/owned/${SESSION}/interrupt`)).body).toEqual({ ok: true, sessionId: SESSION, stillQueued: [], cancelled: [] });
    expect((await m.call('POST', `/owned/${SESSION}/permission-mode`, { body: { mode: 'acceptEdits' } })).body).toEqual({ ok: true, sessionId: SESSION, mode: 'acceptEdits' });
    expect(fake.requests.at(-1)).toMatchObject({ path: `/sessions/${SESSION}/permission-mode`, body: { mode: 'acceptEdits' } });
    expect((await m.call('POST', `/owned/${SESSION}/stop`)).body).toMatchObject({ ok: true, session: { id: SESSION, state: 'exited' } });
    expect((await m.call('POST', `/owned/${SESSION}/resume`, { body: { acknowledgeLeftover: true } })).body).toMatchObject({ ok: true, session: { state: 'idle' } });
    expect(fake.requests.at(-1)).toMatchObject({ path: `/sessions/${SESSION}/resume`, body: { acknowledgeLeftover: true } });
    expect((await m.call('POST', `/owned/${SESSION}/stop`)).status).toBe(200);
    expect((await m.call('POST', `/owned/${SESSION}/forget`)).body).toEqual({ ok: true, id: SESSION });
    expect(fake.sessions).toEqual([]);
  });

  it('a refusal of the daemon keeps its status, code and fix; a failure of the daemon is a 502 with its fix', async () => {
    const fake = await up();
    const m = mod();
    fake.fail.set(`POST /sessions/${SESSION}/forget`, { status: 409, code: 'session-live', reason: 'the session is live', fix: 'stop it first' });
    const conflict = await m.call('POST', `/owned/${SESSION}/forget`);
    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual({ ok: false, error: { code: 'session-live', message: 'the session is live', hint: 'stop it first' } });
    fake.fail.set(`POST /sessions/${SESSION}/stop`, { status: 500, code: 'kill-failed', reason: 'could not end pid 4242', fix: 'end it in the task manager' });
    const broken = await m.call('POST', `/owned/${SESSION}/stop`);
    expect(broken.status).toBe(502);
    expect(broken.body.error).toMatchObject({ code: 'kill-failed', hint: 'end it in the task manager' });
    const unknown = await m.call('POST', `/owned/${ID(99)}/stop`);
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('unknown-session');
  });

  it('a timeout of a write says that it may still have been done', async () => {
    const fake = await up();
    // A server that accepts and never answers, in the place of the daemon.
    const hang = createServer(() => undefined);
    await new Promise<void>((resolve) => hang.listen(0, '127.0.0.1', resolve));
    const hangPort = (hang.address() as { port: number }).port;
    // The /version of the fake points the module at the hanging port.
    const versionServer = createServer((_req, res) => res.end(JSON.stringify({ apiPort: hangPort, pid: process.pid })));
    await new Promise<void>((resolve) => versionServer.listen(0, '127.0.0.1', resolve));
    writeFileSync(join(box.config, 'config.port'), JSON.stringify({ port: (versionServer.address() as { port: number }).port, pid: process.pid }));
    const slow = makeModule({ dataDir: box.data, options: { daemon: createDaemonApi({ cacheMs: 0, timeoutMs: 150 }) } });
    const { status, body } = await slow.call('POST', `/owned/${SESSION}/interrupt`);
    hang.closeAllConnections();
    hang.close();
    versionServer.close();
    expect(status).toBe(502);
    expect(body.error).toMatchObject({ code: 'daemon-unreachable', message: expect.stringContaining('may still have done it') });
    expect(fake.requests).toEqual([]);
  });

  it('permissions: the list is read from the daemon, a decision is forwarded (allow without a message, deny with the default or given reason)', async () => {
    const fake = await up();
    fake.permissions[SESSION] = [
      { requestId: 'req-1', toolName: 'Bash', input: { command: 'touch x' }, permissionSuggestions: [], receivedAt: 5 },
      { requestId: 'req-2', toolName: 'Write', input: { file_path: 'a' }, permissionSuggestions: [], receivedAt: 6 },
      { requestId: 'req-3', toolName: 'Edit', input: {}, permissionSuggestions: [], receivedAt: 7 },
    ];
    const m = mod();
    const list = await m.call('GET', `/owned/${SESSION}/permissions`);
    expect(list.body).toMatchObject({ ok: true, sessionId: SESSION, permissions: [{ requestId: 'req-1', toolName: 'Bash', input: { command: 'touch x' } }, { requestId: 'req-2' }, { requestId: 'req-3' }] });
    expect((await m.call('POST', `/owned/${SESSION}/permissions/req-1`, { body: { decision: 'allow' } })).body).toEqual({ ok: true, sessionId: SESSION, requestId: 'req-1', decision: 'allow' });
    expect(fake.requests.at(-1)?.body).toEqual({ decision: 'allow' });
    await m.call('POST', `/owned/${SESSION}/permissions/req-2`, { body: { decision: 'deny' } });
    expect(fake.requests.at(-1)?.body).toEqual({ decision: 'deny', message: 'Denied by the user through agent-manager' });
    await m.call('POST', `/owned/${SESSION}/permissions/req-3`, { body: { decision: 'deny', message: 'not here' } });
    expect(fake.requests.at(-1)?.body).toEqual({ decision: 'deny', message: 'not here' });
    // Already answered: the daemon's 404 with its code.
    const again = await m.call('POST', `/owned/${SESSION}/permissions/req-1`, { body: { decision: 'allow' } });
    expect(again.status).toBe(404);
    expect(again.body.error.code).toBe('unknown-permission-request');
  });

  it('a bad body or id is a 400 with the fix and never reaches the daemon', async () => {
    const fake = await up();
    const m = mod();
    const before = fake.requests.length;
    expect((await m.call('POST', `/owned/${SESSION}/permissions/req-1`, { body: { decision: 'maybe' } })).body.error.code).toBe('invalid-decision');
    expect((await m.call('POST', `/owned/${SESSION}/permissions/req-1`, { body: { decision: 'allow', message: 'why' } })).body.error.code).toBe('invalid-field');
    expect((await m.call('POST', `/owned/${SESSION}/permission-mode`, { body: { mode: 'rm -rf' } })).status).toBe(400);
    expect((await m.call('POST', `/owned/${SESSION}/permission-mode`, { body: {} })).status).toBe(400);
    expect((await m.call('POST', '/owned/not-an-id/stop')).body.error).toMatchObject({ code: 'invalid-id', hint: expect.stringContaining('GET /owned') });
    expect((await m.call('POST', `/owned/${SESSION}/permissions/bad%20id`, { body: { decision: 'allow' } })).body.error.code).toBe('invalid-id');
    expect((await m.call('POST', `/owned/${SESSION}/stop`, { body: { force: true } })).status).toBe(400);
    expect((await m.call('POST', `/owned/${SESSION}/resume`, { body: { acknowledgeLeftover: 'yes' } })).status).toBe(400);
    expect((await m.call('POST', `/owned/${SESSION}/resume`, { body: { other: 1 } })).status).toBe(400);
    expect((await m.call('GET', '/owned/not-an-id/permissions')).body.error.code).toBe('invalid-id');
    expect(fake.requests.length).toBe(before);
  });

  it('after a restart of the daemon on other ports, the next call finds it again (no stale endpoint)', async () => {
    const first = await up();
    const m = mod();
    expect((await m.call('GET', '/owned')).body.ok).toBe(true);
    await first.stop();
    const second = await startFakeDaemon(box.config, { token: 'second-token-abcdef0123456789' });
    daemon = second;
    second.sessions.push(ownedView({ id: ID(8) }));
    const again = await m.call('GET', '/owned');
    expect(again.body).toMatchObject({ ok: true, sessions: [{ id: ID(8) }] });
    // The files are gone: not running, again.
    await second.stopCleanly();
    rmSync(join(box.config, 'config.port'), { force: true });
    expect((await m.call('GET', '/owned')).body.error.code).toBe('daemon-not-running');
  });
});

describe('write routes need the web UI (T-08), like the other write routes', () => {
  const NO_SITE = { 'sec-fetch-site': undefined };
  const NO_TOKEN = { 'x-agent-manager-csrf': undefined };

  it.each(writes().map((entry) => entry.name))('%s: 403 without Sec-Fetch-Site and without the token header; the daemon receives nothing', async (name) => {
    const fake = await up();
    const route = writes().find((entry) => entry.name === name)!;
    const m = mod();
    for (const headers of [NO_SITE, NO_TOKEN, { 'sec-fetch-site': 'cross-site' }, { 'x-agent-manager-csrf': 'abc.def' }]) {
      const answer = await m.call(route.method, route.path, { body: route.body, headers });
      expect(answer.status).toBe(403);
      expect(answer.body.error.code).toMatch(/^csrf-/);
    }
    expect(fake.requests).toEqual([]);
  });

  it('the GET routes need neither header', async () => {
    await up();
    const m = mod();
    expect((await m.call('GET', '/owned', { headers: { ...NO_SITE, ...NO_TOKEN } })).status).toBe(200);
    expect((await m.call('GET', `/owned/${SESSION}/permissions`, { headers: { ...NO_SITE, ...NO_TOKEN } })).status).toBe(200);
  });
});
