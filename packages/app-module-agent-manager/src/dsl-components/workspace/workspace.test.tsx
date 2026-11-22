import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseQuery } from '../logic/fuzzy.js';
import { DEFAULT_VIEW_OPTIONS } from '../logic/viewOptions.js';
import { row } from '../logic/fixtures.js';
import { matchPositions } from '../logic/fuzzy.js';
import { SHORTCUTS } from '../logic/shortcuts.js';
import { Highlight } from '../lists/Highlight.js';
import { GroupsList } from '../lists/GroupsList.js';
import { SubagentRows } from '../lists/SubagentRows.js';
import { TreeList } from '../lists/TreeList.js';
import { ShortcutsHelp } from '../ui/ShortcutsHelp.js';
import { useCollapsed } from '../ui/useCollapsed.js';
import { applyPatch, PATCH_TTL_MS, reflected, useOptimisticRows } from './useOptimisticRows.js';
import { usePageShortcuts, type PageShortcutActions } from './usePageShortcuts.js';

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('useCollapsed', () => {
  it('starts with the defaults, remembers the choice in both directions, and survives a reload', () => {
    const defaults = { ended: true };
    const first = renderHook(() => useCollapsed(defaults));
    expect(first.result.current.isCollapsed('ended')).toBe(true);
    expect(first.result.current.isCollapsed('idle')).toBe(false);
    act(() => first.result.current.toggle('ended'));
    act(() => first.result.current.toggle('idle'));
    expect(first.result.current.isCollapsed('ended')).toBe(false);
    expect(first.result.current.isCollapsed('idle')).toBe(true);
    first.unmount();
    const second = renderHook(() => useCollapsed(defaults));
    expect(second.result.current.isCollapsed('ended')).toBe(false);
    expect(second.result.current.isCollapsed('idle')).toBe(true);
  });

  it('ignores a corrupt saved value instead of throwing', () => {
    window.localStorage.setItem('agent-manager.collapsedGroups', '{not json');
    const { result } = renderHook(() => useCollapsed({ other: true }));
    expect(result.current.isCollapsed('other')).toBe(true);
  });
});

describe('Other and Ended groups of the Groups list', () => {
  const sessions = [row({ folder: 'live', state: 'idle' }), row({ folder: 'gone', state: 'ended', alive: false }), row({ folder: 'odd', state: 'other', status: 'weird' })];
  const noop = (): void => undefined;

  it('start collapsed with their count, open on click, and the choice is remembered', () => {
    render(<GroupsList sessions={sessions} selectedId={undefined} onSelect={noop} now={0} query={parseQuery("")} searching={false} options={DEFAULT_VIEW_OPTIONS} />);
    expect(screen.queryByText('gone')).toBeNull();
    const ended = screen.getByRole('button', { name: 'Ended, 1' });
    expect(ended).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(ended);
    expect(screen.getByText('gone')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ended, 1' })).toHaveAttribute('aria-expanded', 'true');
    expect(JSON.parse(window.localStorage.getItem('agent-manager.collapsedGroups') ?? '{}')).toMatchObject({ ended: false });
  });

  it('a normal group can be collapsed too, and its rows leave the keyboard order', () => {
    render(<GroupsList sessions={sessions} selectedId={undefined} onSelect={noop} now={0} query={parseQuery("")} searching={false} options={DEFAULT_VIEW_OPTIONS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Idle, 1' }));
    expect(screen.queryByText('live')).toBeNull();
  });
});

describe('search highlight', () => {
  it('finds the letters of each word in order and ignores a word that does not match', () => {
    expect(matchPositions(['shp'], 'shop')).toEqual([0, 1, 3]);
    expect(matchPositions(['zz'], 'shop')).toEqual([]);
    expect(matchPositions(['sh', 'op'], 'shop')).toEqual([0, 1, 2, 3]);
  });

  it('wraps only the matched letters, and renders the text as is without terms', () => {
    const { container } = render(<Highlight text="shop-owner" terms={['so']} />);
    expect(Array.from(container.querySelectorAll('[data-match]')).map((node) => node.textContent)).toEqual(['s', 'o']);
    expect(container.textContent).toBe('shop-owner');
    const plain = render(<Highlight text="shop" />);
    expect(plain.container.querySelector('[data-match]')).toBeNull();
  });
});

describe('optimistic rows', () => {
  it('applies a pin at once with the next pin order, and a seen marker turns Done into Idle', () => {
    const pinned = row({ pinned: true, pinOrder: 2 });
    const target = row({ state: 'done', seen: false });
    const { result } = renderHook(() => useOptimisticRows([pinned, target]));
    expect(result.current.nextPinOrder()).toBe(3);
    act(() => result.current.patch(target.sessionId, { kind: 'pin', pinned: true, pinOrder: result.current.nextPinOrder() }));
    expect(result.current.rows[1]).toMatchObject({ pinned: true, pinOrder: 3 });
    act(() => result.current.patch(target.sessionId, { kind: 'seen' }));
    expect(result.current.rows[1]).toMatchObject({ state: 'idle', seen: true });
  });

  it('reverts a failed change, and drops one the next poll already shows', () => {
    const base = row({});
    const { result, rerender } = renderHook(({ rows }) => useOptimisticRows(rows), { initialProps: { rows: [base] } });
    act(() => result.current.patch(base.sessionId, { kind: 'pin', pinned: true, pinOrder: 0 }));
    expect(result.current.rows[0]?.pinned).toBe(true);
    act(() => result.current.revert(base.sessionId));
    expect(result.current.rows[0]?.pinned).toBe(false);
    act(() => result.current.patch(base.sessionId, { kind: 'pin', pinned: true, pinOrder: 0 }));
    rerender({ rows: [{ ...base, pinned: true, pinOrder: 0 }] });
    // The poll shows the pin: the patch is gone, so an unpin by the server is no longer hidden.
    rerender({ rows: [{ ...base, pinned: false, pinOrder: -1 }] });
    expect(result.current.rows[0]?.pinned).toBe(false);
  });

  it('exposes the pure helpers', () => {
    expect(applyPatch(row({ pinned: true, pinOrder: 1 }), { kind: 'pin', pinned: false, pinOrder: 9 })).toMatchObject({ pinned: false, pinOrder: -1 });
    expect(reflected(row({ state: 'idle' }), { kind: 'seen' })).toBe(true);
    expect(PATCH_TTL_MS).toBeGreaterThan(5000);
  });
});

function Shortcuts({ actions, children }: { actions: Partial<PageShortcutActions>; children?: React.ReactNode }) {
  usePageShortcuts({ selectedId: undefined, select: vi.fn(), togglePin: vi.fn(), close: vi.fn(), toggleHelp: vi.fn(), ...actions });
  return <>{children}</>;
}

describe('page shortcuts', () => {
  it('p pins, ? opens the help, Escape closes the selection, only with no text field focused', () => {
    const actions = { selectedId: 'a', togglePin: vi.fn(), toggleHelp: vi.fn(), close: vi.fn() };
    render(
      <Shortcuts actions={actions}>
        <input aria-label="field" />
      </Shortcuts>,
    );
    fireEvent.keyDown(document.body, { key: 'p' });
    fireEvent.keyDown(document.body, { key: '?' });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(actions.togglePin).toHaveBeenCalledTimes(1);
    expect(actions.toggleHelp).toHaveBeenCalledTimes(1);
    expect(actions.close).toHaveBeenCalledTimes(1);
    // A text field keeps its keys.
    fireEvent.keyDown(screen.getByLabelText('field'), { key: 'p' });
    fireEvent.keyDown(screen.getByLabelText('field'), { key: 'Escape' });
    expect(actions.togglePin).toHaveBeenCalledTimes(1);
    expect(actions.close).toHaveBeenCalledTimes(1);
    // Ctrl+p is not ours.
    fireEvent.keyDown(document.body, { key: 'p', ctrlKey: true });
    expect(actions.togglePin).toHaveBeenCalledTimes(1);
  });

  it('r and Enter move the focus to the reply box, / to the search, j and k select the next and previous row', () => {
    const select = vi.fn();
    render(
      <Shortcuts actions={{ selectedId: 'b', select }}>
        <div data-pane="list">
          <div data-session-id="a" tabIndex={-1} />
          <div data-session-id="b" tabIndex={-1} />
          <div data-session-id="c" tabIndex={-1} />
        </div>
        <textarea aria-label="reply" data-agent-composer="" />
        <input aria-label="search" data-agent-search="" />
      </Shortcuts>,
    );
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(select).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(document.body, { key: 'k' });
    expect(select).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(document.body, { key: 'r' });
    expect(screen.getByLabelText('reply')).toHaveFocus();
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(screen.getByLabelText('reply')).toHaveFocus();
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: '/' });
    expect(screen.getByLabelText('search')).toHaveFocus();
  });

  it('Enter on a button keeps its own meaning, and a key the list already handled is left alone', () => {
    const close = vi.fn();
    render(
      <Shortcuts actions={{ selectedId: 'a', close }}>
        <button type="button">go</button>
        <textarea aria-label="reply" data-agent-composer="" />
      </Shortcuts>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'go' }), { key: 'Enter' });
    expect(screen.getByLabelText('reply')).not.toHaveFocus();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    event.preventDefault();
    document.body.dispatchEvent(event);
    expect(close).not.toHaveBeenCalled();
  });

  it('documents every key it handles', () => {
    const keys = SHORTCUTS.flatMap((shortcut) => shortcut.keys);
    for (const key of ['j', 'k', 'Enter', 'r', '/', 'p', 'Esc', '?']) {
      expect(keys).toContain(key);
    }
  });
});

describe('ShortcutsHelp', () => {
  function Host() {
    const [open, setOpen] = useState(false);
    return <ShortcutsHelp open={open} onOpenChange={setOpen} />;
  }

  it('opens a labelled panel listing the shortcuts, closes on Escape and gives the focus back to the button', () => {
    render(<Host />);
    const button = screen.getByRole('button', { name: 'Keyboard shortcuts' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(dialog).toHaveTextContent('Pin or unpin the selected agent');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
  });
});

describe('sub-agents under a session of the tree', () => {
  const answer = (body: unknown): Response => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

  it('SubagentRows fetches the tree once, nests children, and says plainly when there is none', async () => {
    const tree = [{ agentId: 'a1', agentType: 'Explore', description: 'Find the config', finished: true, isFork: false, children: [{ agentId: 'a2', name: 'inner', finished: false, isFork: false, children: [] }] }];
    const fetchMock = vi.fn().mockResolvedValue(answer({ ok: true, subagents: tree, subagentsNote: '' }));
    vi.stubGlobal('fetch', fetchMock);
    render(<SubagentRows sessionId="s-1" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the sub-agents');
    expect(await screen.findByText('Find the config')).toBeInTheDocument();
    expect(screen.getByText('inner')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Finished' })).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/modules/agent-manager/sessions/s-1/log?limit=1');
  });

  it('shows the failure with a Retry, never an empty tree', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(answer({ ok: false, error: { code: 'transcript-unreadable', message: 'Cannot read the transcript', hint: 'Check the permissions.' } })).mockResolvedValue(answer({ ok: true, subagents: [], subagentsNote: '' }));
    vi.stubGlobal('fetch', fetchMock);
    render(<SubagentRows sessionId="s-2" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot read the transcript. Check the permissions.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('No sub-agent files found for this session.')).toBeInTheDocument());
  });

  it('a session with sub-agents has a chevron that opens its tree (and ArrowRight does too)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(answer({ ok: true, subagents: [{ agentId: 'x', description: 'Worker', finished: false, isFork: false, children: [] }], subagentsNote: '' }));
    vi.stubGlobal('fetch', fetchMock);
    const parent = row({ folder: 'shop', subagentCount: 1 });
    const service: UrlParamService = { get: () => null, set: () => undefined };
    render(
      <UrlParamContext.Provider value={service}>
        <TreeList sessions={[parent]} selectedId={undefined} onSelect={() => undefined} now={0} query={parseQuery("")} searching={false} options={{ ...DEFAULT_VIEW_OPTIONS, subagents: { show: true } }} />
      </UrlParamContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show the 1 sub-agents' }));
    expect(await screen.findByText('Worker')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide the 1 sub-agents' }));
    expect(screen.queryByText('Worker')).toBeNull();
    fireEvent.keyDown(document.querySelector(`[data-session-id="${parent.sessionId}"]`)!, { key: 'ArrowRight' });
    expect(await screen.findByText('Worker')).toBeInTheDocument();
  });
});
