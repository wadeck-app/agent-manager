import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AgentRow } from '../data/types.js';
import { parseQuery } from '../logic/fuzzy.js';
import { row } from '../logic/fixtures.js';
import { agentId } from '../logic/states.js';
import { DEFAULT_VIEW_OPTIONS, type ViewOptions } from '../logic/viewOptions.js';
import type { ListProps } from './common.js';
import { GroupsList } from './GroupsList.js';
import { InboxList } from './InboxList.js';
import { TreeList } from './TreeList.js';

const NOW = 2_000_000;

/** A page: the selection is state, the URL parameters are state too (a set re-renders, like the router does). */
function useUrlService(): UrlParamService {
  const [params, setParams] = useState<Record<string, string>>({});
  return { get: (key) => params[key] ?? null, set: (key, value) => setParams((current) => ({ ...current, [key]: value })) };
}

interface HarnessProps {
  sessions: AgentRow[];
  List: (props: ListProps) => React.ReactNode;
  initial?: string;
  options?: ViewOptions;
  search?: string;
}

/** A list in a page that keeps the selection, like the workspace does (the workspace filters the rows by the search before the list sees them). */
function Harness({ sessions, List, initial, options = DEFAULT_VIEW_OPTIONS, search = '' }: HarnessProps) {
  const [selected, setSelected] = useState<string | undefined>(initial);
  const service = useUrlService();
  return (
    <UrlParamContext.Provider value={service}>
      <List sessions={sessions} selectedId={selected} onSelect={setSelected} now={NOW} query={parseQuery(search)} searching={search !== ''} options={options} />
      <div data-testid="selected">{selected ?? ''}</div>
    </UrlParamContext.Provider>
  );
}

function withOptions(patch: Partial<ViewOptions>): ViewOptions {
  return { ...DEFAULT_VIEW_OPTIONS, ...patch };
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
    render(<Harness sessions={sessions} List={GroupsList} />);
    const groups = screen.getAllByRole('group').map((group) => group.textContent?.slice(0, 12));
    expect(groups.join('|')).toMatch(/Pinned1.*Needs you1.*Done1.*Working1.*Other1/);
    // Other (and Ended) start collapsed: its row is not listed until the group is opened.
    expect(screen.getAllByRole('option')).toHaveLength(sessions.length - 1);
    expect(screen.getByRole('button', { name: /^Other, 1$/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('$sources.x')).toBeInTheDocument();
    expect(screen.getByText('permission prompt: Bash')).toBeInTheDocument();
  });

  it('is a listbox with one tab stop on the first row, and no text glyph as a status (icons carry a name)', () => {
    render(<Harness sessions={sessions} List={GroupsList} />);
    expect(screen.getByRole('listbox', { name: 'Agents' })).toBeInTheDocument();
    expect(screen.getAllByRole('option').filter((option) => option.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(screen.getAllByRole('img', { name: 'Needs you' }).length).toBeGreaterThan(0);
  });

  it('selects on click and moves the selection with j, k, the arrows, Home and End', () => {
    render(<Harness sessions={sessions} List={GroupsList} />);
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
        <Harness sessions={sessions} List={GroupsList} />
        <textarea data-agent-composer="" aria-label="composer" />
      </>,
    );
    const option = screen.getAllByRole('option')[0]!;
    option.focus();
    fireEvent.keyDown(option, { key: 'Enter' });
    expect(document.activeElement).toBe(screen.getByLabelText('composer'));
  });

  it('shows an explanation, not a blank, when there is no session', () => {
    render(<Harness sessions={[]} List={GroupsList} />);
    expect(screen.getByRole('status')).toHaveTextContent('No session to show');
  });

  it('shows the last activity line by default, and drops it with the preview option off', () => {
    const { unmount } = render(<Harness sessions={sessions} List={GroupsList} />);
    expect(screen.getByText('Bash: npm test')).toBeInTheDocument();
    unmount();
    render(<Harness sessions={sessions} List={GroupsList} options={withOptions({ groups: { preview: false } })} />);
    expect(screen.queryByText('Bash: npm test')).toBeNull();
    expect(screen.getByText('task-owner')).toBeInTheDocument();
  });

  it('lights up the letters of the search and opens a collapsed group while searching', () => {
    const found = [row({ folder: 'odd', displayName: 'odd', state: 'other', status: 'weird' })];
    const { container } = render(<Harness sessions={found} List={GroupsList} search="od" />);
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(container.querySelectorAll('[data-match]').length).toBeGreaterThan(0);
  });
});

describe('InboxList', () => {
  it('opens the first non-empty tab with counts and a reason line', () => {
    render(<Harness sessions={sessions} List={InboxList} />);
    expect(screen.getByRole('tab', { name: /Needs you/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /All/ })).toHaveTextContent('5');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByText('permission prompt: Bash')).toBeInTheDocument();
  });

  it('has no search box of its own (the search is the toolbar of the workspace)', () => {
    render(<Harness sessions={sessions} List={InboxList} />);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('says it is the search that leaves a tab empty', () => {
    render(<Harness sessions={[]} List={InboxList} search="zzzz" />);
    expect(screen.getByRole('status')).toHaveTextContent('No agent in this tab matches the search');
  });

  const waiting = [row({ folder: 'a', state: 'needs-you', statusUpdatedAt: 1 }), row({ folder: 'b', state: 'needs-you', statusUpdatedAt: 2 })];
  const first = agentId(waiting[0]!);
  const second = agentId(waiting[1]!);
  const replied = [{ ...waiting[0]!, state: 'working' as const }, waiting[1]!];

  it('auto-next (option on) opens the next session that needs you when the selected one stops needing you', () => {
    const auto = withOptions({ inbox: { autoNext: true } });
    const { rerender } = render(<Harness sessions={waiting} List={InboxList} initial={first} options={auto} />);
    expect(screen.getByTestId('selected').textContent).toBe(first);
    rerender(<Harness sessions={replied} List={InboxList} initial={first} options={auto} />);
    expect(screen.getByTestId('selected').textContent).toBe(second);
  });

  it('auto-next is off by default: the selection stays where it is', () => {
    const { rerender } = render(<Harness sessions={waiting} List={InboxList} initial={first} />);
    rerender(<Harness sessions={replied} List={InboxList} initial={first} />);
    expect(screen.getByTestId('selected').textContent).toBe(first);
  });
});

describe('TreeList', () => {
  const many = [row({ folder: 'shop', cwd: '/a/shop', state: 'needs-you' }), row({ folder: 'shop', cwd: '/a/shop', state: 'idle' }), row({ folder: 'old', cwd: '/a/old', state: 'idle' })];
  const attention = withOptions({ tree: { grouping: 'workspace', expansion: 'attention' }, subagents: { show: true } });

  it('all expanded (default): every folder open, treeitems with levels and aria-expanded', () => {
    render(<Harness sessions={many} List={TreeList} />);
    const folders = screen.getAllByRole('treeitem', { expanded: true });
    expect(folders).toHaveLength(2);
    expect(screen.getAllByRole('treeitem')).toHaveLength(5);
  });

  it('only what needs attention: folders that do not need you start closed and open on ArrowRight', () => {
    render(<Harness sessions={many} List={TreeList} options={attention} />);
    expect(screen.getAllByRole('treeitem')).toHaveLength(4);
    const closed = screen.getByRole('treeitem', { expanded: false });
    fireEvent.keyDown(closed, { key: 'ArrowRight' });
    expect(screen.getAllByRole('treeitem')).toHaveLength(5);
    fireEvent.keyDown(screen.getAllByRole('treeitem', { expanded: true })[1]!, { key: 'ArrowLeft' });
    expect(screen.getAllByRole('treeitem')).toHaveLength(4);
  });

  it('the folder of the selected agent is open even when the expansion would close it', () => {
    render(<Harness sessions={many} List={TreeList} options={attention} initial={agentId(many[2]!)} />);
    expect(screen.getAllByRole('treeitem')).toHaveLength(5);
  });

  it('no folder is closed while searching', () => {
    render(<Harness sessions={many} List={TreeList} options={attention} search="old" />);
    expect(screen.queryByRole('treeitem', { expanded: false })).toBeNull();
  });

  it('has no roll-up dots: a folder shows one state icon and its count', () => {
    render(<Harness sessions={many} List={TreeList} />);
    expect(screen.queryByLabelText('1 Needs you')).toBeNull();
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
  });

  it('grouping none: a flat list of agents, most urgent first, with the folder in the row', () => {
    render(<Harness sessions={many} List={TreeList} options={withOptions({ tree: { grouping: 'none', expansion: 'all' } })} />);
    const items = screen.getAllByRole('treeitem');
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.getAttribute('aria-level') === '1')).toBe(true);
    expect(items[0]).toHaveTextContent('shop');
    expect(screen.queryByRole('treeitem', { expanded: true })).toBeNull();
  });

  it('shows the parent path of two folders with the same name', () => {
    render(<Harness sessions={[row({ folder: 'shop', cwd: '/a/shop' }), row({ folder: 'shop', cwd: '/b/shop' })]} List={TreeList} />);
    expect(screen.getByText('/a')).toBeInTheDocument();
    expect(screen.getByText('/b')).toBeInTheDocument();
  });

  it('only what needs attention opens the sub-agents of an agent that wants you (fetched when it opens), not the others', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, entries: [], subagents: [], subagentsNote: '' }) });
    vi.stubGlobal('fetch', fetchMock);
    const waitingParent = row({ folder: 'shop', cwd: '/a/shop', state: 'needs-you', subagentCount: 2 });
    const idleParent = row({ folder: 'shop', cwd: '/a/shop', state: 'idle', subagentCount: 3 });
    render(<Harness sessions={[waitingParent, idleParent]} List={TreeList} options={attention} />);
    expect(screen.getByRole('button', { name: 'Hide the 2 sub-agents' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show the 3 sub-agents' })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

describe('row highlight by state (the same variables in every mode, see styles/agents.css)', () => {
  const NEEDS = '--am-herdr-needs-bg';
  const UNSEEN = '--am-herdr-unseen-bg';
  const rows = [
    row({ folder: 'a', displayName: 'needs-row', state: 'needs-you' }),
    row({ folder: 'b', displayName: 'unseen-row', state: 'done' }),
    row({ folder: 'c', displayName: 'flag-row', state: 'idle', flagged: true }),
    row({ folder: 'd', displayName: 'quiet-row', state: 'idle' }),
  ];
  const rowOf = (name: string): HTMLElement => screen.getByText(name, { selector: 'span' }).closest('[data-session-id]') as HTMLElement;

  for (const [mode, List] of [['Tree', TreeList], ['Groups', GroupsList]] as const) {
    it(`${mode}: needs you is tinted red, finished and unseen blue, flagged orange, a quiet row is not tinted`, () => {
      render(<Harness sessions={rows} List={List} />);
      const needs = rowOf('needs-row');
      expect(needs.className).toContain(NEEDS);
      expect(rowOf('unseen-row').className).toContain(UNSEEN);
      expect(rowOf('flag-row').className).toContain('--am-herdr-flag-bg');
      const quiet = rowOf('quiet-row').className;
      expect(quiet).not.toMatch(/--am-herdr|--am-herdr-flag-bg/);
      expect(quiet).toContain('hover:bg-muted-bg');
    });
  }

  // The Inbox lists one tab at a time: the first non-empty tab opens, so each state is looked at in a list of its own.
  it('Inbox: the tint of the first tab (needs you) and of a list that has only a finished and unseen row or only a flagged one', () => {
    const first = render(<Harness sessions={[rows[0]!]} List={InboxList} />);
    expect(rowOf('needs-row').className).toContain(NEEDS);
    first.unmount();
    const quiet = render(<Harness sessions={[rows[3]!]} List={InboxList} />);
    expect(rowOf('quiet-row').className).not.toMatch(/--am-herdr|--am-herdr-flag-bg/);
    quiet.unmount();
    const second = render(<Harness sessions={[rows[1]!]} List={InboxList} />);
    expect(rowOf('unseen-row').className).toContain(UNSEEN);
    second.unmount();
    render(<Harness sessions={[rows[2]!]} List={InboxList} />);
    expect(rowOf('flag-row').className).toContain('--am-herdr-flag-bg');
  });

  it('the open row has the gold outline of the Tree rows over the state tint (Groups and Inbox rows are the Tree rows look, Q7)', () => {
    render(<Harness sessions={rows} List={GroupsList} initial={agentId(rows[0]!)} />);
    const open = rowOf('needs-row').className;
    expect(open).toContain('--am-herdr-active-edge');
    expect(open).toContain('--am-herdr-active-bg');
    // The same inset rounded box as the Tree rows, not a full-bleed band.
    expect(open).toContain('mx-2');
    expect(open).toContain('rounded-lg');
  });

  it('a flagged row says so in words for a screen reader, not by colour only', () => {
    render(<Harness sessions={rows} List={TreeList} />);
    expect(within(rowOf('flag-row')).getByText('Flagged')).toBeInTheDocument();
    expect(within(rowOf('quiet-row')).queryByText('Flagged')).toBeNull();
  });
});
