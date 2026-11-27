import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VIEW_OPTIONS, type ViewOptions } from '../logic/viewOptions.js';
import { MODE_LABEL, MODES, type ModeId } from '../shared.js';
import { ListLayoutMenu } from './ListLayoutMenu.js';

const TRIGGER = 'List layout and view options';
const button = () => screen.getByRole('button', { name: TRIGGER });
const focusedName = () => document.activeElement?.querySelector('[data-mode-name]')?.textContent;

function menu(mode: ModeId, { onMode = vi.fn<(mode: ModeId) => void>(), onOptions = vi.fn<(next: ViewOptions) => void>(), options = DEFAULT_VIEW_OPTIONS }: { onMode?: (mode: ModeId) => void; onOptions?: (next: ViewOptions) => void; options?: ViewOptions } = {}) {
  return { onMode, onOptions, ...render(<ListLayoutMenu mode={mode} onMode={onMode} options={options} onOptions={onOptions} />) };
}

describe('ListLayoutMenu: the one configuration control of the list', () => {
  it('is ONE icon button, closed at first, with the same name and the same icon in every mode (the mode is not in the icon)', () => {
    const shapes = MODES.map((mode) => {
      const { unmount } = menu(mode);
      expect(button()).toHaveAttribute('aria-haspopup', 'dialog');
      expect(button()).toHaveAttribute('aria-expanded', 'false');
      expect(button().textContent).toBe('');
      expect(button().querySelectorAll('svg')).toHaveLength(1);
      const html = button().querySelector('svg')?.innerHTML ?? '';
      unmount();
      return html;
    });
    expect(new Set(shapes).size).toBe(1);
    menu('tree');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a popup with four titled sections cut by a divider: Layout, View, Chat, then Rows', () => {
    menu('tree');
    fireEvent.click(button());
    const panel = screen.getByRole('dialog', { name: TRIGGER });
    expect([...panel.querySelectorAll('[data-section-title]')].map((title) => title.textContent)).toEqual(['Layout', 'View', 'Chat', 'Rows']);
    expect(panel.querySelector('[data-section="view"]')?.className).toContain('border-t');
    expect(button()).toHaveAttribute('aria-expanded', 'true');
  });

  it('Layout: four choices with icon, name and hint, the current one checked (a check mark) and focused', () => {
    menu('inbox');
    fireEvent.click(button());
    const items = within(screen.getByRole('radiogroup', { name: 'Layout' })).getAllByRole('radio');
    expect(items.map((item) => item.querySelector('[data-mode-name]')?.textContent)).toEqual(MODES.map((mode) => MODE_LABEL[mode]));
    for (const item of items) {
      expect(item.querySelectorAll('svg').length).toBeGreaterThanOrEqual(1);
      expect(item.querySelector('[data-mode-hint]')?.textContent?.length ?? 0).toBeGreaterThan(10);
    }
    const current = screen.getByRole('radio', { name: /^Inbox/ });
    expect(current).toHaveAttribute('aria-checked', 'true');
    expect(current).toHaveFocus();
    expect(items.filter((item) => item.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    // The check mark is inside the current item only.
    expect(items.filter((item) => item.querySelectorAll('svg').length === 2)).toEqual([current]);
  });

  it('a click on a layout picks it and closes the popup, the focus goes back to the button', () => {
    const { onMode } = menu('tree');
    fireEvent.click(button());
    fireEvent.click(screen.getByRole('radio', { name: /^Custom/ }));
    expect(onMode).toHaveBeenCalledWith('custom');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button()).toHaveFocus();
  });

  it('the arrow keys move the focus (wrapping, Home and End too) without picking', () => {
    const { onMode } = menu('tree');
    fireEvent.click(button());
    expect(focusedName()).toBe('Tree');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(focusedName()).toBe('Groups');
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(focusedName()).toBe('Custom');
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(focusedName()).toBe('Tree');
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(focusedName()).toBe('Custom');
    expect(onMode).not.toHaveBeenCalled();
  });

  it.each(['Enter', ' '])('the key %j picks the focused layout and closes the popup', (key) => {
    const { onMode } = menu('tree');
    fireEvent.click(button());
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key });
    expect(onMode).toHaveBeenCalledExactlyOnceWith('groups');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button()).toHaveFocus();
  });

  it('ArrowDown on the closed button opens it; Escape closes it with the focus back on the button, nothing picked', () => {
    const { onMode } = menu('tree');
    fireEvent.keyDown(button(), { key: 'ArrowDown' });
    expect(screen.getByRole('dialog', { name: TRIGGER })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button()).toHaveFocus();
    expect(onMode).not.toHaveBeenCalled();
  });

  it('a press outside closes it', () => {
    render(
      <div>
        <p>elsewhere</p>
        <ListLayoutMenu mode="tree" onMode={vi.fn()} options={DEFAULT_VIEW_OPTIONS} onOptions={vi.fn()} />
      </div>,
    );
    fireEvent.click(button());
    fireEvent.pointerDown(screen.getByText('elsewhere'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps inside a 390 px window: spans the window below sm, hangs from the button from sm, with the shared popup surface', () => {
    menu('tree');
    fireEvent.click(button());
    const classes = screen.getByRole('dialog').className;
    expect(classes).toMatch(/\bfixed\b/);
    expect(classes).toMatch(/\binset-x-2\b/);
    expect(classes).toMatch(/\bsm:absolute\b/);
    expect(classes).toMatch(/\bz-30\b/);
    expect(classes).toContain('color-mix');
  });
});

describe('ListLayoutMenu: the View section holds the options of the current layout', () => {
  const viewOf = () => screen.getByRole('dialog').querySelector('[data-section="view"]') as HTMLElement;
  const open = (mode: ModeId, onOptions = vi.fn()) => {
    menu(mode, { onOptions });
    fireEvent.click(button());
    return onOptions;
  };

  it.each(['tree', 'custom'] as const)('%s: "Show sub-agents under each agent" is off by default and turning it on reports the new options', (mode) => {
    const onOptions = open(mode);
    const toggle = within(viewOf()).getByRole('switch', { name: 'Show sub-agents under each agent' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(onOptions).toHaveBeenCalledWith({ ...DEFAULT_VIEW_OPTIONS, subagents: { show: true } });
  });

  it.each(['groups', 'inbox'] as const)('%s: no sub-agents option (those rows have no children)', (mode) => {
    open(mode);
    expect(within(viewOf()).queryByRole('switch', { name: 'Show sub-agents under each agent' })).toBeNull();
  });

  it('tree: grouping and expansion', () => {
    const onOptions = open('tree');
    expect(within(viewOf()).getByRole('radio', { name: /By workspace/ })).toBeChecked();
    fireEvent.click(within(viewOf()).getByRole('radio', { name: /^None/ }));
    expect(onOptions).toHaveBeenCalledWith({ ...DEFAULT_VIEW_OPTIONS, tree: { ...DEFAULT_VIEW_OPTIONS.tree, grouping: 'none' } });
  });

  it('says only true things: no stale text about a sub-agent count in rows or about a dock question', () => {
    open('custom');
    const text = screen.getByRole('dialog').textContent ?? '';
    expect(text).not.toMatch(/keep the sub-agent count|dock|question/i);
    expect(text).toContain('Group settings');
  });

  it('names the layout its options belong to', () => {
    open('groups');
    expect(viewOf().textContent).toContain('Options of the Groups layout');
  });
});
