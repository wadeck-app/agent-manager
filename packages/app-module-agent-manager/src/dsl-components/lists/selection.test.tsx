import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { SelectionKeys } from '../batch/SelectionKeys.js';
import type { AgentRow } from '../data/types.js';
import { row } from '../logic/fixtures.js';
import { parseQuery } from '../logic/fuzzy.js';
import { agentId } from '../logic/states.js';
import { DEFAULT_VIEW_OPTIONS } from '../logic/viewOptions.js';
import { TreeList } from './TreeList.js';
import { SelectionProvider, useSelection } from './selection.js';

const NOW = 2_000_000;
const a = row({ folder: 'shop', displayName: 'a-one', state: 'idle', statusUpdatedAt: 100 });
const b = row({ folder: 'shop', displayName: 'b-two', state: 'idle', statusUpdatedAt: 90 });
const c = row({ folder: 'shop', displayName: 'c-three', state: 'idle', statusUpdatedAt: 80 });
const d = row({ folder: 'docs', displayName: 'd-four', state: 'idle', statusUpdatedAt: 70 });

function Count() {
  const selection = useSelection();
  return <output aria-label="selected ids">{[...(selection?.selected ?? [])].sort().join(',')}</output>;
}

function Page({ sessions }: { sessions: AgentRow[] }) {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const service: UrlParamService = { get: () => null, set: () => undefined };
  return (
    <UrlParamContext.Provider value={service}>
      <SelectionProvider existing={new Set(sessions.map(agentId))}>
        <SelectionKeys />
        <Count />
        {/* The range is read from the rows on screen of the list pane, as in the page. */}
        <div data-pane="list">
          <TreeList sessions={sessions} selectedId={selected} onSelect={setSelected} now={NOW} query={parseQuery('')} searching={false} options={DEFAULT_VIEW_OPTIONS} />
        </div>
        <output aria-label="open">{selected ?? ''}</output>
      </SelectionProvider>
    </UrlParamContext.Provider>
  );
}

const ids = (...rows: AgentRow[]): string => rows.map(agentId).sort().join(',');
const selectedIds = (): string => screen.getByLabelText('selected ids').textContent ?? '';
const rowOf = (container: HTMLElement, session: AgentRow): HTMLElement => {
  const element = container.querySelector<HTMLElement>(`[data-session-id="${agentId(session)}"]`);
  if (element === null) {
    throw new Error(`no row for ${session.displayName}`);
  }
  return element;
};

describe('selecting sessions in the list', () => {
  it('every row has a checkbox, out of the tab order; ticking it selects without opening the row', () => {
    const { container } = render(<Page sessions={[a, b, c]} />);
    const box = within(rowOf(container, a)).getByRole('checkbox', { name: 'Select a-one' });
    expect(box).toHaveAttribute('tabindex', '-1');
    fireEvent.click(box);
    expect(selectedIds()).toBe(ids(a));
    expect(screen.getByLabelText('open')).toHaveTextContent('');
    expect(rowOf(container, a)).toHaveAttribute('data-multi-selected', 'true');
  });

  it('the checkbox is hidden until hover or focus, and shown on every row as soon as something is selected', () => {
    const { container } = render(<Page sessions={[a, b]} />);
    const wrapper = (session: AgentRow): HTMLElement => rowOf(container, session).querySelector<HTMLElement>('[data-row-checkbox]') as HTMLElement;
    expect(wrapper(b).className).toContain('opacity-0');
    expect(wrapper(b).className).toContain('group-hover:opacity-100');
    fireEvent.click(within(rowOf(container, a)).getByRole('checkbox'));
    expect(wrapper(b).className).toContain('opacity-100');
    expect(wrapper(b).className).not.toContain('opacity-0');
  });

  it('Ctrl click toggles a row, a plain click opens it and keeps the selection', () => {
    const { container } = render(<Page sessions={[a, b, c]} />);
    fireEvent.click(rowOf(container, a), { ctrlKey: true });
    fireEvent.click(rowOf(container, c), { metaKey: true });
    expect(selectedIds()).toBe(ids(a, c));
    expect(screen.getByLabelText('open')).toHaveTextContent('');
    fireEvent.click(rowOf(container, b));
    expect(screen.getByLabelText('open')).toHaveTextContent(agentId(b));
    expect(selectedIds()).toBe(ids(a, c));
    fireEvent.click(rowOf(container, a), { ctrlKey: true });
    expect(selectedIds()).toBe(ids(c));
  });

  it('Shift click selects the rows between the last ticked one and the clicked one, among the rows on screen', () => {
    const { container } = render(<Page sessions={[a, b, c, d]} />);
    fireEvent.click(rowOf(container, a), { ctrlKey: true });
    fireEvent.click(rowOf(container, c), { shiftKey: true });
    expect(selectedIds()).toBe(ids(a, b, c));
  });

  it('the select-all box of a folder selects its sessions, shows indeterminate for some, and unselects them', () => {
    const { container } = render(<Page sessions={[a, b, c, d]} />);
    const shop = screen.getByRole('checkbox', { name: 'Select all 3 sessions of shop' }) as HTMLInputElement;
    fireEvent.click(shop);
    expect(selectedIds()).toBe(ids(a, b, c));
    expect(shop.checked).toBe(true);
    fireEvent.click(within(rowOf(container, b)).getByRole('checkbox'));
    expect(shop.indeterminate).toBe(true);
    expect(shop.checked).toBe(false);
    fireEvent.click(shop);
    expect(selectedIds()).toBe(ids(a, b, c));
    fireEvent.click(shop);
    expect(selectedIds()).toBe('');
  });

  it('X ticks the focused row from the keyboard', () => {
    const { container } = render(<Page sessions={[a, b]} />);
    const target = rowOf(container, b);
    target.focus();
    fireEvent.keyDown(target, { key: 'x' });
    expect(selectedIds()).toBe(ids(b));
  });

  it('Escape clears the selection, but not while a dialog is open', () => {
    const { container } = render(<Page sessions={[a, b]} />);
    fireEvent.click(rowOf(container, a), { ctrlKey: true });
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(selectedIds()).toBe(ids(a));
    dialog.remove();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(selectedIds()).toBe('');
  });

  it('Escape clears the selection when the focus sits on a row checkbox just clicked with the mouse', async () => {
    const user = userEvent.setup();
    const { container } = render(<Page sessions={[a, b]} />);
    await user.click(within(rowOf(container, a)).getByRole('checkbox', { name: 'Select a-one' }));
    expect(selectedIds()).toBe(ids(a));
    expect(document.activeElement?.tagName).toBe('INPUT');
    await user.keyboard('{Escape}');
    expect(selectedIds()).toBe('');
  });

  it('Escape keeps its own meaning in a text field and while a menu is open', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <>
        <Page sessions={[a, b]} />
        <input aria-label="search" />
      </>,
    );
    fireEvent.click(rowOf(container, a), { ctrlKey: true });
    await user.click(screen.getByLabelText('search'));
    await user.keyboard('{Escape}');
    expect(selectedIds()).toBe(ids(a));
    (document.activeElement as HTMLElement).blur();
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    document.body.appendChild(menu);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(selectedIds()).toBe(ids(a));
    menu.remove();
  });

  it('a real shift click on a row checkbox extends the range from the last ticked row', async () => {
    const user = userEvent.setup();
    const { container } = render(<Page sessions={[a, b, c, d]} />);
    await user.click(within(rowOf(container, a)).getByRole('checkbox', { name: 'Select a-one' }));
    await user.keyboard('{Shift>}');
    await user.click(within(rowOf(container, c)).getByRole('checkbox', { name: 'Select c-three' }));
    await user.keyboard('{/Shift}');
    expect(selectedIds()).toBe(ids(a, b, c));
  });

  it('a real ctrl click on a row checkbox toggles that row only', async () => {
    const user = userEvent.setup();
    const { container } = render(<Page sessions={[a, b, c]} />);
    await user.click(within(rowOf(container, a)).getByRole('checkbox'));
    await user.keyboard('{Control>}');
    await user.click(within(rowOf(container, c)).getByRole('checkbox'));
    await user.keyboard('{/Control}');
    expect(selectedIds()).toBe(ids(a, c));
  });

  it('a session that disappears is dropped from the selection', () => {
    const { container, rerender } = render(<Page sessions={[a, b, c]} />);
    fireEvent.click(rowOf(container, a), { ctrlKey: true });
    fireEvent.click(rowOf(container, b), { ctrlKey: true });
    expect(selectedIds()).toBe(ids(a, b));
    rerender(<Page sessions={[b, c]} />);
    expect(selectedIds()).toBe(ids(b));
  });
});
