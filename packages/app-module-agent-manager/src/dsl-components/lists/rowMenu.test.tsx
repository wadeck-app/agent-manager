import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { row } from '../logic/fixtures.js';
import { RowMenu } from './RowMenu.js';

const done = row({ displayName: 'finished-one', state: 'done', statusUpdatedAt: 100 });

function open(onClose = vi.fn()) {
  const actions = { move: vi.fn(), flag: vi.fn(), unread: vi.fn(), pin: vi.fn(), seen: vi.fn() };
  render(
    <>
      <button type="button">row button</button>
      <RowMenu session={done} anchor={{ x: 100, y: 100 }} onClose={onClose} actions={actions} />
    </>,
  );
  return { actions, onClose };
}

describe('the menu of a row is the library ContextMenu', () => {
  it('lists the actions as menu items with an icon each, in sections cut by dividers, and no per-item border', () => {
    open();
    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Move to a group...', 'Flag', 'Mark as unread', 'Pin', 'Mark as seen']);
    for (const item of items) {
      expect(item.querySelector('svg')).not.toBeNull();
      expect(item.className).not.toContain('border');
    }
    // Move | flag, unread, pin | seen
    expect(within(menu).getAllByRole('separator')).toHaveLength(2);
  });

  it('the first item takes the focus and the arrows move it', () => {
    open();
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0] as HTMLElement, { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1] as HTMLElement, { key: 'End' });
    expect(items[4]).toHaveFocus();
  });

  it('picking an item acts and closes', () => {
    const { actions, onClose } = open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin' }));
    expect(actions.pin).toHaveBeenCalledExactlyOnceWith(true);
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape closes it', () => {
    const { onClose } = open();
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0] as HTMLElement, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('a list without any section but one has no divider, and a row that is not finished has no Mark as seen', () => {
    const idle = row({ displayName: 'idle-one', state: 'idle', statusUpdatedAt: 100 });
    render(<RowMenu session={idle} anchor={{ x: 0, y: 0 }} onClose={vi.fn()} actions={{ flag: vi.fn(), seen: vi.fn() }} />);
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
    expect(screen.queryByRole('menuitem', { name: 'Mark as seen' })).toBeNull();
  });
});
