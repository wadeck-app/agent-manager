import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry, ReplyMessageDto } from '../deps.js';
import { row } from '../deps.js';
import { addPending, getPending, PENDING_EXPIRY_MS, resetPending, settlePending, syncDelivery, UNCONFIRMED_AFTER_MS } from '../pending.js';
import { answer, userPrompt } from './entryFixtures.js';
import { LogViewer } from './LogViewer.js';

const session = row({ displayName: 'test-agent-manager-setup' });
const SID = session.sessionId;

let entries: LogEntry[];
function serve(): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => answer(entries) }) as unknown as Response));
}

beforeEach(() => {
  resetPending();
  entries = [userPrompt('u0', 'earlier prompt', 1_000)];
  Element.prototype.scrollIntoView = vi.fn();
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0)) as typeof window.requestAnimationFrame;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function webEntry(messageId: string, text: string): LogEntry {
  return { ...userPrompt(`w-${messageId}`, `Another Claude session sent a message:\n[web reply via agent-manager #${messageId}]\n${text}\n\nThis came from another Claude session.`, Date.now()), source: 'peer', webReply: { messageId, text } } as LogEntry;
}
const queue = (key: string, operation: 'enqueue' | 'dequeue', preview?: string): LogEntry => ({ key, offset: 0, kind: 'queue-operation', operation, ...(preview === undefined ? {} : { contentPreview: preview }) }) as LogEntry;
const dto = (patch: Partial<ReplyMessageDto>): ReplyMessageDto => ({ messageId: 'm-1', sentAt: Date.now(), text: 'salut', imageCount: 0, transportId: 'socket', priority: 'next', state: 'sent', ui: 'delivered', reason: 'sent', hint: '', ...patch });

describe('a message sent from the page, in the timeline', () => {
  it('while waiting: one pending bubble at the end with its delivery mark and the clock of "after current step"', async () => {
    serve();
    render(<LogViewer session={session} />);
    await screen.findByText('earlier prompt');
    act(() => addPending({ messageId: 'm-1', sessionId: SID, text: 'salut', imageCount: 0, sentAt: Date.now(), state: 'delivered', priority: 'next' }));
    expect(screen.getByText('salut')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Delivered: Sent to the session/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'After current step' })).toBeInTheDocument();
    expect(screen.queryByText(/interrupted the running step/)).toBeNull();
  });

  it('an interrupting send has the orange lightning and the interrupted cue', async () => {
    serve();
    render(<LogViewer session={session} />);
    await screen.findByText('earlier prompt');
    act(() => addPending({ messageId: 'm-2', sessionId: SID, text: 'stop', imageCount: 0, sentAt: Date.now(), state: 'delivered', priority: 'now' }));
    expect(screen.getByRole('img', { name: 'Interrupt now' })).toBeInTheDocument();
    expect(screen.getByText('interrupted the running step')).toBeInTheDocument();
    expect(screen.getByText('stop').closest('div[class*="border-warning"]')).not.toBeNull();
  });

  it('when the transcript echoes it: the bubble becomes "You, via web" with the person\'s own words, the pending copy is gone, no duplicate, and the queue lines are hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve();
    render(<LogViewer session={session} />);
    await screen.findByText('earlier prompt');
    act(() => addPending({ messageId: 'm-1', sessionId: SID, text: 'salut', imageCount: 0, sentAt: Date.now(), state: 'delivered', priority: 'next' }));
    expect(screen.queryByText('You, via web')).toBeNull();
    entries = [...entries, queue('q1', 'enqueue', 'Another Claude session sent a message: [web reply via agent-manager #m-1] salut'), queue('q2', 'dequeue'), webEntry('m-1', 'salut')];
    // The log polls every 2 s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    await screen.findByText('You, via web');
    expect(getPending(SID)).toHaveLength(0);
    expect(screen.getAllByText('salut')).toHaveLength(1);
    expect(screen.queryByText(/Queue/)).toBeNull();
    expect(screen.queryByText(/Message from/)).toBeNull();
    expect(screen.getByRole('img', { name: /^Seen by the agent/ })).toBeInTheDocument();
    // The raw text of the peer message is one click away.
    fireEvent.click(screen.getByText('Raw message'));
    expect(screen.getByText(/Another Claude session sent a message:/)).toBeInTheDocument();
  });

  it('an echoed bubble takes its priority from the audit record: an interrupting one is marked, even after a reload', async () => {
    entries = [...entries, webEntry('m-9', 'stop that')];
    serve();
    render(<LogViewer session={session} />);
    await screen.findByText('You, via web');
    expect(screen.queryByText('interrupted the running step')).toBeNull();
    act(() => syncDelivery(SID, [dto({ messageId: 'm-9', text: 'stop that', priority: 'now', ui: 'seen' })], Date.now()));
    expect(await screen.findByText('interrupted the running step')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Interrupt now' })).toBeInTheDocument();
  });

  it('a message the page lost in a reload comes back from the audit as pending, unless it is seen, expired or already shown', async () => {
    serve();
    render(<LogViewer session={session} />);
    await screen.findByText('earlier prompt');
    const now = Date.now();
    act(() =>
      syncDelivery(
        SID,
        [dto({ messageId: 'lost', text: 'lost one', ui: 'delivered', sentAt: now - 30_000 }), dto({ messageId: 'seen', text: 'seen one', ui: 'seen', sentAt: now - 30_000 }), dto({ messageId: 'old', text: 'old one', ui: 'delivered', sentAt: now - PENDING_EXPIRY_MS - 1000 })],
        now,
      ),
    );
    expect(screen.getByText('lost one')).toBeInTheDocument();
    expect(screen.queryByText('seen one')).toBeNull();
    expect(screen.queryByText('old one')).toBeNull();
    // Once echoed (settled) it is not brought back by the next audit poll.
    act(() => settlePending(SID, 'lost'));
    act(() => syncDelivery(SID, [dto({ messageId: 'lost', text: 'lost one', ui: 'delivered', sentAt: now - 30_000 })], now));
    expect(screen.queryByText('lost one')).toBeNull();
  });

  it('a failed audit record comes back as a visible problem with its reason', async () => {
    serve();
    render(<LogViewer session={session} />);
    await screen.findByText('earlier prompt');
    act(() => syncDelivery(SID, [dto({ messageId: 'bad', text: 'unreached', ui: 'failed', state: 'unconfirmed', reason: 'the session is idle and its transcript did not grow', hint: 'Check crossSessionInbound' })], Date.now()));
    expect(screen.getByRole('img', { name: /^Problem: the session is idle and its transcript did not grow\. Check crossSessionInbound/ })).toBeInTheDocument();
  });

  it('nothing in the transcript after two minutes: the mark turns into "Not confirmed" with what to check', async () => {
    serve();
    render(<LogViewer session={session} />);
    await screen.findByText('earlier prompt');
    act(() => addPending({ messageId: 'm-3', sessionId: SID, text: 'hello', imageCount: 0, sentAt: Date.now() - UNCONFIRMED_AFTER_MS - 5000, state: 'delivered', priority: 'next' }));
    expect(screen.getByRole('img', { name: /^Not confirmed: The transcript has not shown this message yet/ })).toBeInTheDocument();
  });
});
