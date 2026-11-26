import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SelectionProvider, useSelection } from '../lists/selection.js';
import { DEFAULT_UI_VARIANTS, type SelectionEntryVariant } from '../logic/uiVariants.js';
import { UiVariantsContext } from '../ui/UiVariants.js';
import { SelectionEntry } from './SelectionEntry.js';

const IDS = ['a', 'b', 'c'];

function State() {
  const selection = useSelection();
  return <output aria-label="state">{`${selection?.mode === true ? 'on' : 'off'}:${[...(selection?.selected ?? [])].sort().join(',')}`}</output>;
}

function Toolbar({ variant }: { variant: SelectionEntryVariant }) {
  return (
    <UiVariantsContext.Provider value={{ ...DEFAULT_UI_VARIANTS, selectionEntry: variant }}>
      <SelectionProvider existing={new Set(IDS)}>
        <div data-testid="title">
          <SelectionEntry slot="title" ids={IDS} />
        </div>
        <div data-testid="actions">
          <SelectionEntry slot="actions" ids={IDS} />
        </div>
        <State />
      </SelectionProvider>
    </UiVariantsContext.Provider>
  );
}

const state = (): string => screen.getByLabelText('state').textContent ?? '';

describe('the entry point of the selection mode (A/B question ui-selection-entry)', () => {
  it.each(['checkbox', 'button', 'icon'] as const)('%s: drawn in its own slot only, nothing in the other', (variant) => {
    render(<Toolbar variant={variant} />);
    const slot = variant === 'checkbox' ? 'title' : 'actions';
    const other = slot === 'title' ? 'actions' : 'title';
    expect(screen.getByTestId(slot).querySelector('[data-selection-entry]')).toHaveAttribute('data-selection-entry', variant);
    expect(screen.getByTestId(other).querySelector('[data-selection-entry]')).toBeNull();
  });

  it('the three variants look different: a checkbox, a labelled button, an icon-only toggle', () => {
    const checkbox = render(<Toolbar variant="checkbox" />);
    expect(screen.getByRole('checkbox', { name: 'Selection mode' })).toBeInTheDocument();
    checkbox.unmount();
    const button = render(<Toolbar variant="button" />);
    expect(screen.getByRole('button', { name: 'Select' })).toHaveTextContent('Select');
    button.unmount();
    render(<Toolbar variant="icon" />);
    const icon = screen.getByRole('button', { name: 'Selection mode' });
    expect(icon).toHaveAttribute('aria-pressed', 'false');
    expect(icon).not.toHaveTextContent('Select');
  });

  it.each([
    ['checkbox', () => screen.getByRole('checkbox', { name: 'Selection mode' })],
    ['button', () => screen.getByRole('button', { name: /^(Select|Cancel)$/ })],
    ['icon', () => screen.getByRole('button', { name: 'Selection mode' })],
  ] as const)('%s: the toggle turns the mode on, Select all appears next to it, and turning it off clears the selection', (variant, toggle) => {
    render(<Toolbar variant={variant} />);
    expect(state()).toBe('off:');
    expect(screen.queryByRole('button', { name: /Select all/ })).toBeNull();
    fireEvent.click(toggle());
    expect(state()).toBe('on:');
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(state()).toBe('on:a,b,c');
    // All ticked: the same button says Select none and clears them.
    fireEvent.click(screen.getByRole('button', { name: 'Select none' }));
    expect(state()).toBe('on:');
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.click(toggle());
    expect(state()).toBe('off:');
    expect(screen.queryByRole('button', { name: /Select (all|none)/ })).toBeNull();
  });
});

describe('the selection mode controls are never two checkboxes in a row', () => {
  it.each(['checkbox', 'button', 'icon'] as const)('%s: once the mode is on, at most one checkbox is in the toolbar and Select all is a labelled button', (variant) => {
    render(<Toolbar variant={variant} />);
    const toggle = variant === 'checkbox' ? screen.getByRole('checkbox', { name: 'Selection mode' }) : variant === 'button' ? screen.getByRole('button', { name: 'Select' }) : screen.getByRole('button', { name: 'Selection mode' });
    fireEvent.click(toggle);
    expect(screen.queryAllByRole('checkbox').length).toBeLessThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Select all' })).toHaveTextContent('Select all');
  });

  it('checkbox: the toggle carries its word and shows a pressed look while on', () => {
    render(<Toolbar variant="checkbox" />);
    const label = document.querySelector('[data-selection-entry="checkbox"]') as HTMLElement;
    expect(label).toHaveTextContent('Select');
    expect(label.className).not.toContain('bg-primary-light');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selection mode' }));
    expect(label.className).toContain('bg-primary-light');
  });
});
