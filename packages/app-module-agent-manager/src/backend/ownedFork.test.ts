import { afterEach, describe, expect, it } from 'vitest';
import { ID, putSession, useSandbox } from './apiFixtures.js';
import { createDaemonApi } from './daemon/daemonApi.js';
import { ownedView, startFakeDaemon } from './daemon/fakeDaemon.js';
import type { FakeDaemon } from './daemon/fakeDaemon.js';
import { MAX_NAME_CHARS } from '@wadeck-app/agent-manager-core/launch';
import { FORK_NAME_MAX, forkNameOf } from '../commons/forkName.js';
import { makeModule } from './testKit.js';

const box = useSandbox();
const START = 'agent-manager start --detach';
const OWNED = ID(7);
const DISCOVERED_PID = 4100;

let daemon: FakeDaemon | undefined;
afterEach(async () => {
  await daemon?.stop();
  daemon = undefined;
});

const mod = () => makeModule({ dataDir: box.data, options: { daemon: createDaemonApi({ cacheMs: 0, timeoutMs: 3000 }) } });

describe('POST /owned/fork', () => {
  it('forks a discovered session: a new stream-json launch with forkOf, in the same folder, named "fork of <name>"', async () => {
    daemon = await startFakeDaemon(box.config);
    const id = putSession(box, DISCOVERED_PID, { cwd: box.data, name: 'terminal one' });
    const { status, body } = await mod().call('POST', '/owned/fork', { body: { sourceSessionId: id } });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, session: { hostKind: 'stream-json', cwd: box.data, name: 'fork of terminal one', forkedFrom: id } });
    expect(daemon.requests.at(-1)).toMatchObject({ method: 'POST', path: '/sessions/launch', body: { hostKind: 'stream-json', cwd: box.data, forkOf: id, name: 'fork of terminal one' } });
    // No model or mode is invented for a session whose record is unknown: Claude Code decides.
    expect(daemon.requests.at(-1)?.body).not.toHaveProperty('model');
    expect(daemon.requests.at(-1)?.body).not.toHaveProperty('permissionMode');
  });

  it('an owned source gives its model and permission mode as defaults, and a body value wins', async () => {
    daemon = await startFakeDaemon(box.config);
    const id = putSession(box, 4101, { cwd: box.data });
    daemon.sessions.push(ownedView({ id, cwd: box.data, name: 'x1', model: 'haiku', permissionMode: 'plan' }));
    const m = mod();
    const inherited = await m.call('POST', '/owned/fork', { body: { sourceSessionId: id } });
    expect(inherited.body).toMatchObject({ ok: true, session: { model: 'haiku', permissionMode: 'plan', name: 'fork of x1', forkedFrom: id } });
    const chosen = await m.call('POST', '/owned/fork', { body: { sourceSessionId: id, name: 'try B', model: 'sonnet', permissionMode: 'default' } });
    expect(chosen.body).toMatchObject({ ok: true, session: { model: 'sonnet', permissionMode: 'default', name: 'try B' } });
  });

  it('forks an owned session that has no registry file yet only when it exists in the daemon, and a bg or hc source works (only its transcript is read)', async () => {
    daemon = await startFakeDaemon(box.config);
    daemon.sessions.push(ownedView({ id: OWNED, hostKind: 'bg', cwd: box.data, name: 'bg one', jobId: 'abc12345' }));
    const forked = await mod().call('POST', '/owned/fork', { body: { sourceSessionId: OWNED } });
    expect(forked.status).toBe(200);
    // The fork is always a Web session, whatever hosts the source.
    expect(forked.body).toMatchObject({ ok: true, session: { hostKind: 'stream-json', forkedFrom: OWNED, name: 'fork of bg one' } });
  });

  it('refuses a body that is not what the route takes, with a fix, without calling the daemon', async () => {
    daemon = await startFakeDaemon(box.config);
    const m = mod();
    const before = daemon.requests.length;
    for (const [body, code] of [
      [{}, 'bad-request'],
      [{ sourceSessionId: OWNED, cwd: '/elsewhere' }, 'bad-request'],
      [{ sourceSessionId: '' }, 'bad-request'],
      ['text', 'bad-request'],
      [{ sourceSessionId: '../x' }, 'unknown-session'],
    ] as const) {
      const answer = await m.call('POST', '/owned/fork', { body });
      expect(answer.status, JSON.stringify(body)).toBe(code === 'unknown-session' ? 404 : 400);
      expect(answer.body.error.code).toBe(code);
      expect(answer.body.error.hint.length).toBeGreaterThan(10);
    }
    expect(daemon.requests.length).toBe(before);
  });

  it('an unknown source is a 404 that says so; a folder that is gone is a 400 (the fork needs the folder of the source)', async () => {
    daemon = await startFakeDaemon(box.config);
    const m = mod();
    const unknown = await m.call('POST', '/owned/fork', { body: { sourceSessionId: ID(999) } });
    expect(unknown.status).toBe(404);
    const id = putSession(box, 4102, { cwd: `${box.data}/gone-folder` });
    const gone = await m.call('POST', '/owned/fork', { body: { sourceSessionId: id } });
    expect(gone.status).toBe(400);
    expect(gone.body.error).toMatchObject({ code: 'cwd-missing', hint: expect.stringContaining('create the folder') });
  });

  it('keeps the refusal of the daemon (source without transcript: 404 with its fix), and says the daemon is not running with the command to start it', async () => {
    daemon = await startFakeDaemon(box.config);
    const id = putSession(box, 4103, { cwd: box.data });
    daemon.fail.set('POST /sessions/launch', { status: 404, code: 'fork-source-not-found', reason: 'the session to fork has no transcript on this machine', fix: 'it cannot be forked until it has a message' });
    const refused = await mod().call('POST', '/owned/fork', { body: { sourceSessionId: id } });
    expect(refused.status).toBe(404);
    expect(refused.body.error).toMatchObject({ code: 'fork-source-not-found', hint: expect.stringContaining('cannot be forked') });
    await daemon.stopCleanly();
    daemon = undefined;
    const down = await mod().call('POST', '/owned/fork', { body: { sourceSessionId: id } });
    expect(down.status).toBe(409);
    expect(down.body.error).toMatchObject({ code: 'daemon-not-running', hint: expect.stringContaining(START) });
  });

  it('is sensitive (PIN) and needs the CSRF header like every write route', async () => {
    const answer = await makeModule().call('POST', '/owned/fork', { body: { sourceSessionId: OWNED }, headers: { 'sec-fetch-site': undefined } });
    expect(answer.status).toBe(403);
    expect(answer.body).toMatchObject({ ok: false, error: { code: 'csrf-required' } });
  });
});

describe('POST /owned/fork: no silent defaults', () => {
  it('a registry name with a line break gives a valid single-line default name (the daemon would refuse the raw one)', async () => {
    daemon = await startFakeDaemon(box.config);
    const id = putSession(box, 4105, { cwd: box.data, name: 'two\nlines' });
    const answer = await mod().call('POST', '/owned/fork', { body: { sourceSessionId: id } });
    expect(answer.status).toBe(200);
    expect(daemon.requests.at(-1)?.body).toMatchObject({ name: 'fork of two lines' });
  });

  it('answers what was taken from the record of the source, and nothing for what the caller chose', async () => {
    daemon = await startFakeDaemon(box.config);
    const id = putSession(box, 4106, { cwd: box.data });
    daemon.sessions.push(ownedView({ id, cwd: box.data, model: 'haiku', permissionMode: 'plan' }));
    const m = mod();
    expect((await m.call('POST', '/owned/fork', { body: { sourceSessionId: id } })).body.inherited).toEqual({ model: 'haiku', permissionMode: 'plan' });
    expect((await m.call('POST', '/owned/fork', { body: { sourceSessionId: id, model: 'opus' } })).body.inherited).toEqual({ permissionMode: 'plan' });
    // A discovered source inherits nothing: the answer says so with an empty object.
    const discovered = putSession(box, 4107, { cwd: box.data });
    expect((await m.call('POST', '/owned/fork', { body: { sourceSessionId: discovered } })).body.inherited).toEqual({});
  });

  it('when the daemon cannot say what the source runs with, the fork is refused with the reason and the hint, and nothing is launched', async () => {
    daemon = await startFakeDaemon(box.config);
    const id = putSession(box, 4108, { cwd: box.data });
    daemon.fail.set('GET /sessions', { status: 500, code: 'host-broken', reason: 'the host is broken', fix: 'restart the daemon' });
    const answer = await mod().call('POST', '/owned/fork', { body: { sourceSessionId: id } });
    expect(answer.status).toBe(502);
    expect(answer.body.error).toMatchObject({ message: expect.stringContaining('could not be asked about the session to fork'), hint: expect.stringContaining('restart the daemon') });
    expect(daemon.requests.some((request) => request.path === '/sessions/launch')).toBe(false);
  });
});

describe('GET /sessions shows where a fork comes from', () => {
  it('an owned fork row carries forkedFrom (also while it has no registry file), a plain row does not', async () => {
    daemon = await startFakeDaemon(box.config);
    // A live pid (the parent of the test runner) so that the discovered row is listed.
    const sourceId = putSession(box, process.ppid, { cwd: box.data });
    daemon.sessions.push(ownedView({ id: ID(600), cwd: box.data, name: 'fork of x', forkedFrom: sourceId }), ownedView({ id: ID(601), cwd: box.data, name: 'plain' }));
    const { body } = await mod().call('GET', '/sessions');
    const rows = body.sessions as { sessionId: string; forkedFrom?: string }[];
    expect(rows.find((row) => row.sessionId === ID(600))?.forkedFrom).toBe(sourceId);
    expect(rows.find((row) => row.sessionId === ID(601))).not.toHaveProperty('forkedFrom');
    expect(rows.find((row) => row.sessionId === sourceId)).not.toHaveProperty('forkedFrom');
  });
});

describe('forkNameOf (one helper for the route and the dialog)', () => {
  it('prefixes the name and keeps it within the limit the daemon accepts, which is the one of core', () => {
    expect(FORK_NAME_MAX).toBe(MAX_NAME_CHARS);
    expect(forkNameOf('shop')).toBe('fork of shop');
    const long = forkNameOf('x'.repeat(200));
    expect(long).toHaveLength(FORK_NAME_MAX);
    expect(long.endsWith('...')).toBe(true);
  });

  it('turns line breaks and control characters into one space, and never leaves an empty name', () => {
    expect(forkNameOf('my\nsession\t\u0007  two')).toBe('fork of my session two');
    expect(forkNameOf('\n\r')).toBe('fork of session');
  });
});
