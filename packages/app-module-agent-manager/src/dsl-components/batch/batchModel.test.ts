import { describe, expect, it } from 'vitest';
import { row } from '../logic/fixtures.js';
import type { BatchRecipientResult, ReplyStatusOk, TransportStatusDto } from '../shared.js';
import { eligibilityOf, previewText, resultsText, retryableIds, sendBlockText, summaryText } from './batchModel.js';

const transport = (over: Partial<TransportStatusDto> = {}): TransportStatusDto => ({ transportId: 'socket', description: '', kind: 'direct', probed: true, available: true, reason: 'on', fix: '', warnings: [], selected: true, isDefault: true, sessionOverride: false, deliveredAs: 'peer', deliveredAsText: '', marker: null, ...over });
const status = (over: Partial<ReplyStatusOk> = {}): ReplyStatusOk => ({
  ok: true,
  sessionId: 'x',
  sessionAlive: true,
  selectedFrom: 'default',
  selectedTransportId: 'socket',
  defaultTransportId: 'socket',
  sessionOverrideTransportId: null,
  transports: [transport()],
  replyMarker: { mode: 'none', source: '', text: '' },
  messages: [],
  warnings: [],
  limits: { maxTextChars: 1, maxImages: 1, maxImageBytes: 1, maxBodyBytes: 1 },
  ...over,
});
const result = (id: string, state: BatchRecipientResult['state'], reason = ''): BatchRecipientResult => ({ id, name: `n-${id}`, state, reason });

describe('eligibilityOf', () => {
  it('a live session whose selected transport is available can receive', () => {
    expect(eligibilityOf(row(), status(), undefined)).toEqual({ state: 'ok' });
  });
  it('is checking until the status arrives', () => {
    expect(eligibilityOf(row(), undefined, undefined)).toEqual({ state: 'checking' });
  });
  it('a session that is not running is skipped with what to do, whatever the transport says', () => {
    expect(eligibilityOf(row({ alive: false }), status(), undefined)).toMatchObject({ state: 'skipped', reason: expect.stringContaining('Resume it') });
    expect(eligibilityOf(row(), status({ sessionAlive: false }), undefined)).toMatchObject({ state: 'skipped' });
  });
  it('an unavailable transport is skipped with its reason and fix', () => {
    const answer = status({ transports: [transport({ available: false, reason: 'no inbox socket', fix: 'update Claude Code' })] });
    expect(eligibilityOf(row(), answer, undefined)).toEqual({ state: 'skipped', reason: 'The socket transport is not available: no inbox socket. Fix: update Claude Code' });
  });
  it('a status that could not be read is skipped with the reason, never guessed available', () => {
    expect(eligibilityOf(row(), undefined, 'Cannot reach the app-core server.')).toEqual({ state: 'skipped', reason: 'Its transport could not be checked: Cannot reach the app-core server.' });
    expect(eligibilityOf(row(), { ok: false, error: { code: 'unknown-session', message: 'No session.', hint: 'Wait for the next refresh.' } }, undefined)).toEqual({ state: 'skipped', reason: 'No session. Wait for the next refresh.' });
  });
  it('a selected transport the module does not offer is skipped', () => {
    expect(eligibilityOf(row(), status({ transports: [transport({ selected: false })] }), undefined)).toMatchObject({ state: 'skipped' });
  });
});

describe('sendBlockText', () => {
  it('is empty when the batch can go', () => {
    expect(sendBlockText('hello', 3, false)).toBe('');
  });
  it('says why not: over the cap, still checking, nobody ticked, no text', () => {
    expect(sendBlockText('hello', 23, false)).toContain('at most 20');
    expect(sendBlockText('hello', 23, false)).toContain('untick 3');
    expect(sendBlockText('hello', 2, true)).toContain('Checking');
    expect(sendBlockText('hello', 0, false)).toContain('nobody would receive it');
    expect(sendBlockText('  ', 2, false)).toBe('Write the message first.');
  });
});

describe('texts', () => {
  it('previews who receives it', () => {
    expect(previewText(3, 0)).toBe('3 will receive it');
    expect(previewText(3, 2)).toBe('3 will receive it, 2 skipped');
    expect(previewText(0, 1)).toBe('Nobody will receive it, 1 skipped');
  });
  it('summarises and copies the results, one line per recipient', () => {
    const results = [result('a', 'sent'), result('b', 'refused', 'dead'), result('c', 'maybe-sent', 'timeout'), result('d', 'sent')];
    expect(summaryText(results)).toBe('2 sent, 1 refused, 1 maybe sent');
    expect(resultsText(results).split('\n')).toEqual(['n-a (a): Sent', 'n-b (b): Refused, nothing sent. dead', 'n-c (c): Maybe sent. timeout', 'n-d (d): Sent']);
  });
  it('a retry offers the refused and failed ones, never a maybe-sent one', () => {
    expect(retryableIds([result('a', 'sent'), result('b', 'refused'), result('c', 'maybe-sent'), result('d', 'failed')])).toEqual(['b', 'd']);
  });
});
