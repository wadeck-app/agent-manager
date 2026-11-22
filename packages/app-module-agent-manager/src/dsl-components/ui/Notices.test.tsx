import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoticeItem } from '../logic/notices.js';
import { NoticesButton } from './Notices.js';

const A: NoticeItem = { key: 'a', tone: 'warning', summary: 'Daemon off: 1 owned session unavailable', details: 'full text A in C:\\cfg\\owned-sessions.json. Fix: run `agent-manager start --detach`', fix: 'agent-manager start --detach' };
const B: NoticeItem = { key: 'b', tone: 'error', summary: '3 registry files unreadable', details: 'full text B' };
const LONG: NoticeItem = { key: 'l', tone: 'warning', summary: 'A long one', details: `${'word '.repeat(60)}THE-END` };

beforeEach(() => window.sessionStorage.clear());

const open = (): void => {
  fireEvent.click(screen.getByRole('button', { name: /notices?$/ }));
};

describe('NoticesButton', () => {
  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<NoticesButton items={[]} />);
    expect(container.textContent).toBe('');
  });

  it('is one icon button named after the count, with the count in a badge, and no text of the notices until it is opened', () => {
    render(<NoticesButton items={[A, B]} />);
    const button = screen.getByRole('button', { name: '2 notices' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button.parentElement?.textContent).toContain('2');
    expect(screen.queryByText(A.summary)).toBeNull();
    render(<NoticesButton items={[A]} />);
    expect(screen.getByRole('button', { name: '1 notice' })).toBeInTheDocument();
  });

  it('takes the colour of the worst severity: error over warning', () => {
    const { rerender } = render(<NoticesButton items={[A]} />);
    expect(screen.getByRole('button', { name: '1 notice' }).className).toContain('text-warning-text');
    rerender(<NoticesButton items={[A, B]} />);
    const button = screen.getByRole('button', { name: '2 notices' });
    expect(button.className).toContain('text-danger-text');
    expect(button.className).not.toContain('text-warning-text');
  });

  it('opens a panel under it listing each notice: title, detail text, Copy fix when there is a command, a dismiss each', () => {
    render(<NoticesButton items={[A, B]} />);
    open();
    const panel = screen.getByRole('dialog', { name: 'Notices' });
    expect(panel).toBeInTheDocument();
    expect(screen.getByText(A.summary)).toBeInTheDocument();
    expect(screen.getByText(A.details)).toBeInTheDocument();
    expect(screen.getByText(B.summary)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Copy fix' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: `Dismiss: ${A.summary}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss all' })).toBeInTheDocument();
  });

  it('a long detail text is cut with a More button that shows it whole (nothing is lost)', () => {
    render(<NoticesButton items={[LONG]} />);
    open();
    expect(screen.queryByText(/THE-END/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByText(/THE-END/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Less' }));
    expect(screen.queryByText(/THE-END/)).toBeNull();
  });

  it('Copy fix copies the command and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<NoticesButton items={[A]} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Copy fix' }));
    expect(writeText).toHaveBeenCalledWith('agent-manager start --detach');
    expect(await screen.findByText(/copied/i)).toBeInTheDocument();
  });

  it('a clipboard that refuses is said, with the command to type', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    render(<NoticesButton items={[A]} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Copy fix' }));
    expect(await screen.findByText(/could not copy.*agent-manager start --detach/i)).toBeInTheDocument();
  });

  it('a notice with an action shows its button', () => {
    const run = vi.fn();
    render(<NoticesButton items={[{ ...B, action: { label: 'Remove it from the address', run } }]} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Remove it from the address' }));
    expect(run).toHaveBeenCalled();
  });

  it('Escape closes the panel and the focus goes back to the button', () => {
    render(<NoticesButton items={[A]} />);
    open();
    expect(screen.getByRole('dialog', { name: 'Notices' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Notices' })).toBeNull();
    expect(screen.getByRole('button', { name: '1 notice' })).toHaveFocus();
  });

  it('a press outside closes the panel, a press inside does not', () => {
    render(
      <div>
        <p>elsewhere</p>
        <NoticesButton items={[A]} />
      </div>,
    );
    open();
    fireEvent.pointerDown(screen.getByText(A.summary));
    expect(screen.getByRole('dialog', { name: 'Notices' })).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByText('elsewhere'));
    expect(screen.queryByRole('dialog', { name: 'Notices' })).toBeNull();
  });

  it('keeps inside a 390 px window: the panel spans the window on a narrow screen and hangs under the button from the sm breakpoint', () => {
    render(<NoticesButton items={[A]} />);
    open();
    const classes = screen.getByRole('dialog', { name: 'Notices' }).className;
    expect(classes).toMatch(/\bfixed\b/);
    expect(classes).toMatch(/\binset-x-2\b/);
    expect(classes).toMatch(/\bsm:absolute\b/);
    expect(classes).toMatch(/\bmax-h-/);
    expect(classes).toMatch(/\boverflow-y-auto\b/);
  });

  it('dismiss removes the notice, the button counts the rest, and the dismissal is stored for the browser session', () => {
    render(<NoticesButton items={[A, B]} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: `Dismiss: ${A.summary}` }));
    expect(screen.queryByText(A.summary)).toBeNull();
    expect(screen.getByRole('button', { name: '1 notice' })).toBeInTheDocument();
    expect(JSON.parse(window.sessionStorage.getItem('agent-manager.dismissedNotices') ?? '[]')).toEqual([A.details]);
  });

  it('Dismiss all removes the button itself (it shows only while a notice is active)', () => {
    render(<NoticesButton items={[A, B]} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss all' }));
    expect(screen.queryByRole('button', { name: /notices?$/ })).toBeNull();
    expect(JSON.parse(window.sessionStorage.getItem('agent-manager.dismissedNotices') ?? '[]')).toEqual([A.details, B.details]);
  });

  it('the dismissed ones are one click away from the open panel (never gone for good)', () => {
    render(<NoticesButton items={[A, B]} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: `Dismiss: ${A.summary}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore 1 dismissed' }));
    expect(screen.getByText(A.summary)).toBeInTheDocument();
    expect(window.sessionStorage.getItem('agent-manager.dismissedNotices')).toBeNull();
  });

  it('a dismissal stays after a remount, but a changed text shows again', () => {
    const { unmount } = render(<NoticesButton items={[A]} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: `Dismiss: ${A.summary}` }));
    unmount();
    const again = render(<NoticesButton items={[A]} />);
    expect(screen.queryByRole('button', { name: /notices?$/ })).toBeNull();
    again.unmount();
    render(<NoticesButton items={[{ ...A, details: `${A.details} (changed)` }]} />);
    expect(screen.getByRole('button', { name: '1 notice' })).toBeInTheDocument();
  });

  it('says "not remembered" when the browser refuses to store the dismissal, and still hides the notice for now', () => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota exceeded');
    };
    try {
      render(<NoticesButton items={[A, B]} />);
      open();
      expect(screen.queryByText(/not remembered/i)).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: `Dismiss: ${A.summary}` }));
      expect(screen.queryByText(A.summary)).toBeNull();
      expect(screen.getByText(/not remembered.*quota exceeded.*(reload|come back)/i)).toBeInTheDocument();
    } finally {
      Storage.prototype.setItem = real;
    }
  });

  it('an item with its own dismiss calls it and is not stored', () => {
    const onDismiss = vi.fn();
    render(<NoticesButton items={[{ ...B, onDismiss }]} />);
    open();
    fireEvent.click(screen.getByRole('button', { name: `Dismiss: ${B.summary}` }));
    expect(onDismiss).toHaveBeenCalled();
    expect(window.sessionStorage.getItem('agent-manager.dismissedNotices')).toBeNull();
  });

  it('announces the count politely (an error assertively) without opening the panel', () => {
    const { rerender } = render(<NoticesButton items={[A]} />);
    expect(screen.getByRole('status')).toHaveTextContent('1 notice');
    rerender(<NoticesButton items={[A, B]} />);
    expect(screen.getByRole('alert')).toHaveTextContent('2 notices');
  });
});
