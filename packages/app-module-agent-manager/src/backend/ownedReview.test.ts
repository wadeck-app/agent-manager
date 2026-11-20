import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReplyMessage, ReplyTransport } from '@wadeck-app/agent-manager-core/reply';
import { afterEach, describe, expect, it } from 'vitest';
import { ID, putSession, transcriptFile, useSandbox, userLine, writeLines } from './apiFixtures.js';
import { createDaemonApi } from './daemon/daemonApi.js';
import type { DaemonApi } from './daemon/daemonApi.js';
import { ownedView, startFakeDaemon } from './daemon/fakeDaemon.js';
import type { FakeDaemon } from './daemon/fakeDaemon.js';
import { createOwnedSource } from './daemon/ownedSource.js';
import { createPreferredTransport } from './replyRoutes.js';
import { makeModule } from './testKit.js';

const box = useSandbox();
const START = 'agent-manager start --detach';
const PENDING = ID(600);
const JOINED = (): string => ID(process.pid);

let daemon: FakeDaemon | undefined;
afterEach(async () => {
  await daemon?.stop();
  daemon = undefined;
});

const socket: ReplyTransport & { sent: ReplyMessage[] } = {
  id: 'socket',
  kind: 'direct',
  deliveredAs: 'peer',
  sent: [],
  describe: () => 'fake socket',
  probe: () => Promise.resolve({ available: true, reason: 'on', fix: '', details: {} }),
  send: () => Promise.resolve({ accepted: true, detail: 'recorded', sentAt: Date.now() }),
};

async function scene(timeoutMs = 3000, daemonApi?: DaemonApi): Promise<{ fake: FakeDaemon; m: ReturnType<typeof makeModule> }> {
  putSession(box, process.pid, { status: 'busy' });
  putSession(box, process.ppid);
  const fake = await startFakeDaemon(box.config);
  daemon = fake;
  fake.sessions = [ownedView({ id: PENDING, name: 'fresh' }), ownedView({ id: JOINED() })];
  const m = makeModule({ dataDir: box.data, options: { daemon: daemonApi ?? createDaemonApi({ cacheMs: 0, timeoutMs }), transports: [socket] } });
  return { fake, m };
}

const auditOutcomes = (): string[] =>
  readdirSync(join(box.config, 'audit'))
    .flatMap((file) => readFileSync(join(box.config, 'audit', file), 'utf8').split('\n').filter((line) => line !== ''))
    .map((line) => (JSON.parse(line) as { outcome: string }).outcome);

describe('1. a send whose outcome is not known is not a failure to retry', () => {
  it('a timeout: audited maybe-sent, shown unconfirmed with "check the log", and it still counts against the rate limit', async () => {
    const { fake, m } = await scene(200);
    fake.hang.add(`POST /sessions/${PENDING}/send`);
    const answer = await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'did it arrive?' } });
    expect(answer.status).toBe(502);
    expect(answer.body.error).toMatchObject({ code: 'daemon-unreachable', message: expect.stringContaining('may have been delivered'), hint: expect.stringContaining('check the log of the session before sending it again') });
    expect(auditOutcomes()).toEqual([expect.stringMatching(/^maybe-sent: /)]);
    const status = await m.call('GET', `/sessions/${PENDING}/reply/status`);
    expect(status.body.messages[0]).toMatchObject({ state: 'unconfirmed', ui: 'failed', hint: expect.stringContaining('Check the log') });
    // Five more: six attempts that may all have been delivered fill the window, the seventh is refused (a failure would have been refunded).
    for (let n = 0; n < 5; n += 1) {
      expect((await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: `again ${n}` } })).status).toBe(502);
    }
    expect((await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'one too many' } })).status).toBe(429);
  });

  it('a lost connection: the same, and the POST is not repeated', async () => {
    const { fake, m } = await scene();
    fake.reset.add(`POST /sessions/${PENDING}/send`);
    const answer = await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'cut' } });
    expect(answer.status).toBe(502);
    expect(answer.body.error).toMatchObject({ message: expect.stringContaining('may have been delivered') });
    expect(auditOutcomes()).toEqual([expect.stringMatching(/^maybe-sent: /)]);
    expect(fake.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/send'))).toHaveLength(1);
  });

  it('a clear refusal of the daemon is still a failure (refunded, not "maybe sent")', async () => {
    const { fake, m } = await scene();
    fake.fail.set(`POST /sessions/${PENDING}/send`, { status: 409, code: 'session-not-live', reason: 'not live', fix: 'resume it' });
    expect((await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'no' } })).status).toBe(409);
    expect(auditOutcomes()).toEqual([expect.stringMatching(/^failed: /)]);
  });
});

describe('B. an interrupt that fails before the message is not "maybe sent"', () => {
  it("priority 'now': the interrupt times out, the message was never sent: a plain failure, audited failed, the send is not attempted", async () => {
    const { fake, m } = await scene(200);
    fake.hang.add(`POST /sessions/${PENDING}/interrupt`);
    const answer = await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'stop', priority: 'now', confirmNow: true } });
    expect(answer.status).toBe(502);
    expect(answer.body.error).toMatchObject({ message: expect.stringContaining('nothing was sent'), hint: expect.stringContaining(START) });
    expect(auditOutcomes()).toEqual([expect.stringMatching(/^failed: /)]);
    expect(fake.requests.some((request) => request.path.endsWith('/send'))).toBe(false);
  });
});

describe('C. the same message id after a maybe-sent is not sent again', () => {
  it('answers outcome-unknown (409) with the fix; a new id sends; a plain failure keeps the old semantics (the same id is retried)', async () => {
    const { fake, m } = await scene(200);
    const sendsOf = (): number => fake.requests.filter((request) => request.path.endsWith('/send')).length;
    fake.hang.add(`POST /sessions/${PENDING}/send`);
    expect((await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'once', messageId: 'same-1' } })).status).toBe(502);
    fake.hang.clear();
    const again = await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'once', messageId: 'same-1' } });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'outcome-unknown', message: expect.stringContaining('unconfirmed'), hint: expect.stringContaining('new message id') });
    expect(sendsOf()).toBe(1);
    expect((await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'once', messageId: 'new-2' } })).status).toBe(200);
    expect(sendsOf()).toBe(2);
    // A failure with a clear answer: the same id may be retried.
    fake.fail.set(`POST /sessions/${PENDING}/send`, { status: 409, code: 'session-not-live', reason: 'x', fix: 'y' });
    expect((await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'retry', messageId: 'plain-3' } })).status).toBe(409);
    fake.fail.clear();
    expect((await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'retry', messageId: 'plain-3' } })).status).toBe(200);
  });
});

describe('D. the owned source can be destructured', () => {
  it('list and find work as plain functions', async () => {
    const view = ownedView({ id: PENDING });
    const stub: DaemonApi = { ...createDaemonApi(), list: () => Promise.resolve([{ ...view, messages: [] }]) as never };
    const { list, find, lastKnownHost } = createOwnedSource(stub);
    expect((await list()).ok).toBe(true);
    expect(await find(PENDING.toUpperCase())).toMatchObject({ ok: true, view: { id: PENDING } });
    expect(await find(ID(1))).toEqual({ ok: true, view: undefined });
    expect(lastKnownHost(PENDING)).toBe('stream-json');
  });
});

describe('2. a state this module does not know is shown, never an exception', () => {
  it('the list, /owned and the delivery state stay up with an unknown session state and an unknown message state', async () => {
    const { fake, m } = await scene();
    fake.sessions[0]!.state = 'quantum' as never;
    const sessions = await m.call('GET', '/sessions');
    expect(sessions.status).toBe(200);
    expect(sessions.body.sessions.find((row: { sessionId: string }) => row.sessionId === PENDING)).toMatchObject({ ownedState: 'unknown', ownedRawState: 'quantum', status: 'unknown', registryPending: true });
    expect((await m.call('GET', '/owned')).body.sessions[0]).toMatchObject({ id: PENDING, state: 'unknown', rawState: 'quantum' });
    fake.sessions[0]!.state = 'idle';
    await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'hello' } });
    fake.sessions[0]!.messages[0]!.state = 'teleported' as never;
    const status = await m.call('GET', `/sessions/${PENDING}/reply/status`);
    expect(status.status).toBe(200);
    expect(status.body.messages[0]).toMatchObject({ state: 'sent', reason: expect.stringContaining('does not know') });
    expect((await m.call('GET', '/owned')).body.sessions[0].messages[0]).toMatchObject({ state: 'unknown', rawState: 'teleported' });
  });
});

describe('3. GET /summary is joined with the owned sessions', () => {
  it('counts a pending permission as waiting, a session with no registry file yet, and the dead owned ones; ownedError is null', async () => {
    const { fake, m } = await scene();
    fake.sessions = [
      ownedView({ id: JOINED(), state: 'requires_action', pendingPermissions: 1 }),
      ownedView({ id: PENDING, state: 'running' }),
      ownedView({ id: ID(601), state: 'interrupted', status: 'interrupted' }),
    ];
    const { body } = await m.call('GET', '/summary');
    // JOINED: registry busy, the daemon says waiting (other); OTHER: idle; PENDING: busy; interrupted: dead.
    expect(body).toMatchObject({ ok: true, busy: 1, idle: 1, other: 1, alive: 3, dead: 1, ownedError: null, ownedErrorText: '' });
  });

  it('with the daemon down the registry counts stay and ownedError says why', async () => {
    putSession(box, process.ppid);
    const { body } = await makeModule({ dataDir: box.data }).call('GET', '/summary');
    expect(body).toMatchObject({ ok: true, idle: 1, alive: 1, ownedError: { code: 'daemon-not-running', hint: expect.stringContaining(START) } });
  });
});

describe('4. the transcript fallback needs the whole text, at or after the send, without an origin', () => {
  const line = (text: string, over: Record<string, unknown> = {}) => ({ ...userLine(0, text), timestamp: new Date(Date.now() + 1000).toISOString(), origin: undefined, promptSource: 'sdk', ...over });
  // A module that does not remember which daemon message was the reply (no link): only the transcript can say.
  const freshModule = () => makeModule({ dataDir: box.data, options: { daemon: createDaemonApi({ cacheMs: 0, timeoutMs: 3000 }), transports: [socket] } });
  const states = async (m: ReturnType<typeof makeModule>): Promise<string[]> => (await m.call('GET', `/sessions/${PENDING}/reply/status`)).body.messages.map((message: { state: string }) => message.state);

  it("a short reply is not confirmed by a longer line that contains it, by a line typed by a person, or by a line from before the send", async () => {
    const { m } = await scene();
    await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'ok' } });
    const fresh = freshModule();
    writeLines(transcriptFile(box, PENDING), [
      line('please say ok to everything'),
      line('ok', { origin: { kind: 'human' } }),
      line('ok', { timestamp: new Date(Date.now() - 60_000).toISOString() }),
    ]);
    expect(await states(fresh)).toEqual(['sent']);
    writeLines(transcriptFile(box, PENDING), [line('ok')], true);
    expect(await states(fresh)).toEqual(['confirmed']);
  });

  it('the whole text counts with its line endings normalized, and the composed text with its image lines; one line confirms one reply', async () => {
    const { m } = await scene();
    await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'ok' } });
    await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'ok' } });
    const fresh = freshModule();
    writeLines(transcriptFile(box, PENDING), [line('ok\r\n')]);
    // Newest first: the older of the two replies took the only line.
    expect(await states(fresh)).toEqual(['sent', 'confirmed']);
    writeLines(transcriptFile(box, PENDING), [line('ok')], true);
    expect(await states(fresh)).toEqual(['confirmed', 'confirmed']);
  });
});

describe('5. a session the service cannot see because the daemon failed says so', () => {
  it('the daemon list works for the lookup and fails inside the service: 409 naming the daemon, not a bare unknown-session', async () => {
    const { fake, m } = await scene();
    // GET /sessions calls: the route lookup (1), the check for an ended session (2); the service reads the list a third time and the daemon fails.
    fake.failListAfter = 2;
    const answer = await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'hello' } });
    expect(answer.status).toBe(409);
    expect(answer.body.error).toMatchObject({ message: expect.stringContaining('the agent-manager daemon cannot be asked') });
    expect(answer.body.error.code).not.toBe('unknown-session');
    expect(fake.requests.some((request) => request.path.endsWith('/send'))).toBe(false);
  });
});

describe('6. the preferred transport never throws', () => {
  it('a failing source is "no preference" and the problem is kept for the status answer', async () => {
    const problems = new Map<string, string>();
    const broken = { find: () => Promise.reject(new TypeError('boom')), lastKnownHost: () => undefined } as unknown as Parameters<typeof createPreferredTransport>[0];
    const preferred = createPreferredTransport(broken, problems);
    await expect(preferred({ sessionId: PENDING } as never)).resolves.toBeUndefined();
    expect(problems.get(PENDING)).toContain('boom');
    expect(problems.get(PENDING)).toContain('bug of the module');
  });

  it('a client that fails in a way that is not the daemon is data on the list (ownedError), not a 500', async () => {
    const stub: DaemonApi = { ...createDaemonApi(), list: () => Promise.reject(new TypeError('boom')) };
    putSession(box, process.ppid);
    const { status, body } = await makeModule({ dataDir: box.data, options: { daemon: stub } }).call('GET', '/sessions');
    expect(status).toBe(200);
    expect(body.ownedError).toMatchObject({ code: 'daemon-client-error', message: expect.stringContaining('boom') });
  });
});

describe('7. the seen marker names the daemon when it cannot tell', () => {
  it('404 with the fix of the daemon', async () => {
    putSession(box, process.ppid);
    const answer = await makeModule({ dataDir: box.data }).call('POST', `/sessions/${ID(999)}/seen`);
    expect(answer.status).toBe(404);
    expect(answer.body.hint ?? answer.body.error?.hint).toContain(START);
  });
});

describe('9. the answer of every write is checked', () => {
  const writes: { name: string; path: () => string; body?: unknown; key: () => string }[] = [
    { name: 'interrupt', path: () => `/owned/${PENDING}/interrupt`, key: () => `POST /sessions/${PENDING}/interrupt` },
    { name: 'permission-mode', path: () => `/owned/${PENDING}/permission-mode`, body: { mode: 'plan' }, key: () => `POST /sessions/${PENDING}/permission-mode` },
    { name: 'forget', path: () => `/owned/${PENDING}/forget`, key: () => `POST /sessions/${PENDING}/forget` },
    { name: 'stop', path: () => `/owned/${PENDING}/stop`, key: () => `POST /sessions/${PENDING}/stop` },
    { name: 'resume', path: () => `/owned/${PENDING}/resume`, key: () => `POST /sessions/${PENDING}/resume` },
    { name: 'decision', path: () => `/owned/${PENDING}/permissions/req-1`, body: { decision: 'allow' }, key: () => `POST /sessions/${PENDING}/permissions/req-1` },
  ];
  it.each(writes.map((entry) => entry.name))('%s: an answer of the wrong shape is a 502 daemon-bad-answer that says it may have been done', async (name) => {
    const { fake, m } = await scene();
    const route = writes.find((entry) => entry.name === name)!;
    fake.permissions[PENDING] = [{ requestId: 'req-1', toolName: 'Bash', input: {}, permissionSuggestions: [], receivedAt: 1 }];
    // The fake answers its error body with HTTP 200: a JSON object that has none of the fields of the real answer.
    fake.fail.set(route.key(), { status: 200, code: 'x', reason: 'x', fix: 'x' });
    const answer = await m.call('POST', route.path(), { body: route.body });
    expect(answer.status).toBe(502);
    expect(answer.body.error).toMatchObject({ code: 'daemon-bad-answer', message: expect.stringContaining('may have been done') });
  });

  it('send: the same, audited as maybe-sent', async () => {
    const { fake, m } = await scene();
    fake.fail.set(`POST /sessions/${PENDING}/send`, { status: 200, code: 'x', reason: 'x', fix: 'x' });
    expect((await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'hi' } })).status).toBe(502);
    expect(auditOutcomes()).toEqual([expect.stringMatching(/^maybe-sent: /)]);
  });
});
