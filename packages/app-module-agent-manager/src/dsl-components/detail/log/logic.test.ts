import { describe, expect, it } from 'vitest';
import { answer, assistantText, subagent, toolCall, userPrompt } from './entryFixtures.js';
import { capOutput, relativeTime } from './format.js';
import { buildRows, summariseGroup, toggleOpen } from './grouping.js';
import { initialLogState, logReducer, mergeAfter, prependOlder } from './logReducer.js';
import { reconcilePending } from './reconcile.js';
import type { PendingMessage } from '../pending.js';

const pendingOf = (text: string, patch: Partial<PendingMessage> = {}): PendingMessage => ({ messageId: 'm1', sessionId: 's', text, imageCount: 0, sentAt: 10_000, state: 'delivered', ...patch });

describe('logReducer', () => {
  it('replaces a running call by its complete version, in place, without counting it as new', () => {
    const running = toolCall('a');
    const start = logReducer(initialLogState, { type: 'tail', answer: answer([userPrompt('u', 'hi'), running, assistantText('t', 'x')]) });
    const next = logReducer(start, { type: 'after', answer: answer([toolCall('a', { status: 'ok', resultPreview: 'done', durationMs: 5 })], { cursor: 'c2' }) });
    expect(next.entries.map((entry) => entry.key)).toEqual(['u', 'call:a', 't']);
    expect(next.entries[1]).toMatchObject({ status: 'ok', resultPreview: 'done' });
    expect(next.appended).toBe(0);
    expect(next.cursor).toBe('c2');
  });

  it('appends new keys at the end and counts them', () => {
    const start = logReducer(initialLogState, { type: 'tail', answer: answer([userPrompt('u', 'hi')]) });
    const next = logReducer(start, { type: 'after', answer: answer([assistantText('t1', 'a'), assistantText('t2', 'b')]) });
    expect(next.entries.map((entry) => entry.key)).toEqual(['u', 't1', 't2']);
    expect(next.appended).toBe(2);
  });

  it('keeps one copy when an answer repeats a key, the newer one for after', () => {
    const merged = mergeAfter([assistantText('t', 'old')], [assistantText('t', 'new'), assistantText('t', 'newest')]);
    expect(merged.entries).toHaveLength(1);
    expect(merged.entries[0]).toMatchObject({ text: 'newest' });
    expect(merged.added).toBe(0);
  });

  it('puts an older page in front and keeps the older copy of a shared key', () => {
    const merged = prependOlder([toolCall('a', { status: 'unknown', orphan: true }), assistantText('t', 'x')], [userPrompt('u', 'hi'), toolCall('a', { status: 'ok' })]);
    expect(merged.map((entry) => entry.key)).toEqual(['u', 'call:a', 't']);
    expect(merged[1]).toMatchObject({ status: 'ok' });
  });

  it('keeps the newest cursor and the sub-agents on an older page', () => {
    const start = logReducer(initialLogState, { type: 'tail', answer: answer([userPrompt('u', 'hi')], { cursor: 'newest', olderCursor: 'o1', subagents: [subagent({ agentId: 'x', finished: false, status: 'active' })] }) });
    const next = logReducer(start, { type: 'older', answer: answer([userPrompt('u0', 'before')], { cursor: null, olderCursor: null }) });
    expect(next.cursor).toBe('newest');
    expect(next.olderCursor).toBeNull();
    expect(next.subagents).toHaveLength(1);
    expect(next.entries.map((entry) => entry.key)).toEqual(['u0', 'u']);
  });

  it('a tail answer replaces everything (reload after a stale cursor)', () => {
    const start = logReducer(initialLogState, { type: 'tail', answer: answer([userPrompt('u', 'hi')]) });
    const next = logReducer(start, { type: 'tail', answer: answer([assistantText('n', 'new')]) });
    expect(next.entries.map((entry) => entry.key)).toEqual(['n']);
  });
});

describe('grouping and collapse', () => {
  it('groups two or more consecutive tool calls, leaves a single one alone', () => {
    const rows = buildRows([userPrompt('u', 'x'), toolCall('a'), toolCall('b'), assistantText('t', 'y'), toolCall('c')]);
    expect(rows.map((row) => row.type)).toEqual(['entry', 'group', 'entry', 'entry']);
    expect(rows[1]).toMatchObject({ key: 'group:call:a' });
  });

  it('summarises a group', () => {
    const summary = summariseGroup([toolCall('a'), toolCall('b', { status: 'error' }), toolCall('c', { name: 'Read', status: 'ok' })]);
    expect(summary).toEqual({ total: 3, running: 1, errors: 1, names: 'Bash 2, Read' });
  });

  it('toggles a row open and closed without changing the previous set', () => {
    const closed = new Set<string>();
    const opened = toggleOpen(closed, 'k');
    expect(opened.has('k')).toBe(true);
    expect(closed.has('k')).toBe(false);
    expect(toggleOpen(opened, 'k').has('k')).toBe(false);
  });
});

describe('reconcilePending', () => {
  it('forgets a message the transcript echoes, once', () => {
    const entries = [userPrompt('u1', 'run the tests', 12_000)];
    const { echoed, waiting } = reconcilePending(entries, [pendingOf('run the tests'), pendingOf('run the tests', { messageId: 'm2' })]);
    expect(echoed.map((message) => message.messageId)).toEqual(['m1']);
    expect(waiting.map((message) => message.messageId)).toEqual(['m2']);
  });

  it('matches a prompt that continues with image paths, but not an older one', () => {
    expect(reconcilePending([userPrompt('u', 'look\n[image saved at C:/x.png]', 11_000)], [pendingOf('look')]).echoed).toHaveLength(1);
    expect(reconcilePending([userPrompt('u', 'look', 1_000)], [pendingOf('look')]).echoed).toHaveLength(0);
  });

  it('never echoes a failed message', () => {
    expect(reconcilePending([userPrompt('u', 'hi', 12_000)], [pendingOf('hi', { state: 'failed', error: 'x' })]).waiting).toHaveLength(1);
  });
});

describe('format', () => {
  it('writes relative times', () => {
    expect(relativeTime(1000, 1000)).toBe('just now');
    expect(relativeTime(0, 90_000)).toBe('1m ago');
    expect(relativeTime(5000, 0)).toBe('just now');
  });

  it('caps a long output by lines and characters and says what is hidden', () => {
    const text = Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\n');
    const capped = capOutput(text, 1000, 10);
    expect(capped.cut).toBe(true);
    expect(capped.text.split('\n')).toHaveLength(10);
    expect(capped.hiddenChars).toBe(text.length - capped.text.length);
    expect(capOutput('short', 1000, 10).cut).toBe(false);
  });
});
