import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoticeItem } from '../logic/notices.js';
import { detailsText } from './NoticeRow.js';
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

  it('is one icon button named after the count, with no text of the notices until it is opened', () => {
    render(<NoticesButton items={[A, B]} />);
    const button = screen.getByRole('button', { name: '2 notices' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(A.summary)).toBeNull();
    render(<NoticesButton items={[A]} />);
    expect(screen.getByRole('button', { name: '1 notice' })).toBeInTheDocument();
  });

  it('is the same icon button as its neighbours (the compact icon-sm size, h-7 w-7, ghost) with a 16 px triangle', () => {
    render(<NoticesButton items={[A]} />);
    const button = screen.getByRole('button', { name: '1 notice' });
    expect(button.className).toMatch(/\bh-7\b/);
    expect(button.className).toMatch(/\bw-7\b/);
    expect(button.className).toMatch(/\brelative\b/);
    const icon = button.querySelector('svg')!;
    expect(icon.getAttribute('class')).toMatch(/\bh-4\b/);
    expect(icon.getAttribute('class')).toMatch(/\bw-4\b/);
  });

  it('shows the count as a corner badge on the top right corner of the 28 px button (half outside it, so it does not hide the triangle): 16 px minimum, 11 px tabular digits, a ring in the surface colour', () => {
    render(<NoticesButton items={[A, B]} />);
    const button = screen.getByRole('button', { name: '2 notices' });
    const badge = button.querySelector('[data-notice-count]')!;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('2');
    expect(badge).toHaveAttribute('aria-hidden', 'true');
    for (const wanted of [/\babsolute\b/, /-right-2\b/, /-top-2\b/, /\bh-4\b/, /\bmin-w-4\b/, /text-\[11px\]/, /\btabular-nums\b/, /\bleading-none\b/, /\bring-2\b/, /\bring-surface\b/, /\brounded-full\b/]) {
      expect(badge.className).toMatch(wanted);
    }
    // Only the top right corner is offset, by 8 px: the badge sits outside the triangle, and never goes over the neighbour (the toolbar gap is 8 px).
    expect(badge.className).not.toMatch(/(^|\s)-(left|bottom|m[trbl]?)-/);
  });

  it('counts 1 to 9 as is and anything above as 9+ (the name still says the real number)', () => {
    const many: NoticeItem[] = Array.from({ length: 12 }, (_, index) => ({ key: `n${index}`, tone: 'warning', summary: `S${index}`, details: `D${index}` }));
    const { rerender } = render(<NoticesButton items={many.slice(0, 9)} />);
    expect(screen.getByRole('button', { name: '9 notices' }).querySelector('[data-notice-count]')?.textContent).toBe('9');
    rerender(<NoticesButton items={many} />);
    expect(screen.getByRole('button', { name: '12 notices' }).querySelector('[data-notice-count]')?.textContent).toBe('9+');
  });

  it('the badge takes the token colours of the worst severity', () => {
    const { rerender } = render(<NoticesButton items={[A]} />);
    const badge = (): string => screen.getByRole('button', { name: /notices?$/ }).querySelector('[data-notice-count]')!.className;
    expect(badge()).toMatch(/bg-warning-bg/);
    expect(badge()).toMatch(/text-warning-text/);
    rerender(<NoticesButton items={[A, B]} />);
    expect(badge()).toMatch(/bg-danger-bg/);
    expect(badge()).toMatch(/text-danger-text/);
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
    // The fix sentence is left out of the text (the row shows the command with Copy fix): it is said once.
    expect(screen.getByText(detailsText(A))).toBeInTheDocument();
    expect(detailsText(A)).not.toContain('Fix: run');
    expect(detailsText(A)).not.toContain('`');
    expect(screen.getByText(B.summary)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Copy fix' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: `Dismiss: ${A.summary}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss all' })).toBeInTheDocument();
  });

  it('a long detail text is shown whole at once: no cut, no ellipsis, no More or Less button', () => {
    render(<NoticesButton items={[LONG]} />);
    open();
    expect(screen.getByText(/THE-END/)).toBeInTheDocument();
    const text = screen.getByText(detailsText(LONG));
    expect(screen.queryByRole('button', { name: /^(More|Less)$/ })).toBeNull();
    expect(text.className).not.toMatch(/line-clamp|truncate|text-ellipsis/);
    expect(text.className).toMatch(/\bbreak-words\b/);
  });

  it('the title is compact at the normal text size, the severity icon takes the tone, the text can be selected', () => {
    render(<NoticesButton items={[A, B]} />);
    open();
    const title = screen.getByText(A.summary);
    expect(title.className).toMatch(/\btext-sm\b/);
    expect(title.className).not.toMatch(/text-(base|lg|xl)/);
    expect(title.className).not.toMatch(/select-none/);
    expect(title.closest('[data-notice]')!.querySelector('svg')!.getAttribute('class')).toMatch(/text-warning-text/);
    expect(screen.getByText(B.summary).closest('[data-notice]')!.querySelector('svg')!.getAttribute('class')).toMatch(/text-danger-text/);
  });

  it('is a flat list with a divider above every row but the first, and the same left edge on each row, not boxes inside a box', () => {
    render(<NoticesButton items={[A, B]} />);
    open();
    // Per-side colours: a divide-y on the list would paint the left edge of the second row in the divider colour.
    expect(screen.getByRole('list').className).not.toMatch(/\bdivide-y\b/);
    for (const row of screen.getAllByRole('listitem')) {
      // No full border and no rounding (the 2 px left edge in the tone of the severity is the only line).
      expect(row.className).not.toMatch(/(^|\s)(border|border-2|rounded(-\w+)?)(\s|$)/);
      expect(row.className).toMatch(/\bborder-l-2\b/);
      expect(row.className).toMatch(/\bborder-l-(warning|danger|info-text)\b/);
      expect(row.className).toMatch(/\bborder-t-border\b/);
    }
  });

  it('shows the fix command as code next to Copy fix', () => {
    render(<NoticesButton items={[A]} />);
    open();
    const code = screen.getByText(A.fix!, { selector: 'code' });
    expect(code.className).toMatch(/\bbreak-all\b|\bbreak-words\b/);
  });

  it('Dismiss all is offered only when there is more than one notice', () => {
    const { unmount } = render(<NoticesButton items={[A]} />);
    open();
    expect(screen.queryByRole('button', { name: 'Dismiss all' })).toBeNull();
    expect(screen.getByRole('button', { name: `Dismiss: ${A.summary}` })).toBeInTheDocument();
    unmount();
    render(<NoticesButton items={[A, B]} />);
    open();
    expect(screen.getByRole('button', { name: 'Dismiss all' })).toBeInTheDocument();
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

  it('is an overlay anchored to the button (absolute, out of the flow), wide enough, scrolling inside past 70% of the window', () => {
    render(<NoticesButton items={[A]} />);
    open();
    const panel = screen.getByRole('dialog', { name: 'Notices' });
    expect(panel.className).toMatch(/\babsolute\b/);
    expect(panel.className).not.toMatch(/\b(fixed|static|relative)\b/);
    expect(panel.className).toContain('w-[min(520px,calc(100vw-1.5rem))]');
    expect(panel.className).toMatch(/\bmax-h-\[70vh\]/);
    expect(screen.getByRole('list').parentElement!.className).toMatch(/\boverflow-y-auto\b/);
  });

  it.each([
    { name: '390 px window, button at the right edge', width: 390, left: 330 },
    { name: '390 px window, button near the left', width: 390, left: 20 },
    { name: '700 px window, button in the middle', width: 700, left: 430 },
    { name: '1280 px window', width: 1280, left: 1100 },
  ])('never leaves the window: $name', ({ width, left }) => {
    const boxWidth = 36;
    const realWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const isBox = this.hasAttribute('data-notices');
      return { x: 0, y: 0, top: 0, bottom: 36, left: isBox ? left : 0, right: isBox ? left + boxWidth : 0, width: isBox ? boxWidth : 0, height: 36, toJSON: () => ({}) } as DOMRect;
    });
    try {
      render(<NoticesButton items={[A]} />);
      open();
      const panel = screen.getByRole('dialog', { name: 'Notices' });
      const panelWidth = Math.min(520, width - 24);
      // The offset is relative to the button box (the panel is absolute inside it).
      const offset = Number.parseFloat(panel.style.left);
      expect(Number.isFinite(offset)).toBe(true);
      expect(left + offset).toBeGreaterThanOrEqual(12 - 0.5);
      expect(left + offset + panelWidth).toBeLessThanOrEqual(width - 12 + 0.5);
      // Right-aligned to the button whenever it fits.
      if (left + boxWidth - panelWidth >= 12) {
        expect(left + offset + panelWidth).toBeCloseTo(left + boxWidth, 0);
      }
    } finally {
      spy.mockRestore();
      Object.defineProperty(window, 'innerWidth', { value: realWidth, configurable: true });
    }
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
