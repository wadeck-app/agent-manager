import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDir } from '../testFixtures.js';
import { originMarkerFor } from './compose.js';
import { DEFAULT_REPLY_CONFIG, readTransportsConfig, setDefaultTransport, setSessionTransport } from './config.js';
import { deliveryState } from './deliveryState.js';
import type { DeliveryRecord, ReplyTranscriptEntry } from './deliveryState.js';
import { ReplyError } from './errors.js';
import { wireMsgId } from './messageIds.js';

const IDS = ['socket', 'hc'];
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    removeDir(dir);
  }
});
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-manager-transports-'));
  dirs.push(dir);
  return dir;
};

describe('wireMsgId', () => {
  it('keeps a UUID (lower-cased) and derives the same UUID-shaped value from any other id', () => {
    expect(wireMsgId('0A1B2C3D-0000-4000-8000-000000000001')).toBe('0a1b2c3d-0000-4000-8000-000000000001');
    const derived = wireMsgId('m-test-0001');
    expect(derived).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(wireMsgId('m-test-0001')).toBe(derived);
    expect(wireMsgId('m-test-0002')).not.toBe(derived);
  });
});

describe('deliveryState matching', () => {
  const record: DeliveryRecord = { id: 'm-abc', sessionId: 's', state: 'sent', transportId: 'socket', kind: 'direct', sentAt: 1000, priority: 'next' };
  const state = (entries: ReplyTranscriptEntry[]) => deliveryState(record, entries, 2000, DEFAULT_REPLY_CONFIG).state;

  it('confirms by origin.msg_id whatever the text says (a shortened or reworded marker cannot break it)', () => {
    const entry: ReplyTranscriptEntry = { type: 'user', message: { content: '[web reply #abc]\nhello' }, origin: { kind: 'peer', msg_id: wireMsgId('m-abc').toUpperCase() } };
    expect(state([entry])).toBe('confirmed');
    expect(deliveryState(record, [entry], 2000, DEFAULT_REPLY_CONFIG).reason).toContain('origin.msg_id');
  });

  it('does not confirm on a line whose origin.msg_id is another message, even if the text carries our marker', () => {
    const entry: ReplyTranscriptEntry = { type: 'user', message: { content: `${originMarkerFor('m-abc')}\nhello` }, origin: { kind: 'peer', msg_id: wireMsgId('m-other') } };
    expect(state([entry])).toBe('sent');
  });

  it('falls back to the marker when the line has no msg_id (typed prompt of the hc transport, origin human)', () => {
    const entry: ReplyTranscriptEntry = { type: 'user', message: { content: `${originMarkerFor('m-abc')}\nhello` }, origin: { kind: 'human' } };
    const status = deliveryState({ ...record, transportId: 'hc' }, [entry], 2000, DEFAULT_REPLY_CONFIG);
    expect(status.state).toBe('confirmed');
    expect(status.reason).toContain('origin human');
  });

  it('the idle hint of a typed (hc) reply does not talk about crossSessionInbound', () => {
    const idle = { sessionStatus: 'idle' as const, deliveredAs: 'typed' as const };
    const status = deliveryState(record, [], 1_000 + 20_000, DEFAULT_REPLY_CONFIG, idle);
    expect(status.state).toBe('unconfirmed');
    expect(status.hint).toContain('hc ls');
    expect(status.hint).not.toContain('crossSessionInbound');
    expect(deliveryState(record, [], 1_000 + 20_000, DEFAULT_REPLY_CONFIG, { sessionStatus: 'idle', deliveredAs: 'peer' }).hint).toContain('crossSessionInbound');
  });

  it('uses the one marker function for the text and for the match', () => {
    expect(originMarkerFor('m-abc')).toBe('[web reply via agent-manager #m-abc]');
  });
});

describe('setDefaultTransport and setSessionTransport', () => {
  it('writes the default and a session override, then clears the override with null', async () => {
    const dir = tempDir();
    expect(await setDefaultTransport(dir, 'hc', IDS)).toEqual({ default: 'hc', perSession: {} });
    await setSessionTransport(dir, 'sess-1', 'socket', IDS);
    expect(await readTransportsConfig(dir)).toEqual({ default: 'hc', perSession: { 'sess-1': 'socket' } });
    await setSessionTransport(dir, 'sess-1', null, IDS);
    expect(await readTransportsConfig(dir)).toEqual({ default: 'hc', perSession: {} });
  });

  it('refuses an unknown id naming the valid ones, and writes nothing', async () => {
    const dir = tempDir();
    const failure = await setDefaultTransport(dir, 'carrier-pigeon', IDS).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ReplyError);
    expect((failure as ReplyError).code).toBe('unknown-transport');
    expect((failure as ReplyError).message).toContain('socket, hc');
    await expect(setSessionTransport(dir, 'sess-1', 'nope', IDS)).rejects.toThrow(/known: socket, hc/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('refuses an unsafe session id', async () => {
    await expect(setSessionTransport(tempDir(), '__proto__', 'hc', IDS)).rejects.toThrow(/identifier/);
    await expect(setSessionTransport(tempDir(), '../x', 'hc', IDS)).rejects.toThrow(/identifier/);
  });

  it('keeps the other overrides, and leaves no temp file; concurrent changes are not lost', async () => {
    const dir = tempDir();
    await Promise.all([setSessionTransport(dir, 'a', 'hc', IDS), setSessionTransport(dir, 'b', 'socket', IDS), setDefaultTransport(dir, 'hc', IDS)]);
    expect(await readTransportsConfig(dir)).toEqual({ default: 'hc', perSession: { a: 'hc', b: 'socket' } });
    expect(readdirSync(dir)).toEqual(['transports.json']);
  });

  it('does not overwrite a corrupt file: the read error stands', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'transports.json'), '{nope');
    await expect(setDefaultTransport(dir, 'hc', IDS)).rejects.toThrow(/not valid JSON/);
    expect(readFileSync(join(dir, 'transports.json'), 'utf8')).toBe('{nope');
  });
});
