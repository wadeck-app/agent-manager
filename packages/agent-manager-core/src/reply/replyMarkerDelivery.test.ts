// D-2026-11-19-a: the replyMarker setting (none | short | full) changes what is sent, never how a delivery is confirmed.
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDir } from '../testFixtures.js';
import type { Session } from '../session.js';
import { readAudit } from './audit.js';
import { composeMessageText } from './compose.js';
import { DEFAULT_REPLY_CONFIG } from './config.js';
import { deliveryState } from './deliveryState.js';
import type { DeliveryContext, DeliveryRecord, ReplyTranscriptEntry } from './deliveryState.js';
import { wireMsgId } from './messageIds.js';
import { createReplyService } from './replyService.js';
import { fakePng, makeFixture } from './testSupport.js';
import type { ReplyMessage, ReplyTransport } from './types.js';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-manager-marker-delivery-'));
  cleanups.push(() => removeDir(dir));
  return dir;
}
async function liveSession(): Promise<Session> {
  const fixture = await makeFixture({ socketPath: 'unused', platform: 'win32', token: null, overrides: {} });
  cleanups.push(() => removeDir(fixture.dir));
  return fixture.session;
}
function fakeTransport(id: string, extra: Partial<ReplyTransport> = {}, sendResult: { started?: boolean } = {}): ReplyTransport & { sent: ReplyMessage[] } {
  const sent: ReplyMessage[] = [];
  return {
    id,
    kind: 'direct',
    deliveredAs: 'peer',
    describe: () => `fake ${id}`,
    probe: () => Promise.resolve({ available: true, reason: 'ok', fix: '', details: {} }),
    send: (_session, message) => {
      sent.push(message);
      return Promise.resolve({ accepted: true, detail: 'written', sentAt: 5_000, ...sendResult });
    },
    sent,
    ...extra,
  };
}
function serviceFor(session: Session, transports: ReplyTransport[], configDir = tempDir()) {
  return {
    configDir,
    service: createReplyService({ configDir, transports, clock: () => 10_000, readSessions: () => Promise.resolve({ ok: true, dir: 'x', sessions: [{ ...session, alive: true }], unreadable: [] }) }),
  };
}

describe('replyMarker in the reply service', () => {
  it('sends the text as typed by default (no config.yml)', async () => {
    const session = await liveSession();
    const socket = fakeTransport('socket');
    const { service } = serviceFor(session, [socket]);
    await service.send({ sessionId: session.sessionId, text: 'hello', id: 'm1' });
    expect(socket.sent[0]!.text).toBe('hello');
    expect(await service.getReplyMarker()).toMatchObject({ mode: 'none', source: 'default' });
  });

  it.each([
    ['short', '[agent-manager-web #m1]\nhello'],
    ['full', '[web reply via agent-manager #m1]\nhello'],
    ['none', 'hello'],
  ])('replyMarker %s in config.yml is applied to the next reply, read at each send', async (mode, expected) => {
    const session = await liveSession();
    const socket = fakeTransport('socket');
    const { service, configDir } = serviceFor(session, [socket]);
    writeFileSync(join(configDir, 'config.yml'), `replyMarker: ${mode}\n`);
    await service.send({ sessionId: session.sessionId, text: 'hello', id: 'm1' });
    expect(socket.sent[0]!.text).toBe(expected);
    // A change applies to the next reply without rebuilding the service.
    writeFileSync(join(configDir, 'config.yml'), 'replyMarker: full\n');
    await service.send({ sessionId: session.sessionId, text: 'again', id: 'm2' });
    expect(socket.sent[1]!.text).toBe('[web reply via agent-manager #m2]\nagain');
  });

  it('the per-transport marker none wins over the setting', async () => {
    const session = await liveSession();
    const owned = fakeTransport('owned', { marker: 'none' });
    const { service, configDir } = serviceFor(session, [owned]);
    writeFileSync(join(configDir, 'config.yml'), 'replyMarker: full\n');
    await service.send({ sessionId: session.sessionId, text: 'hello', id: 'o1', transportId: 'owned' });
    expect(owned.sent[0]!.text).toBe('hello');
  });

  it('an invalid replyMarker fails the send loudly (nothing sent, audited as failed), it is never defaulted', async () => {
    const session = await liveSession();
    const socket = fakeTransport('socket');
    const { service, configDir } = serviceFor(session, [socket]);
    writeFileSync(join(configDir, 'config.yml'), 'replyMarker: loud\n');
    await expect(service.send({ sessionId: session.sessionId, text: 'hello', id: 'bad' })).rejects.toThrow(/replyMarker must be one of none, short, full, got "loud"/);
    expect(socket.sent).toEqual([]);
    expect((await readAudit(configDir)).records[0]).toMatchObject({ msgId: 'bad' });
    expect((await readAudit(configDir)).records[0]!.outcome).toMatch(/^failed: .*replyMarker must be one of/);
    await expect(service.getReplyMarker()).rejects.toMatchObject({ code: 'invalid-config' });
  });

  it('an invalid replyMarker fails BEFORE any side effect: no file saved, no rate-limit slot used', async () => {
    const session = await liveSession();
    const socket = fakeTransport('socket');
    const configDir = tempDir();
    const service = createReplyService({
      configDir,
      transports: [socket],
      clock: () => 10_000,
      rateLimit: { max: 1, windowMs: 60_000 },
      readSessions: () => Promise.resolve({ ok: true, dir: 'x', sessions: [{ ...session, alive: true }], unreadable: [] }),
    });
    writeFileSync(join(configDir, 'config.yml'), 'replyMarker: loud\n');
    await expect(service.send({ sessionId: session.sessionId, text: 'look', id: 'u1', images: [{ base64: fakePng().toString('base64'), declaredMime: 'image/png' }] })).rejects.toMatchObject({ code: 'invalid-config' });
    expect(existsSync(join(configDir, 'uploads'))).toBe(false);
    expect(socket.sent).toEqual([]);
    // The only slot of the window is still free: once the setting is fixed the very next send goes out.
    writeFileSync(join(configDir, 'config.yml'), 'replyMarker: none\n');
    await expect(service.send({ sessionId: session.sessionId, text: 'look', id: 'u2' })).resolves.toMatchObject({ id: 'u2' });
    expect(socket.sent).toHaveLength(1);
  });

  it('records the hc `started` answer in the audit', async () => {
    const session = await liveSession();
    const hc = fakeTransport('hc', { deliveredAs: 'typed' }, { started: true });
    const { service, configDir } = serviceFor(session, [hc]);
    await service.send({ sessionId: session.sessionId, text: 'hello', id: 'h1', transportId: 'hc' });
    expect((await readAudit(configDir)).records[0]).toMatchObject({ msgId: 'h1', started: true });
  });
});

describe('deliveryState without a marker', () => {
  const SENT = 1_000_000;
  const record = (overrides: Partial<DeliveryRecord> = {}): DeliveryRecord => ({ id: 'm1', sessionId: 's', state: 'sent', transportId: 'socket', kind: 'direct', sentAt: SENT, priority: 'next', ...overrides });
  const at = (ms: number): string => new Date(ms).toISOString();
  const line = (content: unknown, extra: Partial<ReplyTranscriptEntry> = {}): ReplyTranscriptEntry => ({ type: 'user', timestamp: at(SENT + 500), message: { role: 'user', content }, ...extra });
  const config = DEFAULT_REPLY_CONFIG;
  const NOW = SENT + 2_000;

  describe('socket: origin.msg_id, whatever the text', () => {
    it('is confirmed by origin.msg_id of the message with no marker in the text (id derived to a UUID)', () => {
      const entry = line('Another Claude session sent a message:\nhello', { origin: { kind: 'peer', msg_id: wireMsgId('m1') } });
      expect(deliveryState(record(), [entry], NOW, config)).toMatchObject({ state: 'confirmed', reason: expect.stringContaining('origin.msg_id') });
    });
    it('is confirmed when the message id is itself a UUID', () => {
      const id = '123e4567-e89b-42d3-a456-426614174000';
      const entry = line('hello', { origin: { kind: 'peer', msg_id: id.toUpperCase() } });
      expect(deliveryState(record({ id }), [entry], NOW, config).state).toBe('confirmed');
    });
    it('is not confirmed by another message id, even when the text is the same', () => {
      const entry = line('hello', { origin: { kind: 'peer', msg_id: wireMsgId('m2') } });
      expect(deliveryState(record({ text: 'hello' }), [entry], NOW, config, { deliveredAs: 'typed' }).state).toBe('sent');
    });
    it('a line with no id and no marker does not confirm a peer reply (nothing to match on): it stays sent', () => {
      expect(deliveryState(record({ text: 'hello' }), [line('hello')], NOW, config).state).toBe('sent');
    });
    it.each([
      ['short', '[agent-manager-web #m1]\nhello'],
      ['full', '[web reply via agent-manager #m1]\nhello'],
    ])('a %s marker still confirms a line that has no origin.msg_id (a reply sent before the setting changed)', (_mode, text) => {
      expect(deliveryState(record(), [line(text)], NOW, config).state).toBe('confirmed');
    });
    it('a short marker of another id does not confirm', () => {
      expect(deliveryState(record(), [line('[agent-manager-web #m10]\nhello')], NOW, config).state).toBe('sent');
    });
    it('queued-in-session sees a short marker in an enqueue too', () => {
      const entry: ReplyTranscriptEntry = { type: 'queue-operation', operation: 'enqueue', content: '[agent-manager-web #m1]\nhello' };
      expect(deliveryState(record(), [entry], NOW, config).state).toBe('queued-in-session');
    });
  });

  describe('hc (typed): the whole text, origin human, at or after the send, one line per reply', () => {
    const typed: DeliveryContext = { deliveredAs: 'typed' };
    const hc = (overrides: Partial<DeliveryRecord> = {}): DeliveryRecord => record({ transportId: 'hc', text: 'fix the build', imagePaths: [], ...overrides });
    const human = { kind: 'human' };

    it('is confirmed by the exact text with marker none', () => {
      const status = deliveryState(hc(), [line('fix the build', { origin: human })], NOW, config, typed);
      expect(status).toMatchObject({ state: 'confirmed', reason: expect.stringContaining('exact text') });
    });
    it.each(['short', 'full'] as const)('is confirmed by the text composed with the %s marker too (the setting may have changed)', (marker) => {
      const text = composeMessageText({ text: 'fix the build', imagePaths: [], id: 'm1', marker });
      expect(deliveryState(hc(), [line(text, { origin: human })], NOW, config, typed).state).toBe('confirmed');
    });
    it('is confirmed with the image lines of the reply', () => {
      const text = composeMessageText({ text: 'look', imagePaths: ['/tmp/a.png'], id: 'm1' });
      expect(deliveryState(hc({ text: 'look', imagePaths: ['/tmp/a.png'] }), [line(text, { origin: human })], NOW, config, typed).state).toBe('confirmed');
    });
    it('reads text parts and ignores line endings and trailing spaces', () => {
      expect(deliveryState(hc({ text: 'a\nb' }), [line([{ type: 'text', text: 'a  \r\nb ' }], { origin: human })], NOW, config, typed).state).toBe('confirmed');
    });
    it('does not match a substring or a longer line', () => {
      expect(deliveryState(hc(), [line('please fix the build now', { origin: human })], NOW, config, typed).state).toBe('sent');
      expect(deliveryState(hc(), [line('fix the', { origin: human })], NOW, config, typed).state).toBe('sent');
    });
    it('needs origin human: no origin, a peer origin and a non-user line do not confirm', () => {
      expect(deliveryState(hc(), [line('fix the build')], NOW, config, typed).state).toBe('sent');
      expect(deliveryState(hc(), [line('fix the build', { origin: { kind: 'peer' } })], NOW, config, typed).state).toBe('sent');
      expect(deliveryState(hc(), [{ type: 'assistant', timestamp: at(SENT + 500), message: { content: 'fix the build' }, origin: human }], NOW, config, typed).state).toBe('sent');
    });
    it('needs a timestamp at or after the send, with 1 s of tolerance', () => {
      expect(deliveryState(hc(), [line('fix the build', { origin: human, timestamp: at(SENT - 1_000) })], NOW, config, typed).state).toBe('confirmed');
      expect(deliveryState(hc(), [line('fix the build', { origin: human, timestamp: at(SENT - 1_001) })], NOW, config, typed).state).toBe('sent');
      const noTime = line('fix the build', { origin: human });
      delete noTime.timestamp;
      expect(deliveryState(hc(), [noTime], NOW, config, typed).state).toBe('sent');
    });
    it('does not use the text when the transport is not typed (a peer reply is confirmed by id only)', () => {
      expect(deliveryState(hc(), [line('fix the build', { origin: human })], NOW, config).state).toBe('sent');
    });
    it('without the text in the record there is nothing to match', () => {
      expect(deliveryState(hc({ text: undefined }), [line('fix the build', { origin: human })], NOW, config, typed).state).toBe('sent');
    });
    it('keeps the order: two identical replies each claim their own line', () => {
      const first = line('ok', { origin: human, timestamp: at(SENT + 100) });
      const second = line('ok', { origin: human, timestamp: at(SENT + 5_000) });
      const claimed = new Set<ReplyTranscriptEntry>();
      const a = hc({ id: 'a', text: 'ok', sentAt: SENT });
      const b = hc({ id: 'b', text: 'ok', sentAt: SENT + 4_000 });
      // Oldest first with one shared set.
      expect(deliveryState(a, [first], NOW + 9_000, config, { ...typed, claimed }).state).toBe('confirmed');
      expect(claimed.has(first)).toBe(true);
      // The second reply cannot take the first line again (and it is also before its own send time).
      expect(deliveryState(b, [first], NOW + 9_000, config, { ...typed, claimed }).state).toBe('sent');
      expect(deliveryState(b, [first, second], NOW + 9_000, config, { ...typed, claimed }).state).toBe('confirmed');
      expect(claimed.has(second)).toBe(true);
    });
    describe('identical replies (the first may have been dropped)', () => {
      const a = hc({ id: 'a', text: 'ok', sentAt: SENT });
      const b = hc({ id: 'b', text: 'ok', sentAt: SENT + 4_000 });
      const siblings = [a, b];
      const lineAt = (ms: number): ReplyTranscriptEntry => line('ok', { origin: human, timestamp: at(ms) });

      it('two identical replies and one matching line: none is confirmed by text, and the reason says why', () => {
        const only = lineAt(SENT + 6_000);
        for (const record of siblings) {
          const status = deliveryState(record, [only], NOW + 9_000, config, { ...typed, claimed: new Set(), siblings });
          expect(status.state).toBe('sent');
          expect(status.reason).toBe('2 identical replies were sent but 1 matching line(s) are in the transcript: which of them arrived cannot be told yet');
        }
      });
      it('two identical replies and two lines: each claims its own, oldest first', () => {
        const lines = [lineAt(SENT + 100), lineAt(SENT + 6_000)];
        const claimed = new Set<ReplyTranscriptEntry>();
        expect(deliveryState(a, lines, NOW + 9_000, config, { ...typed, claimed, siblings }).state).toBe('confirmed');
        expect(deliveryState(b, lines, NOW + 9_000, config, { ...typed, claimed, siblings }).state).toBe('confirmed');
        expect(claimed.size).toBe(2);
      });
      it('a line from before the first reply does not count toward the group', () => {
        const old = lineAt(SENT - 60_000);
        expect(deliveryState(a, [old, lineAt(SENT + 6_000)], NOW + 9_000, config, { ...typed, claimed: new Set(), siblings }).state).toBe('sent');
      });
      it('replies with another text or other images are not in the group; an id match is never blocked', () => {
        const other = hc({ id: 'c', text: 'different', sentAt: SENT + 1_000 });
        expect(deliveryState(a, [lineAt(SENT + 500)], NOW, config, { ...typed, claimed: new Set(), siblings: [a, other] }).state).toBe('confirmed');
        const viaId = line('ok', { origin: { kind: 'peer', msg_id: wireMsgId('a') } });
        expect(deliveryState(a, [viaId], NOW, config, { ...typed, siblings }).state).toBe('confirmed');
      });
    });
    it('a human who typed the same text earlier than the window does not confirm it', () => {
      expect(deliveryState(hc(), [line('fix the build', { origin: human, timestamp: at(SENT - 60_000) })], NOW, config, typed).state).toBe('sent');
    });
    it('shows the hc started hint in the reason, without confirming', () => {
      const status = deliveryState(hc({ started: true }), [], NOW, config, typed);
      expect(status.state).toBe('sent');
      expect(status.reason).toMatch(/started/);
      expect(deliveryState(hc({ started: false }), [], NOW, config, typed).reason).not.toMatch(/started/);
    });
    it('the idle hint still comes when hc started but nothing shows in the transcript', () => {
      const status = deliveryState(hc({ started: true }), [], SENT + 16_000, config, { ...typed, sessionStatus: 'idle' });
      expect(status.state).toBe('unconfirmed');
    });
  });
});
