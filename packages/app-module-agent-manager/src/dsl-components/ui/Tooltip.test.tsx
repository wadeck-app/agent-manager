import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { placeTooltip, SHOW_DELAY_MS, Tooltip } from './Tooltip.js';

describe('placeTooltip', () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 200, height: 30 };

  it('puts the tooltip above the anchor, centred', () => {
    const placement = placeTooltip({ top: 400, left: 400, width: 100, height: 20 }, size, viewport, 'top');
    expect(placement).toEqual({ side: 'top', top: 400 - 8 - 30, left: 450 - 100 });
  });

  it('flips below when there is no room above', () => {
    expect(placeTooltip({ top: 10, left: 400, width: 100, height: 20 }, size, viewport, 'top').side).toBe('bottom');
  });

  it('clamps inside the viewport at the right edge (the failure of the old tooltips)', () => {
    const placement = placeTooltip({ top: 400, left: 960, width: 30, height: 20 }, size, viewport, 'top');
    expect(placement.left + size.width).toBeLessThanOrEqual(viewport.width - 8);
  });

  it('clamps at the left edge and flips a side tooltip', () => {
    expect(placeTooltip({ top: 400, left: 0, width: 20, height: 20 }, size, viewport, 'top').left).toBe(8);
    expect(placeTooltip({ top: 400, left: 900, width: 90, height: 20 }, size, viewport, 'right').side).toBe('left');
  });
});

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is absent until the delay has passed, then shown in the body and described by id', () => {
    render(
      <Tooltip content="Pin this session">
        <button type="button">Pin</button>
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: 'Pin' });
    fireEvent.pointerEnter(button.parentElement!);
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS);
    });
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Pin this session');
    expect(tip.parentElement).toBe(document.body);
    expect(button).toHaveAttribute('aria-describedby', tip.id);
  });

  it('does not show when the pointer leaves before the delay', () => {
    render(
      <Tooltip content="x">
        <button type="button">A</button>
      </Tooltip>,
    );
    const anchor = screen.getByRole('button').parentElement!;
    fireEvent.pointerEnter(anchor);
    fireEvent.pointerLeave(anchor);
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS * 2);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows at once on keyboard focus and hides on blur and on Escape', () => {
    render(
      <Tooltip content="Focus tip">
        <button type="button">A</button>
      </Tooltip>,
    );
    const button = screen.getByRole('button');
    // jsdom has no :focus-visible matching on its own: the component falls back to showing the tooltip, which is what a keyboard user needs.
    fireEvent.focus(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Focus tip');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(button);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.blur(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows one tooltip at a time among many anchors', () => {
    render(
      <div>
        {['a', 'b', 'c'].map((name) => (
          <Tooltip key={name} content={`tip ${name}`}>
            <button type="button">{name}</button>
          </Tooltip>
        ))}
      </div>,
    );
    for (const name of ['a', 'b', 'c']) {
      fireEvent.focus(screen.getByRole('button', { name }));
      expect(screen.getAllByRole('tooltip')).toHaveLength(1);
      expect(screen.getByRole('tooltip')).toHaveTextContent(`tip ${name}`);
    }
  });

  it('keeps an existing aria-describedby and removes the tooltip when it unmounts', () => {
    const { unmount } = render(
      <Tooltip content="t">
        <button type="button" aria-describedby="other">
          A
        </button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole('button'));
    expect(screen.getByRole('button').getAttribute('aria-describedby')).toMatch(/^other .+/);
    unmount();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('hides when the page scrolls', () => {
    render(
      <Tooltip content="t">
        <button type="button">A</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole('button'));
    fireEvent.scroll(window);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
