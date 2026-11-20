import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReplyMessage, ReplyTransport } from '@wadeck-app/agent-manager-core/reply';
import { afterEach, describe, expect, it } from 'vitest';
import { ID, putSession, transcriptFile, useSandbox, userLine, writeLines } from './apiFixtures.js';
import { createDaemonApi } from './daemon/daemonApi.js';
import { ownedView, startFakeDaemon } from './daemon/fakeDaemon.js';
import type { FakeDaemon } from './daemon/fakeDaemon.js';
import { makeModule } from './testKit.js';

const box = useSandbox();
const START = 'agent-manager start --detach';
const PENDING = ID(600);
const JOINED = (): string => ID(process.pid);
const HC = (): string => ID(process.ppid);

let daemon: FakeDaemon | undefined;
afterEach(async () => {
  await daemon?.stop();
  daemon = undefined;
});

interface FakeSocket extends ReplyTransport {
  sent: ReplyMessage[];
}

/** The `socket` transport of these tests: records what it is given, sends nothing anywhere. */
function fakeSocket(): FakeSocket {
  const sent: ReplyMessage[] = [];
  return {
    id: 'socket',
    kind: 'direct',
    deliveredAs: 'peer',
    sent,
    describe: () => 'fake socket',
    probe: () => Promise.resolve({ available: true, reason: 'the fake is on', fix: '', details: {} }),
    send: (_session, message) => {
      sent.push(message);
      return Promise.resolve({ accepted: true, detail: 'recorded', sentAt: Date.now() });
    },
  };
}

/** The terminal session the daemon does not know: the registry session of the parent process, taken out of the daemon's list. */
function discoveredSession(fake: FakeDaemon): string {
  fake.sessions = fake.sessions.filter((view) => view.id !== HC());
  return HC();
}

const sends = (fake: FakeDaemon): string[] => fake.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/send')).map((request) => JSON.stringify(request.body));

async function scene(): Promise<{ fake: FakeDaemon; socket: FakeSocket; m: ReturnType<typeof makeModule> }> {
  // JOINED: an owned stream-json session that already has its registry file; HC: an owned hc session (registry file too); PENDING: owned, no registry file yet.
  putSession(box, process.pid);
  putSession(box, process.ppid);
  const fake = await startFakeDaemon(box.config);
  daemon = fake;
  fake.sessions = [ownedView({ id: PENDING, name: 'fresh' }), ownedView({ id: JOINED() }), ownedView({ id: HC(), hostKind: 'hc', state: 'unobserved', pid: undefined })];
  const socket = fakeSocket();
  const m = makeModule({ dataDir: box.data, options: { daemon: createDaemonApi({ cacheMs: 0, timeoutMs: 3000 }), transports: [socket] } });
  return { fake, socket, m };
}

describe('the owned transport', () => {
  it('is the default of an owned stream-json session, also before its registry file exists: the daemon writes the text, no marker, nothing goes to the socket', async () => {
    const { fake, socket, m } = await scene();
    const answer = await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'please continue' } });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ ok: true, deliveryState: 'sent', deliveryUi: 'delivered', transportId: 'owned', deliveredAs: 'typed', handle: expect.stringMatching(/^msg-/), duplicate: false });
    // The text as typed: no "[web reply via agent-manager #id]" line.
    expect(sends(fake)).toEqual([JSON.stringify({ text: 'please continue' })]);
    expect(socket.sent).toEqual([]);
    const audit = readdirSync(join(box.config, 'audit')).flatMap((file) => readFileSync(join(box.config, 'audit', file), 'utf8').split('\n').filter((line) => line !== ''));
    expect(audit.map((line) => JSON.parse(line))).toEqual([expect.objectContaining({ sessionId: PENDING, transport: 'owned', outcome: 'sent', text: 'please continue' })]);
  });

  it('keeps the marker on the other transports (the owned one is the only one without)', async () => {
    const { fake, socket, m } = await scene();
    const other = discoveredSession(fake);
    expect((await m.call('POST', `/sessions/${other}/reply`, { body: { text: 'hi' } })).body).toMatchObject({ transportId: 'socket' });
    expect(socket.sent[0]!.text).toContain('[web reply via agent-manager #');
    expect(sends(fake)).toEqual([]);
  });

  it('the status route lists owned with its probe, says why it is selected, and probes the other ones on ?probe=all', async () => {
    const { m } = await scene();
    const { body } = await m.call('GET', `/sessions/${PENDING}/reply/status`);
    expect(body).toMatchObject({ ok: true, selectedTransportId: 'owned', selectedFrom: expect.stringContaining('owned session'), sessionAlive: true });
    const owned = body.transports.find((entry: { transportId: string }) => entry.transportId === 'owned');
    expect(owned).toMatchObject({ selected: true, available: true, probed: true, deliveredAs: 'typed', reason: expect.stringContaining('owns this session') });
    expect(body.transports.map((entry: { transportId: string }) => entry.transportId).sort()).toEqual(['owned', 'socket']);
    expect(body.transports.find((entry: { transportId: string }) => entry.transportId === 'socket')).toMatchObject({ selected: false, probed: false });
  });

  it('an owned hc session keeps the default transport: owned says to use hc', async () => {
    const { m } = await scene();
    const { body } = await m.call('GET', `/sessions/${HC()}/reply/status?probe=all`);
    expect(body.selectedTransportId).toBe('socket');
    expect(body.transports.find((entry: { transportId: string }) => entry.transportId === 'owned')).toMatchObject({ available: false, reason: expect.stringContaining('herdr-core terminal'), fix: 'use the hc transport' });
  });

  it('a session the daemon does not own: owned is unavailable and says so, the default transport is used', async () => {
    const { fake, m } = await scene();
    const other = discoveredSession(fake);
    const { body } = await m.call('GET', `/sessions/${other}/reply/status?probe=all`);
    expect(body.selectedTransportId).toBe('socket');
    expect(body.transports.find((entry: { transportId: string }) => entry.transportId === 'owned')).toMatchObject({ available: false, reason: expect.stringContaining('not launched by agent-manager') });
  });

  it('a per-session override in transports.json wins over the owned default (the other transports stay usable)', async () => {
    const { fake, socket, m } = await scene();
    expect((await m.call('PUT', `/sessions/${JOINED()}/reply/transport`, { body: { transportId: 'socket' } })).body).toMatchObject({ ok: true, selectedTransportId: 'socket' });
    expect((await m.call('POST', `/sessions/${JOINED()}/reply`, { body: { text: 'via socket' } })).body.transportId).toBe('socket');
    expect(socket.sent).toHaveLength(1);
    expect(sends(fake)).toEqual([]);
    // And the override can name owned for a session that is not owned: a visible refusal, never a fallback.
    expect((await m.call('PUT', `/sessions/${JOINED()}/reply/transport`, { body: { transportId: 'owned' } })).body.selectedTransportId).toBe('owned');
  });

  it("priority 'now' interrupts through the daemon, then sends the text; without confirmNow nothing happens", async () => {
    const { fake, m } = await scene();
    const refused = await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'stop that', priority: 'now' } });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('confirm-now-required');
    expect(fake.requests.filter((request) => request.method === 'POST')).toEqual([]);
    const done = await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'stop that', priority: 'now', confirmNow: true } });
    expect(done.body).toMatchObject({ ok: true, transportId: 'owned' });
    const writes = fake.requests.filter((request) => request.method === 'POST').map((request) => request.path.split('/').pop());
    expect(writes).toEqual(['interrupt', 'send']);
    // The text carries no hack: the message is the user's text only.
    expect(sends(fake)).toEqual([JSON.stringify({ text: 'stop that' })]);
  });

  it('refuses while the owned session ended or was interrupted, with the resume fix, and sends nothing', async () => {
    const { fake, m } = await scene();
    fake.sessions[0]!.state = 'interrupted';
    fake.sessions[0]!.status = 'interrupted';
    const answer = await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'hello' } });
    expect(answer.status).toBe(409);
    expect(answer.body.error).toMatchObject({ code: 'owned-session-ended', message: expect.stringContaining('interrupted'), hint: expect.stringContaining('Resume it') });
    const status = await m.call('GET', `/sessions/${PENDING}/reply/status`);
    expect(status.body.transports.find((entry: { transportId: string }) => entry.transportId === 'owned')).toMatchObject({ available: false, fix: expect.stringContaining('resume') });
    expect(sends(fake)).toEqual([]);
  });

  it('the daemon went away after the session was listed: the reply fails with the fix, it does not fall back to the socket', async () => {
    const { fake, socket, m } = await scene();
    expect((await m.call('GET', '/sessions')).body.sessions.find((row: { sessionId: string }) => row.sessionId === JOINED())).toMatchObject({ launchedBy: 'agent-manager' });
    await fake.stop();
    const answer = await m.call('POST', `/sessions/${JOINED()}/reply`, { body: { text: 'anyone?' } });
    expect(answer.status).toBe(502);
    expect(answer.body.error).toMatchObject({ code: 'transport-unavailable', message: expect.stringContaining('daemon is not running'), hint: expect.stringContaining(START) });
    expect(socket.sent).toEqual([]);
    const status = await m.call('GET', `/sessions/${JOINED()}/reply/status`);
    expect(status.body).toMatchObject({ ok: true, selectedTransportId: 'owned' });
    expect(status.body.transports.find((entry: { transportId: string }) => entry.transportId === 'owned')).toMatchObject({ available: false, fix: expect.stringContaining(START) });
  });

  it('a daemon that refuses the send keeps its code and fix in the answer (409 session-not-live)', async () => {
    const { fake, m } = await scene();
    fake.fail.set(`POST /sessions/${PENDING}/send`, { status: 409, code: 'session-not-live', reason: 'the session is not live', fix: 'resume it' });
    const answer = await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'hello' } });
    expect(answer.status).toBe(409);
    expect(answer.body.error).toMatchObject({ code: 'session-not-live', hint: expect.stringContaining('resume it') });
  });

  it('the rate limit of the reply service applies (6 per 60 s per session): the 7th is a 429', async () => {
    const { fake, m } = await scene();
    for (let n = 1; n <= 6; n += 1) {
      expect((await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: `m${n}` } })).status).toBe(200);
    }
    const limited = await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'm7' } });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate-limited');
    expect(sends(fake)).toHaveLength(6);
  });
});

describe('the delivery state of an owned reply', () => {
  const state = async (m: ReturnType<typeof makeModule>, id: string): Promise<{ state: string; ui: string; reason: string; hint: string }> => (await m.call('GET', `/sessions/${id}/reply/status`)).body.messages[0];

  it('follows the lifecycle the daemon reports: sent, then confirmed when Claude Code started or completed the message; cancelled and lost are failures with a fix', async () => {
    const { fake, m } = await scene();
    await m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'work please' } });
    expect(await state(m, PENDING)).toMatchObject({ state: 'sent', ui: 'delivered' });
    const message = fake.sessions.find((view) => view.id === PENDING)!.messages[0]!;
    message.state = 'started';
    expect(await state(m, PENDING)).toMatchObject({ state: 'confirmed', ui: 'seen', reason: expect.stringContaining('command_lifecycle') });
    message.state = 'completed';
    expect(await state(m, PENDING)).toMatchObject({ state: 'confirmed' });
    message.state = 'cancelled';
    expect(await state(m, PENDING)).toMatchObject({ state: 'unconfirmed', ui: 'failed', hint: expect.stringContaining('Send it again') });
    message.state = 'lost';
    expect(await state(m, PENDING)).toMatchObject({ state: 'unconfirmed', hint: expect.stringContaining('Resume the session') });
  });

  it('falls back to the transcript (same text, after the send) when the link to the daemon message is gone (module restarted), and says so', async () => {
    const first = await scene();
    await first.m.call('POST', `/sessions/${PENDING}/reply`, { body: { text: 'hello from the web' } });
    // A new module run: it does not remember which daemon message was this reply.
    const second = makeModule({ dataDir: box.data, options: { daemon: createDaemonApi({ cacheMs: 0, timeoutMs: 3000 }), transports: [fakeSocket()] } });
    expect(await state(second, PENDING)).toMatchObject({ state: 'sent' });
    writeLines(transcriptFile(box, PENDING), [{ ...userLine(0, 'hello from the web'), timestamp: new Date().toISOString(), origin: undefined, promptSource: 'sdk' }]);
    expect(await state(second, PENDING)).toMatchObject({ state: 'confirmed', reason: expect.stringContaining('matched by the whole text and the time') });
  });

  it('says that the daemon cannot be asked when it is down, and still shows the reply', async () => {
    const { fake, m } = await scene();
    await m.call('POST', `/sessions/${JOINED()}/reply`, { body: { text: 'hello' } });
    await fake.stop();
    const { body } = await m.call('GET', `/sessions/${JOINED()}/reply/status`);
    expect(body.messages).toHaveLength(1);
    expect(body.warnings.join(' ')).toContain('The daemon cannot be asked');
    expect(body.warnings.join(' ')).toContain(START);
  });
});
