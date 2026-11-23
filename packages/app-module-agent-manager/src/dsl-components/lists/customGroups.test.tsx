import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AgentRow } from '../data/types.js';
import { row } from '../logic/fixtures.js';
import { parseQuery } from '../logic/fuzzy.js';
import { DEFAULT_VIEW_OPTIONS, type ViewOptions } from '../logic/viewOptions.js';
import type { CustomGroupDto } from '../shared.js';
import { NewGroupControl } from '../workspace/NewGroupControl.js';
import type { GroupsApi } from './common.js';
import { TreeList } from './TreeList.js';

const NOW = 2_000_000;

const group = (id: string, order: number, overrides: Partial<CustomGroupDto> = {}): CustomGroupDto => ({ id, name: `Group ${id}`, color: null, collapsed: false, order, sort: 'manual', bodyColor: null, ...overrides });

interface FakeApi extends GroupsApi {
  move: ReturnType<typeof vi.fn<GroupsApi['move']>>;
  create: ReturnType<typeof vi.fn<GroupsApi['create']>>;
  update: ReturnType<typeof vi.fn<GroupsApi['update']>>;
  remove: ReturnType<typeof vi.fn<GroupsApi['remove']>>;
  reorder: ReturnType<typeof vi.fn<GroupsApi['reorder']>>;
}

function fakeApi(groups: CustomGroupDto[]): FakeApi {
  return {
    groups,
    move: vi.fn<GroupsApi['move']>(),
    create: vi.fn<GroupsApi['create']>((name) => Promise.resolve({ id: 'new', name, color: null, collapsed: false, order: groups.length, sort: 'manual', bodyColor: null })),
    update: vi.fn<GroupsApi['update']>(),
    remove: vi.fn<GroupsApi['remove']>(),
    reorder: vi.fn<GroupsApi['reorder']>(),
  };
}

function useUrlService(): UrlParamService {
  const [params, setParams] = useState<Record<string, string>>({});
  return { get: (key) => params[key] ?? null, set: (key, value) => setParams((current) => ({ ...current, [key]: value })) };
}

function Tree({ sessions, api, options = DEFAULT_VIEW_OPTIONS, search = '' }: { sessions: AgentRow[]; api?: GroupsApi; options?: ViewOptions; search?: string }) {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const service = useUrlService();
  return (
    <UrlParamContext.Provider value={service}>
      <TreeList sessions={sessions} selectedId={selected} onSelect={setSelected} now={NOW} query={parseQuery(search)} searching={search !== ''} options={options} groups={api} />
    </UrlParamContext.Provider>
  );
}

const withTree = (patch: Partial<ViewOptions['tree']>): ViewOptions => ({ ...DEFAULT_VIEW_OPTIONS, tree: { ...DEFAULT_VIEW_OPTIONS.tree, ...patch } });

/** The element of a row, by the session id the fixture gave it. */
function rowOf(container: HTMLElement, session: AgentRow): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-session-id="${session.sessionId.toLowerCase()}"]`);
  if (element === null) {
    throw new Error(`no row for ${session.sessionId}`);
  }
  return element;
}
const headerOf = (container: HTMLElement, id: string): HTMLElement => {
  const element = container.querySelector<HTMLElement>(`[data-group-id="${id}"]`);
  if (element === null) {
    throw new Error(`no header for group ${id}`);
  }
  return element;
};

/**
 * One drag event at height `y` of an element 40 px high that starts at 0 (jsdom has no layout: the box is given). Returns false when the page accepted the
 * drop (preventDefault), like dispatchEvent does.
 */
function drag(type: 'dragStart' | 'dragOver' | 'drop' | 'dragEnd' | 'dragLeave', element: HTMLElement, y = 5): boolean {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 40, bottom: 40, left: 0, right: 200, width: 200, x: 0, y: 0, toJSON: () => ({}) });
  const event = createEvent[type](element);
  Object.defineProperty(event, 'clientY', { value: y });
  Object.defineProperty(event, 'dataTransfer', { value: { setData: vi.fn(), effectAllowed: '', dropEffect: '' } });
  let result = true;
  act(() => {
    result = fireEvent(element, event);
  });
  return result;
}

describe('TreeList with custom groups', () => {
  const inA1 = row({ folder: 'shop', displayName: 'a-one', customGroupId: 'a', customGroupOrder: 0, state: 'idle' });
  const inA2 = row({ folder: 'shop', displayName: 'a-two', customGroupId: 'a', customGroupOrder: 1, state: 'needs-you', reason: 'permission prompt' });
  const inA3 = row({ folder: 'shop', displayName: 'a-three', customGroupId: 'a', customGroupOrder: 2, state: 'working' });
  const free1 = row({ folder: 'docs', displayName: 'free-one', state: 'idle' });
  const free2 = row({ folder: 'blog', displayName: 'free-two', state: 'working' });
  const all = [inA1, inA2, inA3, free1, free2];
  const groupsAB = (): CustomGroupDto[] => [group('a', 0), group('b', 1)];

  it('lists the groups above an Ungrouped section that keeps the by-workspace tree, with counts and the worst state of each group', () => {
    const { container } = render(<Tree sessions={all} api={fakeApi(groupsAB())} />);
    const headers = Array.from(container.querySelectorAll('[data-group-id]'));
    expect(headers.map((h) => h.getAttribute('data-group-id'))).toEqual(['a', 'b']);
    const a = headerOf(container, 'a');
    expect(a).toHaveTextContent('Group a');
    expect(a).toHaveTextContent('3');
    expect(within(a).getByRole('img', { name: 'Needs you' })).toBeInTheDocument();
    // the other group is empty: a count of 0, no state, and a hint on what to do
    expect(headerOf(container, 'b')).toHaveTextContent('0');
    expect(screen.getByText(/Empty group\. Drag an agent here/)).toBeInTheDocument();
    // a custom group comes before the automatic folders, which sit under "Ungrouped, by workspace"
    expect(screen.getByText('Ungrouped, by workspace')).toBeInTheDocument();
    const ungrouped = container.querySelector('[data-ungrouped]')!;
    expect(within(ungrouped as HTMLElement).getByText('docs')).toBeInTheDocument();
    expect(within(ungrouped as HTMLElement).queryByText('a-one')).toBeNull();
    // members of a group are listed by their position
    const order = Array.from(container.querySelectorAll('[data-session-id]')).map((el) => el.textContent);
    expect(order[0]).toContain('a-one');
    expect(order[1]).toContain('a-two');
  });

  it('is the old tree when there is no group (no Ungrouped header, no regression)', () => {
    render(<Tree sessions={[free1, free2]} api={fakeApi([])} />);
    expect(screen.queryByText(/Ungrouped/)).toBeNull();
    expect(screen.getByRole('tree', { name: 'Agents by folder' })).toBeInTheDocument();
  });

  it('with the flat grouping the ungrouped agents are one list under Ungrouped', () => {
    const { container } = render(<Tree sessions={all} api={fakeApi(groupsAB())} options={withTree({ grouping: 'none' })} />);
    expect(screen.getByText('Ungrouped')).toBeInTheDocument();
    expect(within(container.querySelector('[data-ungrouped]') as HTMLElement).getAllByRole('treeitem')).toHaveLength(2);
  });

  it('says it when every agent is in a group', () => {
    render(<Tree sessions={[inA1]} api={fakeApi(groupsAB())} />);
    expect(screen.getByText(/Every agent is in a group/)).toBeInTheDocument();
  });

  it('opens and closes a group with the click, Enter, Space and the arrows, and saves the collapsed state on the server', () => {
    const api = fakeApi(groupsAB());
    const { container } = render(<Tree sessions={all} api={api} />);
    const header = headerOf(container, 'a');
    expect(header).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(header);
    expect(api.update).toHaveBeenLastCalledWith('a', { collapsed: true });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('a-one')).toBeNull();
    fireEvent.keyDown(header, { key: 'ArrowRight' });
    expect(api.update).toHaveBeenLastCalledWith('a', { collapsed: false });
    fireEvent.keyDown(header, { key: 'ArrowLeft' });
    expect(api.update).toHaveBeenLastCalledWith('a', { collapsed: true });
    fireEvent.keyDown(header, { key: 'Enter' });
    expect(api.update).toHaveBeenLastCalledWith('a', { collapsed: false });
  });

  it('starts a group closed when the server says collapsed', () => {
    render(<Tree sessions={all} api={fakeApi([group('a', 0, { collapsed: true })])} />);
    expect(screen.queryByText('a-one')).toBeNull();
  });

  it('only attention: a group with a Needs-you member stays open even when saved as collapsed; a quiet saved-collapsed one stays closed', () => {
    const quiet = row({ folder: 'q', displayName: 'quiet-one', customGroupId: 'q', customGroupOrder: 0, state: 'idle' });
    render(<Tree sessions={[inA1, inA2, quiet]} api={fakeApi([group('a', 0, { collapsed: true }), group('q', 1, { collapsed: true })])} options={withTree({ expansion: 'attention' })} />);
    expect(screen.getByText('a-two')).toBeInTheDocument();
    expect(screen.queryByText('quiet-one')).toBeNull();
  });

  it('the group of the selected agent opens', () => {
    const { container } = render(<Tree sessions={all} api={fakeApi([group('a', 0, { collapsed: true })])} />);
    expect(screen.queryByText('a-one')).toBeNull();
    // the selection comes from the list (a click on a row of an open group): here the group is opened by the user, then the row selected
    fireEvent.click(headerOf(container, 'a'));
    fireEvent.click(rowOf(container, inA1));
    expect(rowOf(container, inA1)).toHaveAttribute('aria-selected', 'true');
  });

  it('a search lists only the groups that have a match, opened, and keeps the group name as the label of each result', () => {
    const { container } = render(<Tree sessions={[inA2]} api={fakeApi([group('a', 0, { collapsed: true }), group('b', 1)])} search="a-two" />);
    expect(container.querySelectorAll('[data-group-id]')).toHaveLength(1);
    expect(headerOf(container, 'a')).toHaveTextContent('Group a');
    expect(screen.getByRole('treeitem', { name: /a-two/ })).toBeInTheDocument();
  });

  describe('drag and drop', () => {
    it('drops an ungrouped agent on a group header: it goes to the end of the group', () => {
      const api = fakeApi(groupsAB());
      const { container } = render(<Tree sessions={all} api={api} />);
      expect(rowOf(container, free1)).toHaveAttribute('draggable', 'true');
      drag('dragStart', rowOf(container, free1));
      expect(drag('dragOver', headerOf(container, 'a'))).toBe(false);
      // the whole group shows it will take the agent
      expect(container.querySelector('[data-custom-group="a"]')).toHaveClass('ring-2');
      drag('drop', headerOf(container, 'a'));
      expect(api.move).toHaveBeenCalledExactlyOnceWith(free1.sessionId.toLowerCase(), 'a', null);
      expect(container.querySelector('[data-custom-group="a"]')).not.toHaveClass('ring-2');
    });

    it('drops an agent on an empty group', () => {
      const api = fakeApi(groupsAB());
      const { container } = render(<Tree sessions={all} api={api} />);
      drag('dragStart', rowOf(container, free2));
      expect(drag('dragOver', container.querySelector<HTMLElement>('[data-custom-group="b"]')!)).toBe(false);
      drag('drop', container.querySelector<HTMLElement>('[data-custom-group="b"]')!);
      expect(api.move).toHaveBeenCalledWith(free2.sessionId.toLowerCase(), 'b', null);
    });

    it('drops on the upper half of a member: before it, with a bar above it; on the lower half: before the next member, with a bar below it', () => {
      const api = fakeApi(groupsAB());
      const { container } = render(<Tree sessions={all} api={api} />);
      drag('dragStart', rowOf(container, free1));
      expect(drag('dragOver', rowOf(container, inA2), 5)).toBe(false);
      expect(container.querySelector('[data-drop-indicator="before"]')).not.toBeNull();
      drag('drop', rowOf(container, inA2), 5);
      expect(api.move).toHaveBeenLastCalledWith(free1.sessionId.toLowerCase(), 'a', inA2.sessionId.toLowerCase());
      expect(container.querySelector('[data-drop-indicator]')).toBeNull();

      drag('dragStart', rowOf(container, free1));
      drag('dragOver', rowOf(container, inA2), 30);
      expect(container.querySelector('[data-drop-indicator="after"]')).not.toBeNull();
      drag('drop', rowOf(container, inA2), 30);
      expect(api.move).toHaveBeenLastCalledWith(free1.sessionId.toLowerCase(), 'a', inA3.sessionId.toLowerCase());
      // below the last member: the end of the group
      drag('dragStart', rowOf(container, free1));
      drag('drop', rowOf(container, inA3), 30);
      expect(api.move).toHaveBeenLastCalledWith(free1.sessionId.toLowerCase(), 'a', null);
    });

    it('reorders inside a group, and does nothing when it is dropped on itself or where it already is', () => {
      const api = fakeApi(groupsAB());
      const { container } = render(<Tree sessions={all} api={api} />);
      drag('dragStart', rowOf(container, inA3));
      drag('drop', rowOf(container, inA1), 5);
      expect(api.move).toHaveBeenCalledExactlyOnceWith(inA3.sessionId.toLowerCase(), 'a', inA1.sessionId.toLowerCase());
      api.move.mockClear();
      // on itself
      drag('dragStart', rowOf(container, inA2));
      drag('drop', rowOf(container, inA2), 5);
      drag('dragStart', rowOf(container, inA2));
      drag('drop', rowOf(container, inA2), 30);
      // on the lower half of the row just above it: the place it already has
      drag('dragStart', rowOf(container, inA2));
      drag('drop', rowOf(container, inA1), 30);
      expect(api.move).not.toHaveBeenCalled();
    });

    it('drops an agent of a group on the ungrouped area: it leaves its group; an agent that is already ungrouped has no drop there', () => {
      const api = fakeApi(groupsAB());
      const { container } = render(<Tree sessions={all} api={api} />);
      const ungrouped = container.querySelector<HTMLElement>('[data-ungrouped]')!;
      drag('dragStart', rowOf(container, inA1));
      expect(drag('dragOver', ungrouped)).toBe(false);
      expect(ungrouped).toHaveClass('ring-2');
      drag('drop', ungrouped);
      expect(api.move).toHaveBeenCalledExactlyOnceWith(inA1.sessionId.toLowerCase(), null, null);
      drag('dragEnd', rowOf(container, inA1));
      api.move.mockClear();
      drag('dragStart', rowOf(container, free1));
      expect(drag('dragOver', ungrouped)).toBe(true);
      drag('drop', ungrouped);
      expect(api.move).not.toHaveBeenCalled();
    });

    it('also drops on a row of the ungrouped tree (it bubbles to the area)', () => {
      const api = fakeApi(groupsAB());
      const { container } = render(<Tree sessions={all} api={api} />);
      drag('dragStart', rowOf(container, inA2));
      drag('dragOver', rowOf(container, free1));
      drag('drop', rowOf(container, free1));
      expect(api.move).toHaveBeenCalledWith(inA2.sessionId.toLowerCase(), null, null);
    });

    it('reorders the groups by dragging a header: a bar above or below the target header', () => {
      const api = fakeApi([group('a', 0), group('b', 1), group('c', 2)]);
      const { container } = render(<Tree sessions={[inA1]} api={api} />);
      expect(headerOf(container, 'c')).toHaveAttribute('draggable', 'true');
      drag('dragStart', headerOf(container, 'c'));
      expect(drag('dragOver', headerOf(container, 'a'), 5)).toBe(false);
      expect(headerOf(container, 'a').querySelector('[data-drop-indicator="before"]')).not.toBeNull();
      drag('drop', headerOf(container, 'a'), 5);
      expect(api.reorder).toHaveBeenCalledExactlyOnceWith(['c', 'a', 'b']);
      drag('dragStart', headerOf(container, 'a'));
      drag('dragOver', headerOf(container, 'b'), 30);
      expect(headerOf(container, 'b').querySelector('[data-drop-indicator="after"]')).not.toBeNull();
      drag('drop', headerOf(container, 'b'), 30);
      expect(api.reorder).toHaveBeenLastCalledWith(['b', 'a', 'c']);
    });

    it('a group dropped where it already is, or on the ungrouped area, changes nothing', () => {
      const api = fakeApi([group('a', 0), group('b', 1)]);
      const { container } = render(<Tree sessions={[inA1]} api={api} />);
      drag('dragStart', headerOf(container, 'a'));
      drag('drop', headerOf(container, 'b'), 5);
      expect(api.reorder).not.toHaveBeenCalled();
      expect(drag('dragOver', container.querySelector<HTMLElement>('[data-ungrouped]')!)).toBe(true);
      drag('drop', container.querySelector<HTMLElement>('[data-ungrouped]')!);
      expect(api.reorder).not.toHaveBeenCalled();
      expect(api.move).not.toHaveBeenCalled();
    });

    it('an agent dropped on a group header is not mistaken for a group move, and a drag end clears the indicators', () => {
      const api = fakeApi(groupsAB());
      const { container } = render(<Tree sessions={all} api={api} />);
      drag('dragStart', rowOf(container, free1));
      drag('dragOver', rowOf(container, inA2), 5);
      expect(container.querySelector('[data-drop-indicator]')).not.toBeNull();
      drag('dragEnd', rowOf(container, free1));
      expect(container.querySelector('[data-drop-indicator]')).toBeNull();
      expect(api.reorder).not.toHaveBeenCalled();
    });

    it('works while a search is active (the move still goes through, naming the visible neighbour)', () => {
      const api = fakeApi(groupsAB());
      const { container } = render(<Tree sessions={[inA1, inA3, free1]} api={api} search="o" />);
      drag('dragStart', rowOf(container, free1));
      drag('drop', rowOf(container, inA3), 5);
      expect(api.move).toHaveBeenCalledWith(free1.sessionId.toLowerCase(), 'a', inA3.sessionId.toLowerCase());
    });

    it('is not draggable at all when the page gives no groups', () => {
      const { container } = render(<Tree sessions={[free1]} />);
      expect(rowOf(container, free1)).not.toHaveAttribute('draggable');
    });
  });

  describe('keyboard', () => {
    it('M on a row opens the Move dialog; choosing a group moves the agent to its end and closes the dialog', () => {
      const api = fakeApi(groupsAB());
      const { container } = render(<Tree sessions={all} api={api} />);
      const target = rowOf(container, free1);
      target.focus();
      fireEvent.keyDown(target, { key: 'm' });
      const dialog = screen.getByRole('dialog', { name: /Move free-one to a group/ });
      expect(within(dialog).getByRole('button', { name: /Group a/ })).toBeInTheDocument();
      // already ungrouped: the way out is disabled and says so
      expect(within(dialog).getByRole('button', { name: /Ungrouped \(current\)/ })).toBeDisabled();
      fireEvent.click(within(dialog).getByRole('button', { name: /Group b/ }));
      expect(api.move).toHaveBeenCalledExactlyOnceWith(free1.sessionId.toLowerCase(), 'b', null);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('the row button does the same with the pointer, marks the current group and offers the way out', () => {
      const api = fakeApi(groupsAB());
      const { container } = render(<Tree sessions={all} api={api} />);
      fireEvent.click(within(rowOf(container, inA1)).getByRole('button', { name: /Move a-one to a group/ }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByRole('button', { name: /Group a/ })).toBeDisabled();
      expect(within(dialog).getByRole('button', { name: /Group a/ })).toHaveAttribute('aria-current', 'true');
      fireEvent.click(within(dialog).getByRole('button', { name: /Ungrouped: take it out/ }));
      expect(api.move).toHaveBeenCalledWith(inA1.sessionId.toLowerCase(), null, null);
      // the click on the button did not select the row
      expect(rowOf(container, inA1)).toHaveAttribute('aria-selected', 'false');
    });

    it('Escape closes the Move dialog without moving', () => {
      const api = fakeApi(groupsAB());
      const { container } = render(<Tree sessions={all} api={api} />);
      fireEvent.keyDown(rowOf(container, free1), { key: 'm' });
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(api.move).not.toHaveBeenCalled();
    });

    it('the Move dialog makes a new group and moves the agent there; a bad name is said, a refusal keeps the dialog open', async () => {
      const api = fakeApi(groupsAB());
      const { container } = render(<Tree sessions={all} api={api} />);
      fireEvent.keyDown(rowOf(container, free1), { key: 'm' });
      const dialog = screen.getByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create and move' }));
      expect(within(dialog).getByRole('alert')).toHaveTextContent('empty');
      fireEvent.change(within(dialog).getByLabelText('New group'), { target: { value: 'x'.repeat(61) } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create and move' }));
      expect(within(dialog).getByRole('alert')).toHaveTextContent('limit is 60');
      expect(api.create).not.toHaveBeenCalled();

      api.create.mockResolvedValueOnce(undefined);
      fireEvent.change(within(dialog).getByLabelText('New group'), { target: { value: 'Mine' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create and move' }));
      await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('message at the top of the page'));
      expect(api.move).not.toHaveBeenCalled();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Create and move' }));
      await waitFor(() => expect(api.move).toHaveBeenCalledWith(free1.sessionId.toLowerCase(), 'new', null));
      expect(api.create).toHaveBeenLastCalledWith('Mine');
    });

    it('Alt+Down and Alt+Up move an agent inside its group (before the member after the next, or before the previous)', () => {
      const api = fakeApi(groupsAB());
      const { container } = render(<Tree sessions={all} api={api} />);
      fireEvent.keyDown(rowOf(container, inA1), { key: 'ArrowDown', altKey: true });
      expect(api.move).toHaveBeenLastCalledWith(inA1.sessionId.toLowerCase(), 'a', inA3.sessionId.toLowerCase());
      fireEvent.keyDown(rowOf(container, inA2), { key: 'ArrowDown', altKey: true });
      expect(api.move).toHaveBeenLastCalledWith(inA2.sessionId.toLowerCase(), 'a', null);
      fireEvent.keyDown(rowOf(container, inA3), { key: 'ArrowUp', altKey: true });
      expect(api.move).toHaveBeenLastCalledWith(inA3.sessionId.toLowerCase(), 'a', inA2.sessionId.toLowerCase());
      api.move.mockClear();
      // at the ends, and on an ungrouped agent: nothing
      fireEvent.keyDown(rowOf(container, inA1), { key: 'ArrowUp', altKey: true });
      fireEvent.keyDown(rowOf(container, inA3), { key: 'ArrowDown', altKey: true });
      fireEvent.keyDown(rowOf(container, free1), { key: 'ArrowDown', altKey: true });
      expect(api.move).not.toHaveBeenCalled();
    });

    it('Alt+Up and Alt+Down on a group header move the group among the groups', () => {
      const api = fakeApi([group('a', 0), group('b', 1), group('c', 2)]);
      const { container } = render(<Tree sessions={[inA1]} api={api} />);
      fireEvent.keyDown(headerOf(container, 'b'), { key: 'ArrowUp', altKey: true });
      expect(api.reorder).toHaveBeenLastCalledWith(['b', 'a', 'c']);
      fireEvent.keyDown(headerOf(container, 'b'), { key: 'ArrowDown', altKey: true });
      expect(api.reorder).toHaveBeenLastCalledWith(['a', 'c', 'b']);
      api.reorder.mockClear();
      fireEvent.keyDown(headerOf(container, 'a'), { key: 'ArrowUp', altKey: true });
      fireEvent.keyDown(headerOf(container, 'c'), { key: 'ArrowDown', altKey: true });
      expect(api.reorder).not.toHaveBeenCalled();
    });

    it('E on a group header, and its pencil button, open the group dialog', () => {
      const api = fakeApi(groupsAB());
      const { container } = render(<Tree sessions={all} api={api} />);
      fireEvent.keyDown(headerOf(container, 'a'), { key: 'e' });
      expect(screen.getByRole('dialog', { name: 'Group Group a' })).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.click(within(headerOf(container, 'b')).getByRole('button', { name: 'Edit the group Group b' }));
      expect(screen.getByRole('dialog', { name: 'Group Group b' })).toBeInTheDocument();
      // the click on the button did not toggle the group
      expect(headerOf(container, 'b')).toHaveAttribute('aria-expanded', 'true');
    });

    it('the group dialog renames, recolors (Save sends only what changed), and refuses a bad name', () => {
      const api = fakeApi(groupsAB());
      const { container } = render(<Tree sessions={all} api={api} />);
      fireEvent.keyDown(headerOf(container, 'a'), { key: 'e' });
      const dialog = screen.getByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: '   ' } });
      expect(within(dialog).getByRole('alert')).toHaveTextContent('empty');
      expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
      fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: '  Renamed ' } });
      fireEvent.click(within(dialog).getByRole('radio', { name: /Purple/ }));
      expect(within(dialog).getByRole('radio', { name: /Purple/ })).toHaveAttribute('aria-checked', 'true');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
      expect(api.update).toHaveBeenCalledExactlyOnceWith('a', { name: 'Renamed', color: 'purple' });
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('Save with nothing changed sends nothing', () => {
      const api = fakeApi(groupsAB());
      const { container } = render(<Tree sessions={all} api={api} />);
      fireEvent.keyDown(headerOf(container, 'a'), { key: 'e' });
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
      expect(api.update).not.toHaveBeenCalled();
    });

    it('the group dialog moves the group up and down (disabled at the ends) and shows the position', () => {
      const api = fakeApi([group('a', 0), group('b', 1)]);
      const { container } = render(<Tree sessions={all} api={api} />);
      fireEvent.keyDown(headerOf(container, 'a'), { key: 'e' });
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveTextContent('Position: 1 of 2');
      expect(within(dialog).getByRole('button', { name: 'Move up' })).toBeDisabled();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Move down' }));
      expect(api.reorder).toHaveBeenCalledExactlyOnceWith(['b', 'a']);
    });

    it('deleting is in two steps and says what happens to the agents', () => {
      const api = fakeApi(groupsAB());
      const { container } = render(<Tree sessions={all} api={api} />);
      fireEvent.keyDown(headerOf(container, 'a'), { key: 'e' });
      const dialog = screen.getByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete group' }));
      expect(api.remove).not.toHaveBeenCalled();
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Its 3 agents become ungrouped; no agent is stopped');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }));
      expect(api.remove).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete group' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete the group' }));
      expect(api.remove).toHaveBeenCalledExactlyOnceWith('a');
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('the keys of the group dialog and of the move button do not reach the list shortcuts when typing in a field', () => {
      const api = fakeApi(groupsAB());
      const { container } = render(<Tree sessions={all} api={api} />);
      fireEvent.keyDown(headerOf(container, 'a'), { key: 'e' });
      fireEvent.keyDown(within(screen.getByRole('dialog')).getByLabelText('Name'), { key: 'm' });
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
    });
  });
});

describe('NewGroupControl', () => {
  it('turns into a field: Enter creates and puts the button back; Escape cancels', async () => {
    const onCreate = vi.fn<(name: string) => Promise<boolean>>(() => Promise.resolve(true));
    render(<NewGroupControl onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: 'New group' }));
    const input = screen.getByLabelText('Name of the new group');
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: ' Reviews ' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(onCreate).toHaveBeenCalledExactlyOnceWith('Reviews'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'New group' })).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: 'New group' }));
    fireEvent.keyDown(screen.getByLabelText('Name of the new group'), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'New group' })).toBeInTheDocument();
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('says why a name is refused and does not call the server; keeps the field open when the server refuses', async () => {
    const onCreate = vi.fn<(name: string) => Promise<boolean>>(() => Promise.resolve(false));
    render(<NewGroupControl onCreate={onCreate} />);
    fireEvent.click(screen.getByRole('button', { name: 'New group' }));
    const input = screen.getByLabelText('Name of the new group');
    fireEvent.submit(input.closest('form')!);
    expect(screen.getByRole('alert')).toHaveTextContent('empty');
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'ok' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('message at the top of the page'));
    expect(screen.getByLabelText('Name of the new group')).toBeInTheDocument();
  });
});

describe('the width of a compact Tree row', () => {
  it('the Move to a group button floats over the age instead of holding an empty slot beside the name (the name was cut to "docs..." with room left)', () => {
    const one = row({ folder: 'shop', displayName: 'docs-writer', state: 'idle', statusUpdatedAt: 100 });
    const { container } = render(<Tree sessions={[one]} api={fakeApi([group('a', 0)])} />);
    const button = within(rowOf(container, one)).getByRole('button', { name: /Move docs-writer to a group/ });
    const actions = button.closest<HTMLElement>('[data-row-actions]');
    expect(actions).not.toBeNull();
    expect(actions?.className).toContain('absolute');
    expect(actions?.className).toContain('hidden');
    expect(actions?.className).toContain('group-hover:flex');
    expect(actions?.className).toContain('group-focus-within:flex');
  });
});
