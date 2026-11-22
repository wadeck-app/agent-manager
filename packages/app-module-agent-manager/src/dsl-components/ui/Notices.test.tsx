import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoticeItem } from '../logic/notices.js';
import { NoticeStrip } from './Notices.js';

const A: NoticeItem = { key: 'a', tone: 'warning', summary: 'Daemon off: 1 owned session unavailable', details: 'full text A in C:\\cfg\\owned-sessions.json. Fix: run `agent-manager start --detach`', fix: 'agent-manager start --detach' };
const B: NoticeItem = { key: 'b', tone: 'error', summary: '3 registry files unreadable', details: 'full text B' };

beforeEach(() => window.sessionStorage.clear());

describe('NoticeStrip', () => {
  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<NoticeStrip items={[]} />);
    expect(container.textContent).toBe('');
  });

  it('one notice is ONE short line: the sentence, no full text until Details is opened', () => {
    render(<NoticeStrip items={[A]} />);
    expect(screen.getByText(A.summary)).toBeTruthy();
    expect(screen.queryByText(/full text A/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /details/i }));
    expect(screen.getByText(/full text A/)).toBeTruthy();
  });

  it('Copy fix copies the command and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<NoticeStrip items={[A]} />);
    fireEvent.click(screen.getByRole('button', { name: /copy fix/i }));
    expect(writeText).toHaveBeenCalledWith('agent-manager start --detach');
    expect(await screen.findByText(/copied/i)).toBeTruthy();
  });

  it('a clipboard that refuses is said, with the command to type', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    render(<NoticeStrip items={[A]} />);
    fireEvent.click(screen.getByRole('button', { name: /copy fix/i }));
    expect(await screen.findByText(/could not copy.*agent-manager start --detach/i)).toBeTruthy();
  });

  it('no Copy fix button when the notice has no command', () => {
    render(<NoticeStrip items={[B]} />);
    expect(screen.queryByRole('button', { name: /copy fix/i })).toBeNull();
  });

  it('dismiss hides the line but leaves a badge that brings it back (never silent)', () => {
    render(<NoticeStrip items={[A]} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText(A.summary)).toBeNull();
    const badge = screen.getByRole('button', { name: /1 notice dismissed/i });
    expect(JSON.parse(window.sessionStorage.getItem('agent-manager.dismissedNotices') ?? '[]')).toEqual([A.details]);
    fireEvent.click(badge);
    expect(screen.getByText(A.summary)).toBeTruthy();
  });

  it('a dismissed notice stays dismissed after a remount, but a changed text shows again', () => {
    const { unmount } = render(<NoticeStrip items={[A]} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    unmount();
    const again = render(<NoticeStrip items={[A]} />);
    expect(screen.queryByText(A.summary)).toBeNull();
    again.unmount();
    render(<NoticeStrip items={[{ ...A, details: `${A.details} (changed)` }]} />);
    expect(screen.getByText(A.summary)).toBeTruthy();
  });

  it('several notices collapse into one line with a list', () => {
    render(<NoticeStrip items={[A, B]} />);
    expect(screen.getByText('2 notices')).toBeTruthy();
    expect(screen.queryByText(A.summary)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByText(A.summary)).toBeTruthy();
    expect(screen.getByText(B.summary)).toBeTruthy();
  });

  it('an item with its own dismiss calls it and is not stored', () => {
    const onDismiss = vi.fn();
    render(<NoticeStrip items={[{ ...B, onDismiss }]} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalled();
    expect(window.sessionStorage.getItem('agent-manager.dismissedNotices')).toBeNull();
  });

  it('an error is announced (role alert), a warning politely', () => {
    const { rerender } = render(<NoticeStrip items={[B]} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    rerender(<NoticeStrip items={[A]} />);
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
