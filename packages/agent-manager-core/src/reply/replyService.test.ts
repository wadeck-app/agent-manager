import { afterEach, describe, expect, it } from 'vitest';
import { getErrorMessage } from '../errors.js';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSessionRegistry } from '../readSessionRegistry.js';
import type { Session } from '../session.js';
import { removeDir } from '../testFixtures.js';
import { readAudit } from './audit.js';
import * as realFs from 'node:fs/promises';
import { wireMsgId } from './messageIds.js';
import { DEFAULT_REPLY_CONFIG, parseReplyConfig, readTransportsConfig, writeTransportsConfig } from './config.js';
import type { ReplyFs } from './fsTypes.js';
import { deliveryState } from './deliveryState.js';
import type { DeliveryRecord, ReplyTranscriptEntry } from './deliveryState.js';
import { NotImplementedError, OutcomeUnknownError, ReplyError } from './errors.js';
import { asyncRewakeTransport, herdrTransport, hotWaitTransport, queueModTransport } from './hookTransports.js';
import { createReplyService, DEFAULT_RATE_LIMIT, withDeliveredAs } from './replyService.js';
import { createSocketTransport } from './socketTransport.js';
import { FAKE_TOKEN, fakePng, makeFixture, startFakePipe } from './testSupport.js';
import type { ProbeResult, ReplyMessage, ReplyTransport, TransportKind } from './types.js';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-manager-service-'));
  cleanups.push(() => removeDir(dir));
  return dir;
}

/** A transport that records what it is given and never touches any socket. */
function fakeTransport(id: string, options: { available?: boolean; kind?: TransportKind } = {}): ReplyTransport & { sent: ReplyMessage[]; probes: number } {
  const state = { sent: [] as ReplyMessage[], probes: 0 };
  return {
    id,
    kind: options.kind ?? 'direct',
    deliveredAs: 'peer',
    describe: () => `fake ${id}`,
    probe: (): Promise<ProbeResult> => {
      state.probes++;
      return Promise.resolve(options.available === false ? { available: false, reason: `${id} is down`, fix: `start ${id}`, details: {} } : { available: true, reason: 'ok', fix: '', details: {} });
    },
    send: (_session, message) => {
      state.sent.push(message);
      return Promise.resolve({ accepted: true, detail: 'written', sentAt: 5_000 });
    },
    get sent() {
      return state.sent;
    },
    get probes() {
      return state.probes;
    },
  };
}

async function liveSession(overrides: Record<string, unknown> = {}): Promise<Session> {
  const fixture = await makeFixture({ socketPath: 'unused', platform: 'win32', token: null, overrides });
  cleanups.push(() => removeDir(fixture.dir));
  return fixture.session;
}

function serviceWith(session: Session | undefined, transports: ReplyTransport[], configDir = tempDir(), extra: { alive?: boolean } = {}) {
  return {
    configDir,
    service: createReplyService({
      configDir,
      transports,
      clock: () => 10_000,
      readSessions: () => Promise.resolve({ ok: true, dir: 'x', sessions: session === undefined ? [] : [{ ...session, alive: extra.alive ?? true }], unreadable: [] }),
    }),
  };
}

describe('ReplyService.send', () => {
  it('sends the composed text through the default socket transport and audits it', async () => {
    const session = await liveSession();
    const socket = fakeTransport('socket');
    const { service, configDir } = serviceWith(session, [socket]);
    const record = await service.send({ sessionId: session.sessionId, text: 'hello', id: 'm1' });
    expect(record).toEqual({ id: 'm1', sessionId: session.sessionId, state: 'sent', transportId: 'socket', kind: 'direct', sentAt: 5_000, priority: 'next' });
    expect(socket.sent).toEqual([{ id: 'm1', text: 'hello', imagePaths: [], priority: 'next', origin: 'web' }]);
    const audit = await readAudit(configDir);
    expect(audit.records).toEqual([{ sessionId: session.sessionId, time: 10_000, text: 'hello', imagePaths: [], transport: 'socket', priority: 'next', outcome: 'sent', msgId: 'm1' }]);
  });

  it('limits the replies per session whatever the transport, then lets the window pass', async () => {
    const session = await liveSession();
    const socket = fakeTransport('socket');
    let now = 10_000;
    const configDir = tempDir();
    const service = createReplyService({
      configDir,
      transports: [socket],
      clock: () => now,
      rateLimit: { max: 2, windowMs: 60_000 },
      readSessions: () => Promise.resolve({ ok: true, dir: 'x', sessions: [{ ...session, alive: true }], unreadable: [] }),
    });
    await service.send({ sessionId: session.sessionId, text: 'one', id: 'r1' });
    await service.send({ sessionId: session.sessionId, text: 'two', id: 'r2' });
    const refused = await service.send({ sessionId: session.sessionId, text: 'three', id: 'r3' }).catch((error: unknown) => error);
    expect(refused).toMatchObject({ code: 'rate-limited' });
    expect((refused as Error).message).toContain('wait about');
    expect(socket.sent).toHaveLength(2);
    // The refused id was not sent: it can be retried later.
    now += 60_001;
    expect((await service.send({ sessionId: session.sessionId, text: 'three', id: 'r3' })).state).toBe('sent');
  });

  it('attempts that delivered nothing (refused by the transport, bad image, unavailable) do not count: the session is never locked out by refusals', async () => {
    const session = await liveSession();
    const socket = fakeTransport('socket');
    let accept = false;
    const flaky: ReplyTransport = { ...socket, send: (_session, message) => (accept ? socket.send(_session, message) : Promise.resolve({ accepted: false, detail: 'terminal blocked', sentAt: 0 })) };
    const { service } = serviceWith(session, [flaky]);
    // One refusal more than the limit allows sends: none of them was delivered, so none counts.
    for (let index = 0; index < DEFAULT_RATE_LIMIT.max + 1; index++) {
      const refusal = await service.send({ sessionId: session.sessionId, text: 'x', id: `refused-${index}` }).catch((error: unknown) => error);
      expect(refusal).toMatchObject({ code: 'transport-refused' });
    }
    // A bad image fails before the transport: it does not count either.
    const bad = await service.send({ sessionId: session.sessionId, text: 'x', id: 'bad-image', images: [{ base64: 'not-base64!!', declaredMime: 'image/png' }] }).catch((error: unknown) => error);
    expect(bad).toBeInstanceOf(ReplyError);
    accept = true;
    expect((await service.send({ sessionId: session.sessionId, text: 'ok', id: 'valid-1' })).state).toBe('sent');
  });

  it('real sends are limited: the limit-th send passes, the next one is rate-limited', async () => {
    const session = await liveSession();
    const socket = fakeTransport('socket');
    const { service } = serviceWith(session, [socket]);
    for (let index = 0; index < DEFAULT_RATE_LIMIT.max; index++) {
      expect((await service.send({ sessionId: session.sessionId, text: 'x', id: `real-${index}` })).state).toBe('sent');
    }
    const limited = await service.send({ sessionId: session.sessionId, text: 'x', id: 'real-over' }).catch((error: unknown) => error);
    expect(limited).toMatchObject({ code: 'rate-limited' });
    expect(socket.sent).toHaveLength(DEFAULT_RATE_LIMIT.max);
  });

  it('deliveryState: an explicit undefined deliveredAs from the caller does not erase the one of the transport', () => {
    expect(withDeliveredAs({ deliveredAs: undefined }, 'typed')).toMatchObject({ deliveredAs: 'typed' });
    expect(withDeliveredAs(undefined, 'peer')).toEqual({ deliveredAs: 'peer' });
    expect(withDeliveredAs({ deliveredAs: 'peer' }, 'typed')).toMatchObject({ deliveredAs: 'peer' });
    expect(withDeliveredAs({ sessionStatus: 'idle' }, undefined)).toEqual({ sessionStatus: 'idle' });
  });

  it('getTransportStatus probes only the selected transport unless every one is asked for (an hc probe spawns processes)', async () => {
    const session = await liveSession();
    const socket = fakeTransport('socket');
    const other = fakeTransport('hc');
    const { service } = serviceWith(session, [socket, other]);
    const [plain] = await service.getTransportStatus([session]);
    expect(socket.probes).toBe(1);
    expect(other.probes).toBe(0);
    expect(plain?.transports.map((entry) => [entry.transportId, entry.probed])).toEqual([['socket', true], ['hc', false]]);
    expect(plain?.transports[1]?.probe).toMatchObject({ available: false, details: { notProbed: true } });
    const [all] = await service.getTransportStatus([session], { probe: 'all' });
    expect(other.probes).toBe(1);
    expect(all?.transports.every((entry) => entry.probed)).toBe(true);
  });

  it('saves the images and adds one line per image', async () => {
    const session = await liveSession();
    const socket = fakeTransport('socket');
    const { service, configDir } = serviceWith(session, [socket]);
    await service.send({ sessionId: session.sessionId, text: 'look', id: 'm2', images: [{ base64: fakePng().toString('base64'), declaredMime: 'image/png' }] });
    const saved = join(configDir, 'uploads', session.sessionId, 'm2-0.png');
    expect(readdirSync(join(configDir, 'uploads', session.sessionId))).toEqual(['m2-0.png']);
    expect(socket.sent[0]?.text).toBe(`look\nThe user attached an image: ${saved}. Read it.`);
    expect(socket.sent[0]?.imagePaths).toEqual([saved]);
  });

  it('never sends the same id twice: in memory, concurrently, and after a restart (audit)', async () => {
    const session = await liveSession();
    const socket = fakeTransport('socket');
    const { service, configDir } = serviceWith(session, [socket]);
    const [first, second] = await Promise.all([service.send({ sessionId: session.sessionId, text: 'a', id: 'dup' }), service.send({ sessionId: session.sessionId, text: 'a', id: 'dup' })]);
    expect(socket.sent).toHaveLength(1);
    expect([first.duplicate, second.duplicate].filter(Boolean)).toHaveLength(1);
    expect((await service.send({ sessionId: session.sessionId, text: 'a', id: 'dup' })).duplicate).toBe(true);
    // a new service instance (daemon restart) with the same audit folder
    const restarted = fakeTransport('socket');
    const again = serviceWith(session, [restarted], configDir);
    const duplicate = await again.service.send({ sessionId: session.sessionId, text: 'a', id: 'dup' });
    expect(duplicate).toMatchObject({ id: 'dup', duplicate: true, transportId: 'socket', state: 'sent' });
    expect(restarted.sent).toHaveLength(0);
  });

  it('lets a failed id be retried (nothing was sent)', async () => {
    const session = await liveSession();
    let fail = true;
    const flaky: ReplyTransport = {
      ...fakeTransport('socket'),
      send: () => (fail ? Promise.reject(new ReplyError('pipe-refused', 'refused', 'retry')) : Promise.resolve({ accepted: true, detail: 'ok', sentAt: 1 })),
    };
    const { service, configDir } = serviceWith(session, [flaky]);
    await expect(service.send({ sessionId: session.sessionId, text: 'a', id: 'retry' })).rejects.toThrow(/refused/);
    fail = false;
    expect((await service.send({ sessionId: session.sessionId, text: 'a', id: 'retry' })).duplicate).toBeUndefined();
    expect((await readAudit(configDir)).records.map((r) => r.outcome.split(':')[0])).toEqual(['sent', 'failed']);
  });

  it("requires confirmNow for priority 'now' and sends nothing without it", async () => {
    const session = await liveSession();
    const socket = fakeTransport('socket');
    const { service } = serviceWith(session, [socket]);
    await expect(service.send({ sessionId: session.sessionId, text: 'stop', priority: 'now' })).rejects.toMatchObject({ code: 'confirm-now-required' });
    await expect(service.send({ sessionId: session.sessionId, text: 'stop', priority: 'now', confirmNow: false })).rejects.toMatchObject({ code: 'confirm-now-required' });
    expect(socket.sent).toHaveLength(0);
    expect(socket.probes).toBe(0);
    await service.send({ sessionId: session.sessionId, text: 'stop', priority: 'now', confirmNow: true });
    expect(socket.sent[0]?.priority).toBe('now');
  });

  it('rejects an unknown priority, an oversized text and an unsafe id before anything else', async () => {
    const session = await liveSession();
    const { service } = serviceWith(session, [fakeTransport('socket')]);
    await expect(service.send({ sessionId: session.sessionId, text: 'a', priority: 'urgent' as 'now' })).rejects.toMatchObject({ code: 'invalid-priority' });
    await expect(service.send({ sessionId: session.sessionId, text: 'x'.repeat(20_001) })).rejects.toMatchObject({ code: 'text-too-long' });
    await expect(service.send({ sessionId: session.sessionId, text: 'a', id: '../x' })).rejects.toMatchObject({ code: 'invalid-id' });
    await expect(service.send({ sessionId: '../x', text: 'a' })).rejects.toMatchObject({ code: 'invalid-id' });
  });

  it('picks explicit > per-session override > global default > socket', async () => {
    const session = await liveSession();
    const socket = fakeTransport('socket');
    const other = fakeTransport('other');
    const third = fakeTransport('third');
    const { service, configDir } = serviceWith(session, [socket, other, third]);
    expect((await service.send({ sessionId: session.sessionId, text: 'a', id: 'x1' })).transportId).toBe('socket');
    await writeTransportsConfig(configDir, { default: 'other', perSession: {} });
    expect((await service.send({ sessionId: session.sessionId, text: 'a', id: 'x2' })).transportId).toBe('other');
    await writeTransportsConfig(configDir, { default: 'other', perSession: { [session.sessionId]: 'third' } });
    expect((await service.send({ sessionId: session.sessionId, text: 'a', id: 'x3' })).transportId).toBe('third');
    expect((await service.send({ sessionId: session.sessionId, text: 'a', id: 'x4', transportId: 'socket' })).transportId).toBe('socket');
    await expect(service.send({ sessionId: session.sessionId, text: 'a', id: 'x5', transportId: 'nope' })).rejects.toMatchObject({ code: 'unknown-transport' });
  });

  it('has no silent fallback: an unavailable transport is an error with the probe reason and fix, and nothing is sent or saved', async () => {
    const session = await liveSession();
    const down = fakeTransport('socket', { available: false });
    const up = fakeTransport('other');
    const { service, configDir } = serviceWith(session, [down, up]);
    const error = (await service.send({ sessionId: session.sessionId, text: 'a', id: 'u1', images: [{ base64: fakePng().toString('base64') }] }).catch((e: unknown) => e)) as ReplyError;
    expect(error.code).toBe('transport-unavailable');
    expect(getErrorMessage(error)).toContain('socket is down');
    expect(getErrorMessage(error)).toContain('start socket');
    expect(down.sent).toHaveLength(0);
    expect(up.sent).toHaveLength(0);
    expect(up.probes).toBe(0);
    expect(() => readdirSync(join(configDir, 'uploads'))).toThrow();
    expect((await readAudit(configDir)).records[0]?.outcome).toMatch(/^refused: .*socket is down/);
  });

  it('refuses a dead or unknown session', async () => {
    const session = await liveSession();
    const dead = serviceWith(session, [fakeTransport('socket')], undefined, { alive: false });
    await expect(dead.service.send({ sessionId: session.sessionId, text: 'a' })).rejects.toMatchObject({ code: 'session-dead' });
    const none = serviceWith(undefined, [fakeTransport('socket')]);
    await expect(none.service.send({ sessionId: session.sessionId, text: 'a' })).rejects.toMatchObject({ code: 'unknown-session' });
  });

  it('a hook transport stub is refused with its reason, never a fake success', async () => {
    const session = await liveSession();
    const { service } = serviceWith(session, [fakeTransport('socket'), asyncRewakeTransport]);
    const error = (await service.send({ sessionId: session.sessionId, text: 'a', transportId: 'async-rewake' }).catch((e: unknown) => e)) as ReplyError;
    expect(error.code).toBe('transport-unavailable');
    expect(getErrorMessage(error)).toMatch(/not implemented yet/);
    expect(getErrorMessage(error)).toMatch(/M4/);
  });

  it('a mailbox transport gives the state queued', async () => {
    const session = await liveSession();
    const { service } = serviceWith(session, [fakeTransport('socket', { kind: 'mailbox' })]);
    expect((await service.send({ sessionId: session.sessionId, text: 'a' })).state).toBe('queued');
  });

  it('works end to end with the socket transport against a fake pipe, and the token is nowhere in the outputs', async () => {
    const pipe = await startFakePipe();
    cleanups.push(() => pipe.close());
    const fixture = await makeFixture({ socketPath: pipe.path, platform: 'win32', settings: { crossSessionInbound: 'accept' } });
    cleanups.push(() => removeDir(fixture.dir));
    const socket = createSocketTransport({ sessionsDir: fixture.dir, settingsPath: fixture.settingsPath, platform: 'win32', graceMs: 50 });
    const configDir = tempDir();
    const service = createReplyService({ configDir, transports: [socket], sessionsDir: fixture.dir });
    const registry = await readSessionRegistry(fixture.dir);
    expect(registry.ok).toBe(true);
    const record = await service.send({ sessionId: fixture.sessionId, text: 'ping', id: 'e2e-1' });
    expect(pipe.lines).toHaveLength(2);
    expect(JSON.parse(pipe.lines[1] as string)).toMatchObject({ type: 'user', msg_id: wireMsgId('e2e-1'), priority: 'next', session_id: fixture.sessionId });
    const status = await service.getTransportStatus([fixture.session]);
    const everything = JSON.stringify([record, status, (await readAudit(configDir)).records]);
    expect(everything).not.toContain(FAKE_TOKEN);
    expect(readFileSync(join(configDir, 'audit', readdirSync(join(configDir, 'audit'))[0] as string), 'utf8')).not.toContain(FAKE_TOKEN);
  });
});

describe('ReplyService.getTransportStatus', () => {
  it('returns every transport probe (when asked for all) per session, including the stubs, and passes the permission mode', async () => {
    const session = await liveSession();
    const socket = fakeTransport('socket');
    const { service, configDir } = serviceWith(session, [socket, asyncRewakeTransport, hotWaitTransport, queueModTransport, herdrTransport]);
    await writeTransportsConfig(configDir, { default: 'socket', perSession: { [session.sessionId]: 'herdr' } });
    const status = await service.getTransportStatus([session], { probe: 'all' });
    expect(status).toHaveLength(1);
    expect(status[0]?.selectedTransportId).toBe('herdr');
    expect(status[0]?.transports.map((t) => [t.transportId, t.probe.available])).toEqual([
      ['socket', true],
      ['async-rewake', false],
      ['hot-wait', false],
      ['queue-mod', false],
      ['herdr', false],
    ]);
    expect(status[0]?.transports[1]?.probe.reason).toBe('not implemented yet');
  });

  it('turns a probe that throws into an unavailable answer', async () => {
    const session = await liveSession();
    const broken: ReplyTransport = { ...fakeTransport('socket'), probe: () => Promise.reject(new Error('boom')) };
    const { service } = serviceWith(session, [broken]);
    const status = await service.getTransportStatus([session]);
    expect(status[0]?.transports[0]?.probe).toMatchObject({ available: false, reason: expect.stringContaining('boom') });
  });
});

describe('hook transport stubs', () => {
  it.each([asyncRewakeTransport, hotWaitTransport, queueModTransport, herdrTransport])('$id: probe says not implemented, send throws NotImplementedError', async (transport) => {
    const session = await liveSession();
    const probe = await transport.probe(session);
    expect(probe).toMatchObject({ available: false, reason: 'not implemented yet' });
    expect(probe.fix).toMatch(/M4/);
    expect(transport.describe()).toMatch(/NOT IMPLEMENTED/);
    await expect(transport.send(session, { id: 'a', text: 't', imagePaths: [], priority: 'next', origin: 'web' })).rejects.toBeInstanceOf(NotImplementedError);
  });
});

describe('deliveryState', () => {
  const record = (overrides: Partial<DeliveryRecord> = {}): DeliveryRecord => ({ id: 'm1', sessionId: 's', state: 'sent', transportId: 'socket', kind: 'direct', sentAt: 1_000_000, priority: 'next', ...overrides });
  const marker = '[web reply via agent-manager #m1]';
  const userLine = (content: unknown, timestamp = new Date(1_001_000).toISOString()): ReplyTranscriptEntry => ({ type: 'user', timestamp, message: { role: 'user', content } });
  const config = DEFAULT_REPLY_CONFIG;

  it('starts at the record state', () => {
    expect(deliveryState(record(), [], 1_000_500, config).state).toBe('sent');
    expect(deliveryState(record({ state: 'queued', kind: 'mailbox' }), [], 1_000_500, config).state).toBe('queued');
  });

  it('goes to queued-in-session on a queue-operation enqueue holding the marker, and ignores other enqueues', () => {
    const unrelated: ReplyTranscriptEntry = { type: 'queue-operation', operation: 'enqueue', content: '<task-notification>x</task-notification>' };
    const mine: ReplyTranscriptEntry = { type: 'queue-operation', operation: 'enqueue', content: `${marker}\nhello` };
    expect(deliveryState(record(), [unrelated], 1_000_500, config).state).toBe('sent');
    expect(deliveryState(record(), [unrelated, mine], 1_000_500, config).state).toBe('queued-in-session');
    expect(deliveryState(record(), [{ ...mine, operation: 'dequeue' }], 1_000_500, config).state).toBe('sent');
  });

  it('is confirmed by a user line with the marker (string or text parts), and not by another id', () => {
    expect(deliveryState(record(), [userLine(`${marker}\nhello`)], 1_001_500, config).state).toBe('confirmed');
    expect(deliveryState(record(), [userLine([{ type: 'text', text: `${marker}\nhello` }])], 1_001_500, config).state).toBe('confirmed');
    expect(deliveryState(record(), [userLine('[web reply via agent-manager #m10]\nhello')], 1_001_500, config).state).toBe('sent');
    expect(deliveryState(record(), [{ type: 'assistant', message: { content: marker } }], 1_001_500, config).state).toBe('sent');
  });

  it('confirmed wins over queued-in-session, even after the hint or expiry', () => {
    const entries: ReplyTranscriptEntry[] = [{ type: 'queue-operation', operation: 'enqueue', content: marker }, userLine(marker)];
    expect(deliveryState(record(), entries, 9_000_000, config, { sessionStatus: 'idle' }).state).toBe('confirmed');
    expect(deliveryState(record({ kind: 'mailbox', state: 'queued' }), [userLine(marker)], 9_000_000, config).state).toBe('confirmed');
  });

  it('shows the hint (unconfirmed) after hintAfter when idle and the transcript did not grow, never before, never when busy or growing', () => {
    const idle = { sessionStatus: 'idle' as const };
    expect(deliveryState(record(), [], 1_014_000, config, idle).state).toBe('sent');
    const hinted = deliveryState(record(), [], 1_016_000, config, idle);
    expect(hinted.state).toBe('unconfirmed');
    expect(hinted.hint).toMatch(/probably not delivered/);
    expect(hinted.hint).toMatch(/crossSessionInbound/);
    expect(deliveryState(record(), [], 1_016_000, config, { sessionStatus: 'busy' }).state).toBe('sent');
    expect(deliveryState(record(), [], 1_016_000, config).state).toBe('sent');
    const grew: ReplyTranscriptEntry = { type: 'assistant', timestamp: new Date(1_005_000).toISOString() };
    expect(deliveryState(record(), [grew], 1_016_000, config, idle).state).toBe('sent');
    const before: ReplyTranscriptEntry = { type: 'assistant', timestamp: new Date(900_000).toISOString() };
    expect(deliveryState(record(), [before], 1_016_000, config, idle).state).toBe('unconfirmed');
  });

  it('uses a configured hintAfter and a confirmation window', () => {
    const custom = parseReplyConfig({ hintAfter: '2s', confirmationWindow: '1m' });
    expect(deliveryState(record(), [], 1_003_000, custom, { sessionStatus: 'idle' }).state).toBe('unconfirmed');
    expect(deliveryState(record(), [], 1_030_000, custom, { sessionStatus: 'busy' }).state).toBe('sent');
    expect(deliveryState(record(), [], 1_061_000, custom, { sessionStatus: 'busy' }).state).toBe('unconfirmed');
    // window 0 = never a timeout from the window
    expect(deliveryState(record(), [], 99_000_000, config, { sessionStatus: 'busy' }).state).toBe('sent');
  });

  it('expires a mailbox reply after mailboxExpiry, never a direct one', () => {
    const mailbox = record({ kind: 'mailbox', state: 'queued' });
    expect(deliveryState(mailbox, [], 1_000_000 + 14 * 60_000, config).state).toBe('queued');
    expect(deliveryState(mailbox, [], 1_000_000 + 16 * 60_000, config).state).toBe('expired');
    expect(deliveryState(record(), [], 1_000_000 + 16 * 60_000, config).state).toBe('sent');
    expect(deliveryState(mailbox, [], 1_000_000 + 99 * 60_000, parseReplyConfig({ mailboxExpiry: '0' })).state).toBe('queued');
  });

  it('is exposed on the service with its clock and config', async () => {
    const session = await liveSession();
    const { service } = serviceWith(session, [fakeTransport('socket')]);
    expect(service.deliveryState(record({ sentAt: 9_999 }), [], undefined).state).toBe('sent');
  });
});

describe('parseReplyConfig', () => {
  it('has the documented defaults', () => {
    expect(parseReplyConfig()).toEqual({ confirmationWindowMs: 0, hintAfterMs: 15_000, mailboxExpiryMs: 900_000 });
  });
  it('parses durations and accepts a YAML number 0', () => {
    expect(parseReplyConfig({ confirmationWindow: '1h5m30s', hintAfter: '30s', mailboxExpiry: 0 })).toEqual({ confirmationWindowMs: 3_930_000, hintAfterMs: 30_000, mailboxExpiryMs: 0 });
  });
  it('rejects a bad value with the parser message and the key', () => {
    expect(() => parseReplyConfig({ hintAfter: '15' })).toThrow(/hintAfter: invalid duration '15': '15' has no unit/);
    expect(() => parseReplyConfig({ mailboxExpiry: '5x' })).toThrow(/mailboxExpiry: invalid duration '5x': unknown unit 'x'/);
  });
});

describe('transports.json', () => {
  it('reports a damaged file instead of falling back to the default', async () => {
    const session = await liveSession();
    const configDir = tempDir();
    writeFileSync(join(configDir, 'transports.json'), '{ nope');
    const { service } = serviceWith(session, [fakeTransport('socket')], configDir);
    await expect(service.send({ sessionId: session.sessionId, text: 'a' })).rejects.toMatchObject({ code: 'transports-invalid' });
  });
});

describe('ReplyService.send: failure handling', () => {
  function failingFs(options: { failAppend?: boolean; failUnlink?: boolean } = {}): ReplyFs {
    return {
      ...realFs,
      appendFile: ((...args: Parameters<typeof realFs.appendFile>) => (options.failAppend === true ? Promise.reject(new Error('disk full')) : realFs.appendFile(...args))) as ReplyFs['appendFile'],
      unlink: ((...args: Parameters<typeof realFs.unlink>) => (options.failUnlink === true ? Promise.reject(new Error('locked by another process')) : realFs.unlink(...args))) as ReplyFs['unlink'],
    };
  }
  function serviceWithFs(session: Session, transports: ReplyTransport[], fs: ReplyFs, extra: { maxSentEntries?: number; clock?: () => number } = {}) {
    const configDir = tempDir();
    return {
      configDir,
      service: createReplyService({
        configDir,
        transports,
        fs,
        clock: extra.clock ?? (() => 10_000),
        maxSentEntries: extra.maxSentEntries,
        readSessions: () => Promise.resolve({ ok: true, dir: 'x', sessions: [{ ...session, alive: true }], unreadable: [] }),
      }),
    };
  }

  it('a failing audit write after a successful send returns the record with auditError and the id never sends twice', async () => {
    const session = await liveSession();
    const socket = fakeTransport('socket');
    const { service } = serviceWithFs(session, [socket], failingFs({ failAppend: true }));
    const record = await service.send({ sessionId: session.sessionId, text: 'a', id: 'aud1' });
    expect(record).toMatchObject({ id: 'aud1', state: 'sent', transportId: 'socket' });
    expect(record.auditError?.message).toContain('disk full');
    expect(record.auditError?.fix).toMatch(/audit folder/);
    const again = await service.send({ sessionId: session.sessionId, text: 'a', id: 'aud1' });
    expect(again).toMatchObject({ id: 'aud1', duplicate: true });
    expect(socket.sent).toHaveLength(1);
  });

  it('a failing audit write of the failure path keeps the original error code and attaches auditError', async () => {
    const session = await liveSession();
    const down = fakeTransport('socket', { available: false });
    const { service } = serviceWithFs(session, [down], failingFs({ failAppend: true }));
    const error = (await service.send({ sessionId: session.sessionId, text: 'a', id: 'aud2' }).catch((e: unknown) => e)) as ReplyError & { auditError?: { message: string; fix: string } };
    expect(error.code).toBe('transport-unavailable');
    expect(getErrorMessage(error)).toContain('socket is down');
    expect(error.auditError?.message).toContain('disk full');
    expect(error.auditError?.fix).toMatch(/audit folder/);
  });

  it('removes the uploads of the message when the send fails, and keeps them when it succeeds', async () => {
    const session = await liveSession();
    let fail = false;
    const flaky: ReplyTransport = {
      ...fakeTransport('socket'),
      send: () => (fail ? Promise.reject(new ReplyError('pipe-refused', 'refused', 'retry')) : Promise.resolve({ accepted: true, detail: 'ok', sentAt: 1 })),
    };
    const { service, configDir } = serviceWithFs(session, [flaky], realFs);
    const png = fakePng().toString('base64');
    const folder = join(configDir, 'uploads', session.sessionId);
    await service.send({ sessionId: session.sessionId, text: 'keep', id: 'keepme', images: [{ base64: png }] });
    expect(readdirSync(folder)).toEqual(['keepme-0.png']);
    fail = true;
    await expect(service.send({ sessionId: session.sessionId, text: 'a', id: 'gone', images: [{ base64: png }, { base64: png }] })).rejects.toMatchObject({ code: 'pipe-refused' });
    // only the files of the failed message are gone
    expect(readdirSync(folder)).toEqual(['keepme-0.png']);
  });

  it('removes the images already saved when a later image of the message is refused', async () => {
    const session = await liveSession();
    const { service, configDir } = serviceWithFs(session, [fakeTransport('socket')], realFs);
    const png = fakePng().toString('base64');
    await expect(service.send({ sessionId: session.sessionId, text: 'a', id: 'half', images: [{ base64: png }, { base64: 'not base64!' }] })).rejects.toMatchObject({ code: 'invalid-base64' });
    expect(readdirSync(join(configDir, 'uploads', session.sessionId))).toEqual([]);
  });

  it('reports in the error text an upload that could not be removed', async () => {
    const session = await liveSession();
    const failing: ReplyTransport = { ...fakeTransport('socket'), send: () => Promise.reject(new ReplyError('pipe-refused', 'refused', 'retry')) };
    const { service } = serviceWithFs(session, [failing], failingFs({ failUnlink: true }));
    const error = (await service.send({ sessionId: session.sessionId, text: 'a', id: 'stuck', images: [{ base64: fakePng().toString('base64') }] }).catch((e: unknown) => e)) as ReplyError;
    expect(error.code).toBe('pipe-refused');
    expect(getErrorMessage(error)).toContain('could not be removed');
    expect(getErrorMessage(error)).toContain('stuck-0.png');
    expect(getErrorMessage(error)).toContain('locked by another process');
  });

  it('bounds the in-memory sent ids: an evicted id is still deduplicated by the audit file', async () => {
    const session = await liveSession();
    const socket = fakeTransport('socket');
    const { service } = serviceWithFs(session, [socket], realFs, { maxSentEntries: 2 });
    for (const id of ['e1', 'e2', 'e3', 'e4']) {
      await service.send({ sessionId: session.sessionId, text: 'a', id });
    }
    expect(socket.sent).toHaveLength(4);
    // e1 was evicted from memory: the audit answers, nothing is sent again
    expect(await service.send({ sessionId: session.sessionId, text: 'a', id: 'e1' })).toMatchObject({ id: 'e1', duplicate: true });
    expect(socket.sent).toHaveLength(4);
  });

  it('forgets a settled id after 24 h in memory, the audit still dedupes it', async () => {
    const session = await liveSession();
    const socket = fakeTransport('socket');
    let now = 10_000;
    const { service } = serviceWithFs(session, [socket], realFs, { clock: () => now });
    await service.send({ sessionId: session.sessionId, text: 'a', id: 'old' });
    now += 25 * 60 * 60_000;
    expect(await service.send({ sessionId: session.sessionId, text: 'a', id: 'old' })).toMatchObject({ duplicate: true });
    expect(socket.sent).toHaveLength(1);
  });
});

describe('ReplyService: preferredTransport and marker none', () => {
  it('a transport with marker none gets the text as typed whatever the setting; the others follow replyMarker', async () => {
    const session = await liveSession();
    const plain = { ...fakeTransport('plain'), marker: 'none' as const };
    const socket = fakeTransport('socket');
    const { service, configDir } = serviceWith(session, [socket, plain]);
    writeFileSync(join(configDir, 'config.yml'), 'replyMarker: full\n');
    await service.send({ sessionId: session.sessionId, text: 'hello', id: 'p1', transportId: 'plain' });
    await service.send({ sessionId: session.sessionId, text: 'hello', id: 's1' });
    expect(plain.sent[0]!.text).toBe('hello');
    expect(socket.sent[0]!.text).toBe('[web reply via agent-manager #s1]\nhello');
  });

  it('the preferred transport sits between the per-session override and the global default; an explicit transport wins over all', async () => {
    const session = await liveSession();
    const socket = fakeTransport('socket');
    const owned = fakeTransport('owned');
    const other = fakeTransport('other');
    const configDir = tempDir();
    const service = createReplyService({
      configDir,
      transports: [socket, owned, other],
      clock: () => 10_000,
      readSessions: () => Promise.resolve({ ok: true, dir: 'x', sessions: [{ ...session, alive: true }], unreadable: [] }),
      preferredTransport: (candidate) => (candidate.sessionId === session.sessionId ? 'owned' : undefined),
    });
    expect((await service.send({ sessionId: session.sessionId, text: 'a', id: 'a1' })).transportId).toBe('owned');
    expect((await service.getTransportStatus([session]))[0]).toMatchObject({ selectedTransportId: 'owned', defaultTransportId: 'socket', sessionOverrideTransportId: null });
    expect((await service.send({ sessionId: session.sessionId, text: 'b', id: 'b1', transportId: 'other' })).transportId).toBe('other');
    await writeTransportsConfig(configDir, { default: 'socket', perSession: { [session.sessionId]: 'other' } });
    expect((await service.send({ sessionId: session.sessionId, text: 'c', id: 'c1' })).transportId).toBe('other');
    expect((await service.getTransportStatus([session]))[0]).toMatchObject({ selectedTransportId: 'other', sessionOverrideTransportId: 'other' });
  });

  it('a preferred transport that is not offered is the error "unknown-transport" (no silent fallback)', async () => {
    const session = await liveSession();
    const service = createReplyService({
      configDir: tempDir(),
      transports: [fakeTransport('socket')],
      clock: () => 10_000,
      readSessions: () => Promise.resolve({ ok: true, dir: 'x', sessions: [{ ...session, alive: true }], unreadable: [] }),
      preferredTransport: () => 'owned',
    });
    expect(await service.send({ sessionId: session.sessionId, text: 'a', id: 'a1' }).catch((error: unknown) => error)).toMatchObject({ code: 'unknown-transport' });
  });
});

describe('ReplyService: a send with an unknown outcome', () => {
  it('is audited maybe-sent, is not refunded from the rate limit and keeps its uploads', async () => {
    const session = await liveSession();
    const unsure: ReplyTransport = { ...fakeTransport('socket'), send: () => Promise.reject(new OutcomeUnknownError('daemon-unreachable', 'the daemon did not answer', 'check the log')) };
    const configDir = tempDir();
    const service = createReplyService({
      configDir,
      transports: [unsure],
      clock: () => 10_000,
      rateLimit: { max: 2, windowMs: 60_000 },
      readSessions: () => Promise.resolve({ ok: true, dir: 'x', sessions: [{ ...session, alive: true }], unreadable: [] }),
    });
    const first = await service.send({ sessionId: session.sessionId, text: 'a', id: 'u1', images: [{ base64: fakePng().toString('base64'), declaredMime: 'image/png' }] }).catch((error: unknown) => error);
    expect(first).toBeInstanceOf(OutcomeUnknownError);
    expect((await readAudit(configDir)).records.map((record) => record.outcome)).toEqual([expect.stringMatching(/^maybe-sent: /)]);
    expect(readdirSync(join(configDir, 'uploads', session.sessionId))).toHaveLength(1);
    await service.send({ sessionId: session.sessionId, text: 'b', id: 'u2' }).catch(() => undefined);
    expect(await service.send({ sessionId: session.sessionId, text: 'c', id: 'u3' }).catch((error: unknown) => error)).toMatchObject({ code: 'rate-limited' });
  });
});

describe('writeTransportsConfig', () => {
  it('two concurrent writes both succeed, leave a valid file and no temp file', async () => {
    const configDir = tempDir();
    await Promise.all([
      writeTransportsConfig(configDir, { default: 'a', perSession: {} }),
      writeTransportsConfig(configDir, { default: 'b', perSession: { s: 'a' } }),
      writeTransportsConfig(configDir, { default: 'c', perSession: {} }),
    ]);
    expect(await readTransportsConfig(configDir)).toEqual({ default: 'c', perSession: {} });
    expect(readdirSync(configDir)).toEqual(['transports.json']);
  });
});
