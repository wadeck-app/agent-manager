import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { row } from '../logic/fixtures.js';
import { HerdrRowBody } from './HerdrRowBody.js';
import { RowIconButton } from './RowIconButton.js';

describe('RowIconButton', () => {
  it('is out of the tab order, named, and a click does not reach the row under it', () => {
    const onRow = vi.fn();
    const onClick = vi.fn();
    render(
      <div onClick={onRow}>
        <RowIconButton label="Move x" icon={<svg />} onClick={onClick} />
      </div>,
    );
    const button = screen.getByRole('button', { name: 'Move x' });
    expect(button).toHaveAttribute('tabindex', '-1');
    expect(button).toHaveAttribute('type', 'button');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onRow).not.toHaveBeenCalled();
  });

  it('has two sizes only: 28 px (default) and 36 px, the sizes of the icon buttons of dsl-ui', () => {
    const { rerender } = render(<RowIconButton label="a" icon={<svg />} onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveClass('h-7', 'w-7');
    rerender(<RowIconButton label="a" icon={<svg />} size="md" onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveClass('h-9', 'w-9');
  });

  it('passes aria attributes and an extra class (the hover reveal of a header), and gives the click event (to place a popup)', () => {
    let target: EventTarget | null = null;
    const onClick = vi.fn((event: { currentTarget: EventTarget }) => {
      target = event.currentTarget;
    });
    render(<RowIconButton label="Menu" icon={<svg />} aria-haspopup="menu" className="opacity-0" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Menu' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveClass('opacity-0');
    fireEvent.click(button);
    expect(target).toBe(button);
  });
});

describe('the Herdr row uses it', () => {
  it('its hover buttons are row icon buttons of 28 px', () => {
    const { container } = render(<HerdrRowBody session={row({ folder: 'shop', displayName: 'billing-owner' })} density="herdr-tinted" now={2_000_000} terms={undefined} showSlot subagents={undefined} onMove={vi.fn()} onMenu={vi.fn()} />);
    const buttons = container.querySelectorAll('[data-herdr-actions] button');
    expect(buttons).toHaveLength(2);
    for (const button of Array.from(buttons)) {
      expect(button).toHaveAttribute('data-row-icon-button');
      expect(button).toHaveClass('h-7', 'w-7');
    }
  });
});
