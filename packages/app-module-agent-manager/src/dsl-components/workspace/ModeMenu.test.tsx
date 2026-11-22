import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MODE_LABEL, MODES } from '../shared.js';
import { ModeMenu } from './ModeMenu.js';

const button = (name: string) => screen.getByRole('button', { name });
const focusedName = () => document.activeElement?.querySelector('[data-mode-name]')?.textContent;

describe('ModeMenu', () => {
  it('is ONE icon button named after the current mode, the same size as the other toolbar icon buttons, closed at first', () => {
    render(<ModeMenu mode="groups" onMode={vi.fn()} />);
    const trigger = button('List mode: Groups');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger.className).toMatch(/\bh-9\b/);
    expect(trigger.className).toMatch(/\bw-9\b/);
    expect(trigger.querySelectorAll('svg')).toHaveLength(1);
    expect(trigger.textContent).toBe('');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('shows the icon of the current mode (a different one per mode)', () => {
    const shapes = MODES.map((mode) => {
      const { unmount } = render(<ModeMenu mode={mode} onMode={vi.fn()} />);
      const html = button(`List mode: ${MODE_LABEL[mode]}`).querySelector('svg')!.innerHTML;
      unmount();
      return html;
    });
    expect(new Set(shapes).size).toBe(MODES.length);
  });

  it('opens a menu of the four modes: icon, name and hint each, the current one checked and focused', () => {
    render(<ModeMenu mode="inbox" onMode={vi.fn()} />);
    fireEvent.click(button('List mode: Inbox'));
    const menu = screen.getByRole('menu', { name: 'List mode' });
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items).toHaveLength(4);
    expect(items.map((item) => item.querySelector('[data-mode-name]')?.textContent)).toEqual(MODES.map((mode) => MODE_LABEL[mode]));
    for (const item of items) {
      expect(item.querySelectorAll('svg').length).toBeGreaterThanOrEqual(1);
      expect(item.querySelector('[data-mode-hint]')?.textContent?.length ?? 0).toBeGreaterThan(10);
    }
    expect(items.filter((item) => item.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    const current = within(menu).getByRole('menuitemradio', { name: /^Inbox/ });
    expect(current).toHaveAttribute('aria-checked', 'true');
    expect(current).toHaveFocus();
    expect(button('List mode: Inbox')).toHaveAttribute('aria-expanded', 'true');
  });

  it('a click on an item picks the mode and closes the menu, the focus goes back to the button', () => {
    const onMode = vi.fn();
    render(<ModeMenu mode="tree" onMode={onMode} />);
    fireEvent.click(button('List mode: Tree'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Custom/ }));
    expect(onMode).toHaveBeenCalledWith('custom');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button('List mode: Tree')).toHaveFocus();
  });

  it('the arrow keys move the focus (wrapping, Home and End too) without picking', () => {
    const onMode = vi.fn();
    render(<ModeMenu mode="tree" onMode={onMode} />);
    fireEvent.click(button('List mode: Tree'));
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

  it.each(['Enter', ' '])('the key %j picks the focused item and closes the menu', (key) => {
    const onMode = vi.fn();
    render(<ModeMenu mode="tree" onMode={onMode} />);
    fireEvent.click(button('List mode: Tree'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key });
    expect(onMode).toHaveBeenCalledTimes(1);
    expect(onMode).toHaveBeenCalledWith('groups');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button('List mode: Tree')).toHaveFocus();
  });

  it('ArrowDown on the closed button opens the menu', () => {
    render(<ModeMenu mode="tree" onMode={vi.fn()} />);
    fireEvent.keyDown(button('List mode: Tree'), { key: 'ArrowDown' });
    expect(screen.getByRole('menu', { name: 'List mode' })).toBeInTheDocument();
  });

  it('Escape closes it with the focus back on the button, and nothing is picked', () => {
    const onMode = vi.fn();
    render(<ModeMenu mode="tree" onMode={onMode} />);
    fireEvent.click(button('List mode: Tree'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button('List mode: Tree')).toHaveFocus();
    expect(onMode).not.toHaveBeenCalled();
  });

  it('a press outside closes it', () => {
    render(
      <div>
        <p>elsewhere</p>
        <ModeMenu mode="tree" onMode={vi.fn()} />
      </div>,
    );
    fireEvent.click(button('List mode: Tree'));
    fireEvent.pointerDown(screen.getByText('elsewhere'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps inside a 390 px window: spans the window below sm, hangs from the button from sm', () => {
    render(<ModeMenu mode="tree" onMode={vi.fn()} />);
    fireEvent.click(button('List mode: Tree'));
    const classes = screen.getByRole('menu').className;
    expect(classes).toMatch(/\bfixed\b/);
    expect(classes).toMatch(/\binset-x-2\b/);
    expect(classes).toMatch(/\bsm:absolute\b/);
    expect(classes).toMatch(/\bz-30\b/);
  });
});
