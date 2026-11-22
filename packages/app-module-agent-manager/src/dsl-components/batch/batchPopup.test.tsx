import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchPopup, DOCK_GAP, DOCK_TAB } from './BatchPopup.js';

let observers: { cb: () => void; target: Element | undefined }[];

beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly entry: { cb: () => void; target: Element | undefined };
      constructor(cb: () => void) {
        this.entry = { cb, target: undefined };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.target = target;
      }
      disconnect() {}
      unobserve() {}
    },
  );
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.querySelectorAll('[data-testid="ab-dock-frame"]').forEach((frame) => frame.remove());
});

/** A stand-in for the A/B dock frame: only its top edge and whether the dock is open matter. */
function addDock(top: { value: number }, open: boolean): HTMLElement {
  const frame = document.createElement('div');
  frame.setAttribute('data-testid', 'ab-dock-frame');
  frame.getBoundingClientRect = () => ({ top: top.value, bottom: 776, height: 776 - top.value, left: 0, right: 0, width: 0, x: 0, y: top.value, toJSON: () => ({}) });
  const dock = document.createElement('div');
  dock.setAttribute('data-testid', 'ab-dock');
  if (!open) {
    dock.hidden = true;
  }
  frame.appendChild(dock);
  document.body.appendChild(frame);
  return frame;
}

const bottomOf = (): string => (screen.getByTestId('batch-popup-strip') as HTMLElement).style.bottom;

describe('the batch popup', () => {
  it('is absent with no selection and exposes the toolbar with its name, the count, Clear and its actions otherwise', () => {
    const { rerender } = render(<BatchPopup count={0} onClear={vi.fn()}>actions</BatchPopup>);
    expect(screen.queryByRole('toolbar')).toBeNull();
    rerender(<BatchPopup count={2} onClear={vi.fn()}><button type="button">act</button></BatchPopup>);
    const bar = screen.getByRole('toolbar', { name: 'Actions on the selected sessions' });
    expect(within(bar).getByText('2 selected')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'act' })).toBeInTheDocument();
  });

  it('Clear calls onClear', () => {
    const onClear = vi.fn();
    render(<BatchPopup count={1} onClear={onClear}>x</BatchPopup>);
    screen.getByRole('button', { name: 'Clear the selection (Escape)' }).click();
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('is fixed, centred on the content area from the shell inset, and not inside the component container', () => {
    const { container } = render(<BatchPopup count={1} onClear={vi.fn()}>x</BatchPopup>);
    const strip = screen.getByTestId('batch-popup-strip');
    expect(strip.className).toContain('fixed');
    expect(strip.className).toContain('justify-center');
    expect(strip.style.left).toBe('var(--ab-dock-inset-left, var(--app-shell-menu-width, 0px))');
    expect(strip.style.right).toBe('0px');
    expect(container.contains(strip)).toBe(false);
  });

  it('stays below the dialogs (z-50) and above the page', () => {
    render(<BatchPopup count={1} onClear={vi.fn()}>x</BatchPopup>);
    expect(screen.getByTestId('batch-popup-strip').className).toContain('z-40');
  });

  it('with no dock it sits at the bottom of the window', () => {
    render(<BatchPopup count={1} onClear={vi.fn()}>x</BatchPopup>);
    expect(bottomOf()).toBe('24px');
  });

  it('above an open dock: dock top + the tab on its edge + 8 px', () => {
    const top = { value: 650 };
    addDock(top, true);
    render(<BatchPopup count={1} onClear={vi.fn()}>x</BatchPopup>);
    expect(DOCK_GAP).toBe(8);
    expect(bottomOf()).toBe(`${800 - 650 + DOCK_TAB + DOCK_GAP}px`);
  });

  it('above a folded dock (pill): dock top + 8 px, no tab', () => {
    addDock({ value: 740 }, false);
    render(<BatchPopup count={1} onClear={vi.fn()}>x</BatchPopup>);
    expect(bottomOf()).toBe(`${800 - 740 + DOCK_GAP}px`);
  });

  it('is recomputed when the dock resizes and when the window resizes', () => {
    const top = { value: 740 };
    const frame = addDock(top, false);
    render(<BatchPopup count={1} onClear={vi.fn()}>x</BatchPopup>);
    expect(bottomOf()).toBe('68px');
    top.value = 600;
    const observer = observers.find((o) => o.target === frame);
    expect(observer).toBeDefined();
    act(() => observer?.cb());
    expect(bottomOf()).toBe('208px');
    top.value = 510;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(bottomOf()).toBe('198px');
  });

  it('appears with a transition: hidden state first, shown after a frame', async () => {
    vi.useFakeTimers();
    render(<BatchPopup count={1} onClear={vi.fn()}>x</BatchPopup>);
    const bar = screen.getByRole('toolbar');
    expect(bar.className).toContain('transition');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(bar.className).toContain('opacity-100');
    vi.useRealTimers();
  });
});

describe('the room the page keeps for the popup', () => {
  const reserve = (): string => document.documentElement.style.getPropertyValue('--batch-popup-reserve');

  it('publishes the popup footprint (floor + its height + gap) while shown, so the page can lift its bottom row, and removes it on clear and on unmount', () => {
    const { rerender, unmount } = render(<BatchPopup count={0} onClear={vi.fn()}>x</BatchPopup>);
    expect(reserve()).toBe('');
    rerender(<BatchPopup count={2} onClear={vi.fn()}>x</BatchPopup>);
    // jsdom lays nothing out: the toolbar is 0 px high, so 24 (floor) + 0 + 8 (gap).
    expect(reserve()).toBe('32px');
    rerender(<BatchPopup count={0} onClear={vi.fn()}>x</BatchPopup>);
    expect(reserve()).toBe('');
    rerender(<BatchPopup count={2} onClear={vi.fn()}>x</BatchPopup>);
    unmount();
    expect(reserve()).toBe('');
  });

  it('does not follow the dock: with the dock open the room stays the one above the window bottom', () => {
    addDock({ value: 400 }, true);
    render(<BatchPopup count={1} onClear={vi.fn()}>x</BatchPopup>);
    expect(reserve()).toBe('32px');
  });
});
