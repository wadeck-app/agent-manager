import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry, ReplyMessageDto } from '../deps.js';
import { row } from '../deps.js';
import { addPending, getPending, rememberImages, resetPending, syncDelivery } from '../pending.js';
import { answer, userPrompt } from './entryFixtures.js';
import { LogViewer } from './LogViewer.js';

const session = row({ displayName: 'test-agent-manager-setup' });
const SID = session.sessionId;

let entries: LogEntry[];
let posts: { url: string; body: Record<string, unknown> }[];

// The log answers GET; POST /reply is recorded and answered as delivered.
function serve(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push({ url: String(url), body: JSON.parse(String(init.body)) as Record<string, unknown> });
        return { ok: true, status: 200, json: async () => ({ ok: true, deliveryUi: 'delivered' }) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => answer(entries) } as unknown as Response;
    }),
  );
}

beforeEach(() => {
  resetPending();
  posts = [];
  entries = [userPrompt('u0', 'earlier prompt', 1_000)];
  Element.prototype.scrollIntoView = vi.fn();
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0)) as typeof window.requestAnimationFrame;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const dto = (patch: Partial<ReplyMessageDto>): ReplyMessageDto => ({ messageId: 'm-1', sentAt: Date.now(), text: 'salut', imageCount: 0, transportId: 'socket', priority: 'next', state: 'sent', ui: 'failed', reason: 'refused', hint: '', ...patch });

describe('a failed or unconfirmed message can be dismissed or sent again', () => {
  it('dismiss removes the bubble and the audit record is not adopted again after a reload', async () => {
    serve();
    render(<LogViewer session={session} />);
    await screen.findByText('earlier prompt');
    act(() => syncDelivery(SID, [dto({ messageId: 'bad', text: 'unreached' })], Date.now()));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss this message' }));
    expect(screen.queryByText('unreached')).toBeNull();
    // A reload: the in-memory store is gone, the dismissal is remembered by id (sessionStorage), the audit record still lists the failure.
    const stored = window.sessionStorage.getItem('agent-manager.dismissedPending');
    resetPending();
    window.sessionStorage.setItem('agent-manager.dismissedPending', stored ?? '[]');
    act(() => syncDelivery(SID, [dto({ messageId: 'bad', text: 'unreached' })], Date.now()));
    expect(getPending(SID)).toHaveLength(0);
    expect(screen.queryByText('unreached')).toBeNull();
  });

  it('no action buttons while the message is only delivered', async () => {
    serve();
    render(<LogViewer session={session} />);
    await screen.findByText('earlier prompt');
    act(() => addPending({ messageId: 'm-2', sessionId: SID, text: 'ok', imageCount: 0, sentAt: Date.now(), state: 'delivered', priority: 'next' }));
    expect(screen.queryByRole('button', { name: 'Dismiss this message' })).toBeNull();
  });

  it('retry sends the same text and priority (confirmNow for now) as a NEW message id and dismisses the old one', async () => {
    serve();
    render(<LogViewer session={session} />);
    await screen.findByText('earlier prompt');
    act(() => addPending({ messageId: 'old-1', sessionId: SID, text: 'stop it', imageCount: 0, sentAt: Date.now(), state: 'failed', priority: 'now', error: 'refused' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send again as a new message' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.body).toMatchObject({ text: 'stop it', priority: 'now', confirmNow: true });
    expect(posts[0]?.body.messageId).not.toBe('old-1');
    await waitFor(() => expect(getPending(SID).map((message) => message.messageId)).not.toContain('old-1'));
    expect(getPending(SID)).toHaveLength(1);
  });

  it('retry of a message whose images are no longer in memory is not offered (no silent text-only resend)', async () => {
    serve();
    render(<LogViewer session={session} />);
    await screen.findByText('earlier prompt');
    act(() => addPending({ messageId: 'img-1', sessionId: SID, text: 'look', imageCount: 2, sentAt: Date.now(), state: 'failed', priority: 'next', error: 'refused' }));
    expect(screen.queryByRole('button', { name: 'Send again as a new message' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dismiss this message' })).toBeInTheDocument();
  });

  it('retry with images still in memory sends them', async () => {
    serve();
    render(<LogViewer session={session} />);
    await screen.findByText('earlier prompt');
    rememberImages('img-2', [{ id: 'i1', name: 'a.png', mime: 'image/png', dataBase64: 'AAAA' } as never]);
    act(() => addPending({ messageId: 'img-2', sessionId: SID, text: 'look', imageCount: 1, sentAt: Date.now(), state: 'failed', priority: 'next', error: 'refused' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send again as a new message' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.body.images).toEqual([{ name: 'a.png', mime: 'image/png', dataBase64: 'AAAA' }]);
  });
});
