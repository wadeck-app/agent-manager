import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../deps.js';
import { PENDING_EXPIRY_MS, type PendingMessage } from '../pending.js';
import { userPrompt } from './entryFixtures.js';
import { drawable, echoes, reconcilePending, SEEN_GRACE_MS } from './reconcile.js';
import { hideWebQueueLines } from './webQueue.js';

const NOW = 1_000_000;
const message = (patch: Partial<PendingMessage> = {}): PendingMessage => ({ messageId: 'm-1', sessionId: 's', text: 'salut', imageCount: 0, sentAt: NOW, state: 'delivered', ...patch });

/** A reply sent from agent-manager as the transcript has it: a peer entry carrying the marker. */
function webEntry(key: string, messageId: string, text: string, timestamp = NOW + 1000): LogEntry {
  return { ...userPrompt(key, `Another Claude session sent a message:\n[web reply via agent-manager #${messageId}]\n${text}\n\nThis came from another Claude session.`, timestamp), source: 'peer', webReply: { messageId, text } } as LogEntry;
}
const queue = (key: string, operation: 'enqueue' | 'dequeue', preview?: string): LogEntry => ({ key, offset: 0, kind: 'queue-operation', operation, ...(preview === undefined ? {} : { contentPreview: preview }) }) as LogEntry;

describe('reconcile: the echo of a message sent from the page', () => {
  it('matches a peer entry by the id of its marker, whatever the text and the clock say', () => {
    expect(echoes(webEntry('e', 'm-1', 'something else', 5), message())).toBe(true);
    expect(echoes(webEntry('e', 'm-2', 'salut'), message())).toBe(false);
  });

  it('does not match by a marker that is not on a peer entry (a typed or quoted marker is not our reply)', () => {
    const typed = { ...userPrompt('t', '[web reply via agent-manager #m-1]\nsalut', NOW + 1), webReply: { messageId: 'm-1', text: 'salut' } } as LogEntry;
    expect((typed as { source: string }).source).toBe('human');
    expect(echoes(typed, message({ messageId: 'm-9', text: 'unrelated' }))).toBe(false);
    expect(reconcilePending([typed], [message({ messageId: 'm-1', state: 'failed' })]).waiting).toHaveLength(1);
  });

  it('still matches a typed prompt by its text and the time window, and not an older one', () => {
    expect(echoes(userPrompt('u', 'salut please', NOW + 500), message())).toBe(true);
    expect(echoes(userPrompt('u', 'salut', NOW - 60_000), message())).toBe(false);
    expect(echoes({ ...userPrompt('p', 'salut', NOW), source: 'peer' } as LogEntry, message())).toBe(false);
  });

  it('splits echoed and waiting; an entry claimed by id is not given to another message by text', () => {
    const first = message({ messageId: 'm-1', text: 'same' });
    const second = message({ messageId: 'm-2', text: 'same' });
    const { echoed, waiting } = reconcilePending([webEntry('e1', 'm-1', 'same')], [first, second]);
    expect(echoed.map((m) => m.messageId)).toEqual(['m-1']);
    expect(waiting.map((m) => m.messageId)).toEqual(['m-2']);
  });

  it('a failed message is echoed by id only (an unconfirmed delivery the agent did take), never by text', () => {
    const failed = message({ state: 'failed', error: 'unconfirmed' });
    expect(reconcilePending([userPrompt('u', 'salut', NOW + 1)], [failed]).waiting).toHaveLength(1);
    expect(reconcilePending([webEntry('e', 'm-1', 'salut')], [failed]).echoed).toHaveLength(1);
  });
});

describe('what is drawn as pending', () => {
  it('keeps a failed one, drops an expired one, and a seen one after its grace period', () => {
    const at = NOW + PENDING_EXPIRY_MS + 1;
    expect(drawable([message({ state: 'failed' })], at)).toHaveLength(1);
    expect(drawable([message()], at)).toHaveLength(0);
    expect(drawable([message({ state: 'seen' })], NOW + SEEN_GRACE_MS - 1)).toHaveLength(1);
    expect(drawable([message({ state: 'seen' })], NOW + SEEN_GRACE_MS + 1)).toHaveLength(0);
  });
});

describe('hideWebQueueLines', () => {
  const web = '[web reply via agent-manager #m-1] salut';
  it('hides the enqueue that carries our marker and the dequeue that follows, nothing else', () => {
    const entries = [queue('a', 'enqueue', 'typed while busy'), queue('b', 'dequeue'), queue('c', 'enqueue', web), queue('d', 'dequeue'), userPrompt('u', 'x')];
    // The first dequeue belongs to the typed message (no owed web enqueue yet): it stays; the web pair goes.
    expect(hideWebQueueLines(entries).map((entry) => entry.key)).toEqual(['a', 'b', 'u']);
  });

  it('pairs by adjacency, never by a counter: an unrelated later dequeue stays visible', () => {
    // The web dequeue is outside the list (not loaded yet): the later, unrelated dequeue must not be hidden for it.
    expect(hideWebQueueLines([queue('c', 'enqueue', web), userPrompt('u', 'x'), queue('d', 'dequeue')]).map((entry) => entry.key)).toEqual(['u', 'd']);
    // Another entry between the enqueue and a dequeue: not a pair.
    expect(hideWebQueueLines([queue('c', 'enqueue', web), queue('x', 'enqueue', 'typed'), queue('d', 'dequeue')]).map((entry) => entry.key)).toEqual(['x', 'd']);
  });

  it('nothing is carried between two calls (a window is judged alone)', () => {
    expect(hideWebQueueLines([queue('c', 'enqueue', web)])).toEqual([]);
    expect(hideWebQueueLines([queue('d', 'dequeue')]).map((entry) => entry.key)).toEqual(['d']);
  });

  it('a dequeue with no web enqueue before it is kept', () => {
    expect(hideWebQueueLines([queue('d', 'dequeue')]).map((entry) => entry.key)).toEqual(['d']);
  });
});
