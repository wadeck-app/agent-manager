import { afterEach, describe, expect, it } from 'vitest';
import { ID, putSession, useSandbox } from './apiFixtures.js';
import { createDaemonApi } from './daemon/daemonApi.js';
import { ownedView, startFakeDaemon } from './daemon/fakeDaemon.js';
import type { FakeDaemon } from './daemon/fakeDaemon.js';
import { makeModule } from './testKit.js';

const box = useSandbox();
const START = 'agent-manager start --detach';
const DISCOVERED_ID = (): string => ID(process.ppid);
const JOINED_ID = (): string => ID(process.pid);
const PENDING = ID(500);
const INTERRUPTED = ID(501);
const EXITED = ID(502);
const STOPPED = ID(503);

let daemon: FakeDaemon | undefined;
afterEach(async () => {
  await daemon?.stop();
  daemon = undefined;
});

const mod = (cacheMs = 0) => makeModule({ dataDir: box.data, options: { daemon: createDaemonApi({ cacheMs, timeoutMs: 3000 }) } });

/** A registry with one discovered session and one the daemon owns, and a daemon that also knows three owned sessions with no registry file. */
async function scene(): Promise<FakeDaemon> {
  putSession(box, process.ppid, { name: 'terminal one' });
  putSession(box, process.pid, { status: 'busy', statusUpdatedAt: Date.now() - 60_000 });
  daemon = await startFakeDaemon(box.config);
  daemon.sessions = [
    ownedView({ id: JOINED_ID(), state: 'requires_action', pendingPermissions: 2, name: 'x1 joined' }),
    ownedView({ id: PENDING, state: 'running', cwd: '/work/pending', name: 'fresh', startedAt: Date.now() - 5_000 }),
    ownedView({ id: INTERRUPTED, state: 'interrupted', status: 'interrupted', resumable: true, cwd: '/work/lost', interruptedAt: Date.now() - 1000, pid: undefined }),
    // Stopped by the user: resumable (the stop dialog promises it stays listed).
    ownedView({ id: STOPPED, state: 'exited', status: 'exited', resumable: true, cwd: '/work/stopped', exit: { cause: 'closed', code: 0, signal: null, by: 'user', stderrTail: '', at: Date.now() - 3000 } }),
    ownedView({ id: EXITED, state: 'exited', status: 'exited', cwd: '/work/gone', exit: { cause: 'closed', code: 0, signal: null, by: 'user', stderrTail: '', at: Date.now() - 2000 } }),
  ];
  return daemon;
}

type Row = Record<string, unknown> & { sessionId: string };
const rowOf = (body: { sessions: Row[] }, id: string): Row | undefined => body.sessions.find((row) => row.sessionId === id);

describe('GET /sessions joins the registry with the owned sessions', () => {
  it('a discovered row says so; an owned row with a registry file carries the daemon state and is corrected when the daemon knows better', async () => {
    await scene();
    const { status, body } = await mod().call('GET', '/sessions');
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, ownedError: null, ownedErrorText: '' });
    const discovered = rowOf(body, DISCOVERED_ID())!;
    expect(discovered).toMatchObject({ launchedBy: 'discovered', host: null, pendingPermissions: 0 });
    expect(discovered).not.toHaveProperty('ownedId');
    expect(discovered).not.toHaveProperty('ownedState');
    expect(discovered).not.toHaveProperty('registryPending');
    // The registry said busy; the daemon says a permission request waits: the row is `needs-you` at once.
    expect(rowOf(body, JOINED_ID())).toMatchObject({ launchedBy: 'agent-manager', ownedId: JOINED_ID(), host: 'stream-json', ownedState: 'requires_action', pendingPermissions: 2, status: 'waiting', reason: 'permission prompt', state: 'needs-you' });
    expect(rowOf(body, JOINED_ID())).not.toHaveProperty('registryPending');
  });

  it('an owned session with no registry file is listed from its record alone, flagged registryPending, with no transcript and no crash', async () => {
    await scene();
    const { body } = await mod().call('GET', '/sessions');
    const pending = rowOf(body, PENDING)!;
    expect(pending).toMatchObject({ launchedBy: 'agent-manager', ownedId: PENDING, host: 'stream-json', ownedState: 'running', registryPending: true, alive: true, pid: 4242, cwd: '/work/pending', folder: 'pending', displayName: 'fresh', status: 'busy', state: 'working', version: '2.1.326', harness: 'Claude Code 2.1.326', subagentCount: 0, lastActivity: '' });
    expect(pending['activityNote']).toBe('No transcript yet');
    expect(pending['statusNote']).toEqual(expect.any(String));
    expect(pending).not.toHaveProperty('model');
  });

  it('an interrupted owned session and a resumable exited one (stopped by the user) stay in the default list; another exited one is only listed with show=all', async () => {
    await scene();
    const m = mod();
    const alive = (await m.call('GET', '/sessions')).body;
    expect(alive.sessions.map((row: Row) => row.sessionId).sort()).toEqual([DISCOVERED_ID(), JOINED_ID(), PENDING, INTERRUPTED, STOPPED].sort());
    expect(rowOf(alive, STOPPED)).toMatchObject({ ownedState: 'exited', alive: false, state: 'ended', registryPending: true });
    expect(rowOf(alive, INTERRUPTED)).toMatchObject({ ownedState: 'interrupted', alive: false, state: 'ended', registryPending: true, pid: 0, status: 'interrupted' });
    expect(alive.hiddenDead).toBe(1);
    expect(rowOf(alive, EXITED)).toBeUndefined();
    const all = (await m.call('GET', '/sessions?show=all')).body;
    expect(rowOf(all, EXITED)).toMatchObject({ ownedState: 'exited', alive: false, registryPending: true });
    expect(all.hiddenDead).toBe(0);
  });

  it('the list asks the daemon once per cache window however many requests; a write drops the cache', async () => {
    const fake = await scene();
    const m = mod(60_000);
    const lists = (): number => fake.requests.filter((request) => request.method === 'GET' && request.path === '/sessions').length;
    await m.call('GET', '/sessions');
    await m.call('GET', '/sessions');
    await m.call('GET', '/sessions?show=all');
    expect(lists()).toBe(1);
    await m.call('POST', `/owned/${JOINED_ID()}/interrupt`);
    await m.call('GET', '/sessions');
    expect(lists()).toBe(2);
  });

  it('a daemon that is not running is data: the registry rows stay (all discovered), ownedError says why and how to fix it', async () => {
    putSession(box, process.ppid);
    const { status, body } = await mod().call('GET', '/sessions');
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, ownedError: { code: 'daemon-not-running', hint: expect.stringContaining(START) } });
    expect(body.ownedErrorText).toContain(START);
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toMatchObject({ launchedBy: 'discovered', host: null, pendingPermissions: 0 });
  });

  it('a daemon that answers with something unusable is reported (daemon-bad-answer), not swallowed', async () => {
    putSession(box, process.ppid);
    const fake = await startFakeDaemon(box.config);
    daemon = fake;
    fake.fail.set('GET /sessions', { status: 200, code: 'x', reason: 'x', fix: 'x' });
    // A 200 whose body has no "sessions" list: the fake answers its error shape with status 200.
    const { body } = await mod().call('GET', '/sessions');
    expect(body.ownedError).toMatchObject({ code: 'daemon-bad-answer', hint: expect.stringContaining('agent-manager') });
  });

  it('the log, the log locate and the seen marker work for a session that has no registry file yet', async () => {
    await scene();
    const m = mod();
    const log = await m.call('GET', `/sessions/${PENDING}/log`);
    expect(log.status).toBe(200);
    expect(log.body).toMatchObject({ ok: true, sessionId: PENDING, entries: [] });
    expect((await m.call('GET', `/sessions/${PENDING}/log/locate?toolUseId=toolu_1`)).body).toMatchObject({ ok: true, found: false });
    expect((await m.call('POST', `/sessions/${PENDING}/seen`)).status).toBe(200);
  });

  it('an unknown id is a 404; when the daemon cannot be asked, the 404 says so and gives the fix', async () => {
    putSession(box, process.ppid);
    const m = mod();
    const down = await m.call('GET', `/sessions/${ID(900)}/log`);
    expect(down.status).toBe(404);
    expect(down.body.error.hint).toContain(START);
    daemon = await startFakeDaemon(box.config);
    const up = await m.call('GET', `/sessions/${ID(900)}/log`);
    expect(up.status).toBe(404);
    expect(up.body.error.hint).not.toContain(START);
  });
});
