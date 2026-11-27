import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SelectionProvider, useSelection } from '../lists/selection.js';
import { UI_QUESTIONS } from '../logic/uiVariants.js';
import { SelectionEntry } from './SelectionEntry.js';

const IDS = ['a', 'b', 'c'];

function State() {
  const selection = useSelection();
  return <output aria-label="state">{`${selection?.mode === true ? 'on' : 'off'}:${[...(selection?.selected ?? [])].sort().join(',')}`}</output>;
}

function Toolbar() {
  return (
    <SelectionProvider existing={new Set(IDS)}>
      <SelectionEntry ids={IDS} />
      <State />
    </SelectionProvider>
  );
}

const state = (): string => screen.getByLabelText('state').textContent ?? '';
const toggle = (): HTMLElement => screen.getByRole('button', { name: 'Selection mode' });

describe('the entry point of the selection mode (one icon toggle, settled)', () => {
  it('is not an A/B question any more', () => {
    expect(Object.keys(UI_QUESTIONS)).not.toContain('selectionEntry');
  });

  it('is one icon-only toggle with a pressed state, and no checkbox, no Select button', () => {
    render(<Toolbar />);
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    expect(toggle()).not.toHaveTextContent('Select');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull();
  });

  it('the toggle never changes meaning: the first click turns the mode on, the second leaves it and clears the selection', () => {
    render(<Toolbar />);
    expect(state()).toBe('off:');
    expect(screen.queryByRole('button', { name: /Select (all|none)/ })).toBeNull();
    fireEvent.click(toggle());
    expect(state()).toBe('on:');
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(state()).toBe('on:a,b,c');
    // The same button is still the toggle: it leaves the mode (and clears), it does not select all.
    fireEvent.click(toggle());
    expect(state()).toBe('off:');
    expect(screen.queryByRole('button', { name: /Select (all|none)/ })).toBeNull();
  });

  it('Select all is a labelled button beside the toggle that says Select none once everything is ticked', () => {
    render(<Toolbar />);
    fireEvent.click(toggle());
    expect(screen.getByRole('button', { name: 'Select all' })).toHaveTextContent('Select all');
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select none' }));
    expect(state()).toBe('on:');
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
  });

  it('the Select all slot is there before the mode is on (reserved room: nothing shifts), right of the toggle', () => {
    const { container } = render(<Toolbar />);
    const slot = container.querySelector<HTMLElement>('[data-select-all-slot]');
    expect(slot).not.toBeNull();
    expect(slot?.className).toContain('min-w-');
    expect(slot?.childElementCount).toBe(0);
    fireEvent.click(toggle());
    expect(slot?.querySelector('[data-select-all]')).not.toBeNull();
    expect(toggle().compareDocumentPosition(slot as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the pressed state is the primary fill, and Select all has its own icon (not the toggle one)', () => {
    render(<Toolbar />);
    const off = toggle().className;
    fireEvent.click(toggle());
    expect(toggle().className).not.toBe(off);
    expect(toggle().className).toContain('bg-[var(--color-primary-solid)]');
    const toggleIcon = toggle().querySelector('svg')?.getAttribute('class') ?? '';
    const allIcon = screen.getByRole('button', { name: 'Select all' }).querySelector('svg')?.getAttribute('class') ?? '';
    expect(toggleIcon).toContain('lucide-list-checks');
    expect(allIcon).toContain('lucide-check-check');
  });
});
