import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../shared.js';
import { assistantText, userPrompt } from '../detail/log/entryFixtures.js';
import { THREAD_CAP_NOTE, shortMessage, threadAnchorOf, threadBody, threadChipText } from './threadForm.js';

const UUID = '27bf9648-39df-453b-bd04-99816f5c1819';
const withUuid = (entry: LogEntry, uuid: string = UUID): LogEntry => ({ ...entry, uuid });
const as = (value: object): LogEntry => value as LogEntry;

describe('threadAnchorOf: which log rows can open a thread', () => {
  it('a human prompt and an assistant text with a uuid are anchors, carrying the text of the message', () => {
    expect(threadAnchorOf(withUuid(userPrompt('u', 'why is it red?')))).toEqual({ kind: 'ok', uuid: UUID, text: 'why is it red?' });
    expect(threadAnchorOf(withUuid(assistantText('a', 'because of X')))).toEqual({ kind: 'ok', uuid: UUID, text: 'because of X' });
  });

  it('a message sent from agent-manager gives the words the person wrote, not the wrapper', () => {
    const entry = withUuid(as({ ...userPrompt('w', 'wrapped text'), source: 'peer' as const, webReply: { messageId: 'm1', text: 'my words' } }));
    expect(threadAnchorOf(entry)).toEqual({ kind: 'ok', uuid: UUID, text: 'my words' });
  });

  it('a row without uuid (a transcript line that had none) is blocked with a reason, never silently skipped', () => {
    const result = threadAnchorOf(userPrompt('u', 'old line'));
    expect(result?.kind).toBe('blocked');
    expect(result && result.kind === 'blocked' ? result.reason : '').toMatch(/no uuid/);
  });

  it('is nothing for tool calls, thinking, harness text, injected prompts and sub-agent entries', () => {
    expect(threadAnchorOf(withUuid(as({ key: 't', offset: 0, kind: 'thinking', collapsible: true, text: 'hm', textTruncated: false, textBytes: 2 })))).toBeUndefined();
    expect(threadAnchorOf(withUuid(as({ ...userPrompt('h', 'x'), harness: { label: 'Command', summary: 's', detail: '', tags: [] } })))).toBeUndefined();
    expect(threadAnchorOf(withUuid(as({ ...userPrompt('i', 'x'), source: 'injected' as const })))).toBeUndefined();
    expect(threadAnchorOf(withUuid(as({ ...assistantText('a', 'x'), ownerAgentId: 'agent1' })))).toBeUndefined();
  });
});

describe('threadBody', () => {
  it('sends the anchor and only the fields that have a value', () => {
    expect(threadBody({ sourceSessionId: 's', atMessageId: UUID, name: ' thread: x ', model: '', permissionMode: '' })).toEqual({ sourceSessionId: 's', atMessageId: UUID, name: 'thread: x' });
    expect(threadBody({ sourceSessionId: 's', atMessageId: UUID, name: '', model: 'haiku', permissionMode: 'plan' })).toEqual({ sourceSessionId: 's', atMessageId: UUID, model: 'haiku', permissionMode: 'plan' });
  });
});

describe('the chip of a thread', () => {
  it('names the source and quotes the message when it is known, else shows the short id', () => {
    expect(shortMessage('a'.repeat(100))).toHaveLength(43);
    expect(shortMessage('two\nlines')).toBe('two lines');
    expect(threadChipText('shop', 'why is it red?', UUID)).toBe('thread of shop at "why is it red?"');
    expect(threadChipText('shop', undefined, UUID)).toBe('thread of shop at message 27bf9648');
    expect(threadChipText(undefined, undefined, UUID)).toBe('thread of an agent that is not in the list at message 27bf9648');
  });

  it('the quote sent with a thread is the short one-line message (the daemon keeps it, so a reload shows the same chip)', () => {
    expect(threadBody({ sourceSessionId: 's', atMessageId: UUID, atMessageQuote: 'why red?', name: '', model: '', permissionMode: '' })).toEqual({ sourceSessionId: 's', atMessageId: UUID, atMessageQuote: 'why red?' });
  });

  it('the cap note names the number', () => {
    expect(THREAD_CAP_NOTE).toContain('3');
  });
});
