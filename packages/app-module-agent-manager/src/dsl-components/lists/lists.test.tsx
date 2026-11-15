import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { AgentRow } from '../data/types.js';
import { row } from '../logic/fixtures.js';
import { agentId } from '../logic/states.js';
import { CardsList } from './CardsList.js';
import { monogram } from '../logic/monogram.js';
import type { ListProps } from './common.js';
import { GroupsList } from './GroupsList.js';
import { InboxList } from './InboxList.js';
import { PaletteList } from './PaletteList.js';
import { TreeList } from './TreeList.js';

const NOW = 2_000_000;

/** A page: the selection is state, the URL parameters are state too (a set re-renders, like the router does). */
function useUrlService(): UrlParamService {
  const [params, setParams] = useState<Record<string, string>>({});
  return { get: (key) => params[key] ?? null, set: (key, value) => setParams((current) => ({ ...current, [key]: value })) };
}

/** A list in a page that keeps the selection, like the workspace does. */
function Harness({ sessions, variant, List, initial }: { sessions: AgentRow[]; variant: string; List: (props: ListProps) => React.ReactNode; initial?: string }) {
  const [selected, setSelected] = useState<string | undefined>(initial);
  const service = useUrlService();
  return (
    <UrlParamContext.Provider value={service}>
      <List sessions={sessions} selectedId={selected} onSelect={setSelected} now={NOW} style={variant} />
      <div data-testid="selected">{selected ?? ''}</div>
    </UrlParamContext.Provider>
  );
}

const sessions = [
  row({ folder: 'billing', displayName: 'billing-owner', state: 'needs-you', reason: 'permission prompt: Bash', statusUpdatedAt: NOW - 600_000 }),
  row({ folder: 'docs', displayName: 'docs-writer', state: 'done', statusUpdatedAt: NOW - 120_000 }),
  row({ folder: 'task', displayName: 'task-owner', state: 'working', statusUpdatedAt: NOW - 180_000, lastActivity: 'Bash: npm test', subagentCount: 2 }),
  row({ folder: 'queue', displayName: '$sources.x', state: 'idle', statusUpdatedAt: NOW - 3_000_000, pinned: true, pinOrder: 0 }),
  row({ folder: 'odd', displayName: 'odd', state: 'other', status: 'weird' }),
];

describe('GroupsList', () => {
  it('shows the groups with their counts, the pinned session only in Pinned, and a $-name as text', () => {
    render(<Harness sessions={sessions} variant="comfortable" List={GroupsList} />);
    const groups = screen.getAllByRole('group').map((group) => group.textContent?.slice(0, 12));
    expect(groups.join('|')).toMatch(/Pinned1.*Needs you1.*Done1.*Working1.*Other1/);
    // Other (and Ended) start collapsed: its row is not listed until the group is opened.
    expect(screen.getAllByRole('option')).toHaveLength(sessions.length - 1);
    expect(screen.getByRole('button', { name: /^Other, 1$/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('$sources.x')).toBeInTheDocument();
    expect(screen.getByText('permission prompt: Bash')).toBeInTheDocument();
  });

  it('is a listbox with one tab stop on the first row, and no text glyph as a status (icons carry a name)', () => {
    render(<Harness sessions={sessions} variant="compact" List={GroupsList} />);
    expect(screen.getByRole('listbox', { name: 'Agents' })).toBeInTheDocument();
    expect(screen.getAllByRole('option').filter((option) => option.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(screen.getAllByRole('img', { name: 'Needs you' }).length).toBeGreaterThan(0);
  });

  it('selects on click and moves the selection with j, k, the arrows, Home and End', () => {
    render(<Harness sessions={sessions} variant="compact" List={GroupsList} />);
    const options = screen.getAllByRole('option');
    fireEvent.click(options[1]!);
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    options[1]!.focus();
    fireEvent.keyDown(options[1]!, { key: 'j' });
    expect(screen.getByTestId('selected').textContent).toBe(options[2]!.dataset['sessionId']);
    expect(document.activeElement).toBe(options[2]);
    fireEvent.keyDown(options[2]!, { key: 'k' });
    fireEvent.keyDown(options[1]!, { key: 'End' });
    expect(screen.getByTestId('selected').textContent).toBe(options[options.length - 1]!.dataset['sessionId']);
    fireEvent.keyDown(options[0]!, { key: 'Home' });
    expect(screen.getByTestId('selected').textContent).toBe(options[0]!.dataset['sessionId']);
  });

  it('Enter moves the focus to the composer when the next step provides one', () => {
    render(
      <>
        <Harness sessions={sessions} variant="compact" List={GroupsList} />
        <textarea data-agent-composer="" aria-label="composer" />
      </>,
    );
    const option = screen.getAllByRole('option')[0]!;
    option.focus();
    fireEvent.keyDown(option, { key: 'Enter' });
    expect(document.activeElement).toBe(screen.getByLabelText('composer'));
  });

  it('shows an explanation, not a blank, when there is no session', () => {
    render(<Harness sessions={[]} variant="compact" List={GroupsList} />);
    expect(screen.getByRole('status')).toHaveTextContent('No session to show');
  });

  it('shows the last activity in the preview variant only', () => {
    const { unmount } = render(<Harness sessions={sessions} variant="preview" List={GroupsList} />);
    expect(screen.getByText('Bash: npm test')).toBeInTheDocument();
    unmount();
    render(<Harness sessions={sessions} variant="compact" List={GroupsList} />);
    expect(screen.queryByText('Bash: npm test')).toBeNull();
  });
});

describe('InboxList', () => {
  it('opens the first non-empty tab with counts and a reason line', () => {
    render(<Harness sessions={sessions} variant="tabs" List={InboxList} />);
    expect(screen.getByRole('tab', { name: /Needs you/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /All/ })).toHaveTextContent('5');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByText('permission prompt: Bash')).toBeInTheDocument();
  });

  it('filters the open tab with the search box and explains an empty result', () => {
    render(<Harness sessions={sessions} variant="segmented" List={InboxList} />);
    fireEvent.click(screen.getByRole('tab', { name: /All/ }));
    expect(screen.getAllByRole('option')).toHaveLength(5);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter this tab' }), { target: { value: 'task' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter this tab' }), { target: { value: 'zzzz' } });
    expect(screen.getByRole('status')).toHaveTextContent("No session in this tab matches 'zzzz'");
  });

  it('autonext opens the next session that needs you when the selected one stops needing you', () => {
    const waiting = [row({ folder: 'a', state: 'needs-you', statusUpdatedAt: 1 }), row({ folder: 'b', state: 'needs-you', statusUpdatedAt: 2 })];
    const first = agentId(waiting[0]!);
    const second = agentId(waiting[1]!);
    const { rerender } = render(<Harness sessions={waiting} variant="autonext" List={InboxList} initial={first} />);
    expect(screen.getByTestId('selected').textContent).toBe(first);
    rerender(<Harness sessions={[{ ...waiting[0]!, state: 'working' }, waiting[1]!]} variant="autonext" List={InboxList} initial={first} />);
    expect(screen.getByTestId('selected').textContent).toBe(second);
  });
});

describe('TreeList', () => {
  const many = [row({ folder: 'shop', cwd: '/a/shop', state: 'needs-you' }), row({ folder: 'shop', cwd: '/a/shop', state: 'idle' }), row({ folder: 'old', cwd: '/a/old', state: 'idle' })];

  it('expanded: every folder open, treeitems with levels and aria-expanded', () => {
    render(<Harness sessions={many} variant="expanded" List={TreeList} />);
    const folders = screen.getAllByRole('treeitem', { expanded: true });
    expect(folders).toHaveLength(2);
    expect(screen.getAllByRole('treeitem')).toHaveLength(5);
  });

  it('attention: folders that do not need you start closed and open on click or ArrowRight', () => {
    render(<Harness sessions={many} variant="attention" List={TreeList} />);
    expect(screen.getAllByRole('treeitem')).toHaveLength(4);
    const closed = screen.getByRole('treeitem', { expanded: false });
    fireEvent.keyDown(closed, { key: 'ArrowRight' });
    expect(screen.getAllByRole('treeitem')).toHaveLength(5);
    fireEvent.keyDown(screen.getAllByRole('treeitem', { expanded: true })[1]!, { key: 'ArrowLeft' });
    expect(screen.getAllByRole('treeitem')).toHaveLength(4);
  });

  it('rollup: a closed folder shows a count per state, and the folder of the selected session is open', () => {
    const { unmount } = render(<Harness sessions={many} variant="rollup" List={TreeList} />);
    expect(screen.getAllByRole('treeitem')).toHaveLength(2);
    expect(screen.getByLabelText('1 Needs you')).toBeInTheDocument();
    unmount();
    render(<Harness sessions={many} variant="rollup" List={TreeList} initial={agentId(many[1]!)} />);
    expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(2);
  });

  it('shows the parent path of two folders with the same name', () => {
    render(<Harness sessions={[row({ folder: 'shop', cwd: '/a/shop' }), row({ folder: 'shop', cwd: '/b/shop' })]} variant="expanded" List={TreeList} />);
    expect(screen.getByText('/a')).toBeInTheDocument();
    expect(screen.getByText('/b')).toBeInTheDocument();
  });
});

describe('CardsList', () => {
  it('cards: title, subtitle, folder and a status pill with text', () => {
    render(<Harness sessions={sessions} variant="cards" List={CardsList} />);
    const card = screen.getByRole('option', { name: /task-owner/ });
    expect(within(card).getByText('Bash: npm test')).toBeInTheDocument();
    expect(within(card).getByText('Working')).toBeInTheDocument();
  });

  it('rail: options keep an accessible name although only a monogram shows', () => {
    render(<Harness sessions={sessions} variant="rail" List={CardsList} />);
    expect(screen.getByRole('option', { name: 'billing-owner, billing, Needs you' })).toBeInTheDocument();
    expect(monogram('billing')).toBe('bi');
    expect(monogram('.claude')).toBe('cl');
  });

  it('harness: groups by version, newest first', () => {
    const list = [row({ folder: 'a', version: '2.1.9' }), row({ folder: 'b', version: '2.1.10' }), row({ folder: 'c', version: undefined })];
    render(<Harness sessions={list} variant="harness" List={CardsList} />);
    const headings = screen.getAllByRole('group').map((group) => group.textContent?.slice(0, 40));
    expect(headings[0]).toContain('2.1.10');
    expect(headings[1]).toContain('2.1.9');
    expect(headings[2]).toContain('version unknown');
  });
});

describe('PaletteList', () => {
  it('filters with free words and state: prefixes, reports a bad state, and counts', () => {
    render(<Harness sessions={sessions} variant="search" List={PaletteList} />);
    const input = screen.getByRole('combobox', { name: 'Search agents' });
    expect(screen.getByText('5 sessions')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'state:working' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByText('1 of 5 sessions')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'state:nope' } });
    expect(screen.getByText(/'nope' is not a state/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'zzzz' } });
    expect(screen.getAllByText("No session matches 'zzzz'")).toHaveLength(1);
  });

  it('moves the highlight with the arrows, goes to the composer with Enter, clears with Escape', () => {
    render(
      <>
        <Harness sessions={sessions} variant="search" List={PaletteList} />
        <textarea data-agent-composer="" aria-label="composer" />
      </>,
    );
    const input = screen.getByRole('combobox', { name: 'Search agents' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const first = screen.getAllByRole('option')[0]!;
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', first.id);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(document.activeElement).toBe(screen.getByLabelText('composer'));
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('facets: a chip adds and removes the state: filter in the box', () => {
    render(<Harness sessions={sessions} variant="facets" List={PaletteList} />);
    const chip = screen.getByRole('button', { name: /Working/ });
    fireEvent.click(chip);
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('state:working');
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chip);
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('');
  });

  it('minimal: no list until the input has the focus or text', () => {
    render(<Harness sessions={sessions} variant="minimal" List={PaletteList} />);
    expect(screen.queryByRole('option')).toBeNull();
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getAllByRole('option').length).toBe(5);
  });

  it('marks its input as the search target of the `/` page shortcut, and Escape clears the text, then leaves the field', () => {
    render(<Harness sessions={sessions} variant="search" List={PaletteList} />);
    const input = screen.getByRole('combobox');
    expect(input).toHaveAttribute('data-agent-search');
    input.focus();
    fireEvent.change(input, { target: { value: 'shop' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).not.toHaveFocus();
  });

  it('lights up the letters of the search words in the results', () => {
    const { container } = render(<Harness sessions={sessions} variant="search" List={PaletteList} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'que' } });
    expect(container.querySelectorAll('[data-match]').length).toBeGreaterThan(0);
  });
});
