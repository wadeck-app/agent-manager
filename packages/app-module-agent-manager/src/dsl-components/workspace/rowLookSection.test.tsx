import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RowLookProvider, useRowLookControl } from '../lists/RowLookContext.js';
import { DEFAULT_ROW_LOOK, type RowLook } from '../logic/rowLook.js';
import { DEFAULT_VIEW_OPTIONS } from '../logic/viewOptions.js';
import { ListLayoutMenu } from './ListLayoutMenu.js';

function Page({ onLook }: { onLook: (look: RowLook) => void }) {
  const [look, setLook] = useState<RowLook>(DEFAULT_ROW_LOOK);
  return (
    <RowLookProvider
      look={look}
      setLook={(next) => {
        onLook(next);
        setLook(next);
      }}
    >
      <ListLayoutMenu mode="tree" onMode={vi.fn()} options={DEFAULT_VIEW_OPTIONS} onOptions={vi.fn()} />
    </RowLookProvider>
  );
}

function openRows() {
  const onLook = vi.fn<(look: RowLook) => void>();
  render(<Page onLook={onLook} />);
  fireEvent.click(screen.getByRole('button', { name: 'List layout and view options' }));
  const section = document.querySelector<HTMLElement>('[data-section="rows"]') as HTMLElement;
  return { onLook, section };
}

describe('the Rows section of the list menu', () => {
  it('is in the same popup as Layout and View, with a titled and separated section', () => {
    const { section } = openRows();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(section.className).toContain('border-t');
    expect(within(section).getByText('Rows')).toBeInTheDocument();
  });

  it('a swatch row per state, each swatch with an accessible name; the default one is checked', () => {
    const { section } = openRows();
    const needs = within(section).getByRole('radiogroup', { name: 'Needs you: row background' });
    expect(within(needs).getByRole('radio', { name: 'Red' })).toBeChecked();
    expect(within(needs).getByRole('radio', { name: 'No background' })).not.toBeChecked();
    expect(within(within(section).getByRole('radiogroup', { name: /^Flagged/ })).getByRole('radio', { name: 'Orange' })).toBeChecked();
    expect(within(within(section).getByRole('radiogroup', { name: /^Blue dot/ })).getByRole('radio', { name: 'Theme accent' })).toBeChecked();
  });

  it('picking a swatch changes only that field and saves through the provider', () => {
    const { section, onLook } = openRows();
    fireEvent.click(within(within(section).getByRole('radiogroup', { name: /^Needs you/ })).getByRole('radio', { name: 'No background' }));
    expect(onLook).toHaveBeenLastCalledWith({ ...DEFAULT_ROW_LOOK, needs: 'off' });
  });

  it('the arrow keys move the pick inside a swatch row (one tab stop: the checked one)', () => {
    const { section, onLook } = openRows();
    const group = within(section).getByRole('radiogroup', { name: /^Needs you/ });
    const red = within(group).getByRole('radio', { name: 'Red' });
    expect(within(group).getAllByRole('radio').filter((radio) => radio.getAttribute('tabindex') === '0')).toEqual([red]);
    fireEvent.keyDown(red, { key: 'ArrowRight' });
    expect(onLook).toHaveBeenLastCalledWith({ ...DEFAULT_ROW_LOOK, needs: 'orange' });
    fireEvent.keyDown(red, { key: 'ArrowLeft' });
    expect(onLook).toHaveBeenLastCalledWith({ ...DEFAULT_ROW_LOOK, needs: 'off' });
  });

  it('the open row: background choice, bar and outline toggles, highlight and gradient colors', () => {
    const { section, onLook } = openRows();
    expect(within(section).getByRole('radio', { name: 'Gradient, strong on the left' })).toBeChecked();
    fireEvent.click(within(section).getByRole('radio', { name: 'Gradient, strong on the right' }));
    expect(onLook).toHaveBeenLastCalledWith({ ...DEFAULT_ROW_LOOK, focusBg: 'gradient-rtl' });
    fireEvent.click(within(section).getByRole('switch', { name: 'Bar on the left' }));
    expect(onLook).toHaveBeenLastCalledWith({ ...DEFAULT_ROW_LOOK, focusBg: 'gradient-rtl', focusBar: true });
    fireEvent.click(within(section).getByRole('switch', { name: 'Outline' }));
    expect(onLook).toHaveBeenLastCalledWith({ ...DEFAULT_ROW_LOOK, focusBg: 'gradient-rtl', focusBar: true, focusOutline: false });
    fireEvent.click(within(within(section).getByRole('radiogroup', { name: /^Highlight color/ })).getByRole('radio', { name: 'Blue' }));
    expect(onLook).toHaveBeenLastCalledWith(expect.objectContaining({ focusColor: 'blue', gradientColor: 'gold' }));
    fireEvent.click(within(within(section).getByRole('radiogroup', { name: 'Gradient color' })).getByRole('radio', { name: 'Theme accent' }));
    expect(onLook).toHaveBeenLastCalledWith(expect.objectContaining({ gradientColor: 'accent' }));
  });

  it('the two name toggles use the Herdr labels, are off by default and turn on', () => {
    const { section, onLook } = openRows();
    const bold = within(section).getByRole('switch', { name: 'Bold name for the active session' });
    const dim = within(section).getByRole('switch', { name: 'Dim the name of idle sessions' });
    expect(bold).not.toBeChecked();
    expect(dim).not.toBeChecked();
    fireEvent.click(bold);
    expect(onLook).toHaveBeenLastCalledWith({ ...DEFAULT_ROW_LOOK, boldActive: true });
    fireEvent.click(dim);
    expect(onLook).toHaveBeenLastCalledWith({ ...DEFAULT_ROW_LOOK, boldActive: true, dimIdle: true });
  });

  it('Reset restores every default at once', () => {
    const { section, onLook } = openRows();
    fireEvent.click(within(section).getByRole('switch', { name: 'Bold name for the active session' }));
    fireEvent.click(within(within(section).getByRole('radiogroup', { name: /^Needs you/ })).getByRole('radio', { name: 'Green' }));
    fireEvent.click(within(section).getByRole('button', { name: 'Reset rows to defaults' }));
    expect(onLook).toHaveBeenLastCalledWith(DEFAULT_ROW_LOOK);
    expect(within(section).getByRole('switch', { name: 'Bold name for the active session' })).not.toBeChecked();
  });

  it('without a provider the setter fails loudly instead of doing nothing', () => {
    let control: ReturnType<typeof useRowLookControl> | undefined;
    function Probe() {
      control = useRowLookControl();
      return null;
    }
    render(<Probe />);
    expect(control?.look).toEqual(DEFAULT_ROW_LOOK);
    expect(() => control?.setLook(DEFAULT_ROW_LOOK)).toThrow(/no RowLookProvider/);
  });
});
