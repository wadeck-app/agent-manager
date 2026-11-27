import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AgentRow } from '../data/types.js';
import { row } from '../logic/fixtures.js';
import { parseQuery } from '../logic/fuzzy.js';
import { DEFAULT_VIEW_OPTIONS } from '../logic/viewOptions.js';
import type { CustomGroupDto } from '../shared.js';
import type { GroupsApi, MarksApi } from './common.js';
import { CustomList } from './CustomList.js';

const NOW = 2_000_000;
const group = (id: string, order: number, overrides: Partial<CustomGroupDto> = {}): CustomGroupDto => ({ id, name: `Group ${id}`, color: null, collapsed: false, order, sort: 'manual', bodyColor: null, ...overrides });

function fakeApi(groups: CustomGroupDto[]) {
  return {
    groups,
    move: vi.fn<GroupsApi['move']>(),
    create: vi.fn<GroupsApi['create']>(),
    update: vi.fn<GroupsApi['update']>(),
    remove: vi.fn<GroupsApi['remove']>(),
    reorder: vi.fn<GroupsApi['reorder']>(),
  };
}

function Custom({ sessions, api, marks, search = '' }: { sessions: AgentRow[]; api?: GroupsApi; marks?: MarksApi; search?: string }) {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const service: UrlParamService = { get: () => null, set: () => undefined };
  return (
    <UrlParamContext.Provider value={service}>
      <CustomList sessions={sessions} selectedId={selected} onSelect={setSelected} now={NOW} query={parseQuery(search)} searching={search !== ''} options={DEFAULT_VIEW_OPTIONS} {...(api === undefined ? {} : { groups: api })} {...(marks === undefined ? {} : { marks })} />
    </UrlParamContext.Provider>
  );
}

const rowOf = (container: HTMLElement, session: AgentRow): HTMLElement => {
  const element = container.querySelector<HTMLElement>(`[data-session-id="${session.sessionId.toLowerCase()}"]`);
  if (element === null) {
    throw new Error(`no row for ${session.sessionId}`);
  }
  return element;
};
const headerOf = (container: HTMLElement, id: string): HTMLElement => {
  const element = container.querySelector<HTMLElement>(id === 'ungrouped' ? '[data-ungrouped]' : `[data-group-id="${id}"]`);
  if (element === null) {
    throw new Error(`no header for ${id}`);
  }
  return element;
};
// The drop zone under the last agent of a group: an overlay that exists only while an agent is dragged.
const stripOf = (container: HTMLElement, id: string): HTMLElement => container.querySelector<HTMLElement>(`[data-group-end="${id}"] [data-group-end-zone]`) as HTMLElement;

function drag(type: 'dragStart' | 'dragOver' | 'drop' | 'dragEnd', element: HTMLElement): boolean {
  const event = createEvent[type](element);
  Object.defineProperty(event, 'dataTransfer', { value: { setData: vi.fn(), effectAllowed: '', dropEffect: '' } });
  let result = true;
  act(() => {
    result = fireEvent(element, event);
  });
  return result;
}

describe('CustomList', () => {
  const a1 = row({ folder: 'shop', displayName: 'a-one', customGroupId: 'a', customGroupOrder: 0, state: 'idle', statusUpdatedAt: 100 });
  const a2 = row({ folder: 'shop', displayName: 'a-two', customGroupId: 'a', customGroupOrder: 1, state: 'needs-you', reason: 'permission prompt', statusUpdatedAt: 50 });
  const b1 = row({ folder: 'docs', displayName: 'b-one', customGroupId: 'b', customGroupOrder: 0, state: 'working', statusUpdatedAt: 200 });
  const u1 = row({ folder: 'blog', displayName: 'loose-one', state: 'idle' });
  const all = [a1, a2, b1, u1];
  const groups = (): CustomGroupDto[] => [group('a', 0), group('b', 1), group('c', 2, { sort: 'urgency' })];

  it('shows every group in order (an empty one too) and the ungrouped agents last, with the count of each', () => {
    const { container } = render(<Custom sessions={all} api={fakeApi(groups())} />);
    const order = Array.from(container.querySelectorAll('[data-custom-section]')).map((element) => element.getAttribute('data-custom-section'));
    expect(order).toEqual(['a', 'b', 'c', 'ungrouped']);
    expect(headerOf(container, 'a')).toHaveTextContent('Group a');
    expect(headerOf(container, 'a')).toHaveTextContent('2');
    expect(headerOf(container, 'c')).toHaveTextContent('0');
    expect(within(container.querySelector('[data-custom-section="ungrouped"]') as HTMLElement).getByText('loose-one')).toBeInTheDocument();
  });

  it('the body color tints the whole body of the group (QA3 R11), the ungrouped bucket and a group without one stay plain', () => {
    const colored = [group('a', 0, { bodyColor: 'cyan' }), group('b', 1)];
    const { container } = render(<Custom sessions={all} api={fakeApi(colored)} />);
    const body = (id: string): HTMLElement => container.querySelector(`[data-custom-section="${id}"] [role="group"]`) as HTMLElement;
    expect(body('a')).toHaveClass('bg-hue-cyan-bg');
    // The body is an isolated stacking context: the underlay of a state tinted row sits between the body color and the tint.
    expect(body('a')).toHaveClass('isolate');
    expect(body('b').className).toBe('');
    expect(body('ungrouped').className).toBe('');
  });

  it('a state tinted row on a colored body is drawn over the plain surface (an underlay), a plain row and a row of an uncolored group are not (QA3 R11)', () => {
    const colored = [group('a', 0, { bodyColor: 'cyan' }), group('b', 1)];
    const { container } = render(<Custom sessions={[a1, a2, b1]} api={fakeApi(colored)} />);
    // a2 needs you (tinted), a1 is idle (body color only), b1 is in a group without a body color.
    expect(rowOf(container, a2).className).toContain('before:bg-surface');
    expect(rowOf(container, a1).className).not.toContain('before:bg-surface');
    expect(rowOf(container, b1).className).not.toContain('before:bg-surface');
  });

  it('a folded group shows the most urgent state of its agents; an open one does not repeat it', () => {
    const folded = [group('a', 0, { collapsed: true }), group('b', 1)];
    const { container } = render(<Custom sessions={all} api={fakeApi(folded)} />);
    expect(within(headerOf(container, 'a')).getByRole('img', { name: 'Needs you' })).toBeInTheDocument();
    expect(within(headerOf(container, 'b')).queryByRole('img', { name: 'Working' })).toBeNull();
    // the folded group hides its agents
    expect(container.querySelector(`[data-session-id="${a1.sessionId.toLowerCase()}"]`)).toBeNull();
  });

  it('folding a group is saved on the group (the next poll, another tab)', () => {
    const api = fakeApi(groups());
    const { container } = render(<Custom sessions={all} api={api} />);
    fireEvent.click(headerOf(container, 'a'));
    expect(api.update).toHaveBeenCalledWith('a', { collapsed: true });
  });

  it('orders the agents of a group by its setting: urgency puts the agent that needs you first', () => {
    const sorted = [group('a', 0, { sort: 'urgency' })];
    const { container } = render(<Custom sessions={[a1, a2]} api={fakeApi(sorted)} />);
    const names = Array.from(container.querySelectorAll('[data-custom-section="a"] [data-session-id]')).map((element) => element.textContent);
    expect(names[0]).toContain('a-two');
    expect(names[1]).toContain('a-one');
  });

  it('with no group, says so in one line, offers no preset button and creates nothing by itself', () => {
    const api = fakeApi([]);
    render(<Custom sessions={all} api={api} />);
    expect(api.create).not.toHaveBeenCalled();
    expect(screen.getByText('No custom group yet: all the agents are below, ungrouped. Use New group in the toolbar to make one.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Herdr/ })).toBeNull();
    // the agents are listed meanwhile, ungrouped
    expect(screen.getByText('loose-one')).toBeInTheDocument();
  });

  it('does not show the empty-state line once there is a group', () => {
    render(<Custom sessions={all} api={fakeApi(groups())} />);
    expect(screen.queryByText(/No custom group yet/)).toBeNull();
  });

  describe('drag and drop (the held item is read before it is cleared)', () => {
    it('a drag moves nothing on the page: the strip under a group keeps its height, the drop zone and the hint are overlays, no element is added to the flow', () => {
      const { container } = render(<Custom sessions={all} api={fakeApi([group('a', 0, { sort: 'urgency' }), group('b', 1)])} />);
      const strips = Array.from(container.querySelectorAll<HTMLElement>('[data-group-end]'));
      const before = strips.map((strip) => strip.className);
      const flowBefore = container.querySelectorAll('[data-session-id], [data-group-id]').length;
      expect(strips.length).toBeGreaterThan(0);
      expect(container.querySelector('[data-group-end-zone]')).toBeNull();
      drag('dragStart', rowOf(container, a1));
      // Same height classes before and during the drag: only an absolute zone appears inside the strip.
      expect(Array.from(container.querySelectorAll<HTMLElement>('[data-group-end]')).map((strip) => strip.className)).toEqual(before);
      const zones = Array.from(container.querySelectorAll<HTMLElement>('[data-group-end-zone]'));
      expect(zones.length).toBeGreaterThan(0);
      for (const zone of zones) {
        expect(zone.className).toContain('absolute');
      }
      // The drop indicators of a position are absolute too.
      drag('dragOver', rowOf(container, b1));
      for (const bar of Array.from(container.querySelectorAll<HTMLElement>('[data-drop-indicator]'))) {
        expect(bar.className).toContain('absolute');
      }
      // The hint of a refused drop floats over the list.
      drag('dragOver', rowOf(container, a2));
      const hint = container.ownerDocument.querySelector<HTMLElement>('[data-drop-hint]');
      expect(hint).not.toBeNull();
      expect(hint?.className).toContain('absolute');
      expect(container.querySelectorAll('[data-session-id], [data-group-id]').length).toBeGreaterThanOrEqual(flowBefore);
    });

    it('an agent dropped on an agent of another group joins that group before it', () => {
      const api = fakeApi(groups());
      const { container } = render(<Custom sessions={all} api={api} />);
      drag('dragStart', rowOf(container, a1));
      expect(drag('dragOver', rowOf(container, b1))).toBe(false);
      drag('drop', rowOf(container, b1));
      expect(api.move).toHaveBeenCalledWith(a1.sessionId.toLowerCase(), 'b', b1.sessionId.toLowerCase());
    });

    it('on a group header: the end of that group; on the strip under its last agent: the bottom', () => {
      const api = fakeApi(groups());
      const { container } = render(<Custom sessions={all} api={api} />);
      drag('dragStart', rowOf(container, a1));
      drag('drop', headerOf(container, 'b'));
      expect(api.move).toHaveBeenLastCalledWith(a1.sessionId.toLowerCase(), 'b', null);
      drag('dragStart', rowOf(container, u1));
      drag('drop', stripOf(container, 'b'));
      expect(api.move).toHaveBeenLastCalledWith(u1.sessionId.toLowerCase(), 'b', null);
    });

    // Bug of build 2026.11.22-051: only the header, the rows and the strip were targets, so a drop on the "Empty. Drag an agent here" line (or on the gap of
    // a block) was ignored without a drop cursor and without a word.
    it('on the "Empty. Drag an agent here" line of an empty group the agent joins that group', () => {
      const api = fakeApi(groups());
      const { container } = render(<Custom sessions={all} api={api} />);
      const hint = within(container.querySelector('[data-custom-section="c"]') as HTMLElement).getByText(/Drag an agent here/);
      drag('dragStart', rowOf(container, a1));
      expect(drag('dragOver', hint)).toBe(false);
      drag('drop', hint);
      expect(api.move).toHaveBeenCalledWith(a1.sessionId.toLowerCase(), 'c', null);
    });

    it('anywhere in the block of a group (its body, its edges) an agent joins the end of the group; the Ungrouped block takes it out', () => {
      const api = fakeApi(groups());
      const { container } = render(<Custom sessions={all} api={api} />);
      drag('dragStart', rowOf(container, u1));
      const block = container.querySelector('[data-custom-section="b"]') as HTMLElement;
      expect(drag('dragOver', block)).toBe(false);
      drag('drop', block);
      expect(api.move).toHaveBeenLastCalledWith(u1.sessionId.toLowerCase(), 'b', null);
      drag('dragStart', rowOf(container, a1));
      drag('drop', within(container.querySelector('[data-custom-section="b"]') as HTMLElement).getByRole('group'));
      expect(api.move).toHaveBeenLastCalledWith(a1.sessionId.toLowerCase(), 'b', null);
      drag('dragStart', rowOf(container, a1));
      drag('drop', container.querySelector('[data-custom-section="ungrouped"]') as HTMLElement);
      expect(api.move).toHaveBeenLastCalledWith(a1.sessionId.toLowerCase(), null, null);
    });

    it('a drop on the block of its own group does nothing when it is already the last one, and a row drop still wins over the block', () => {
      const api = fakeApi(groups());
      const { container } = render(<Custom sessions={all} api={api} />);
      drag('dragStart', rowOf(container, a2));
      drag('drop', container.querySelector('[data-custom-section="a"]') as HTMLElement);
      expect(api.move).not.toHaveBeenCalled();
      drag('dragStart', rowOf(container, a1));
      drag('drop', rowOf(container, b1));
      // one move only: the row handled it and stopped the event before the block
      expect(api.move).toHaveBeenCalledTimes(1);
      expect(api.move).toHaveBeenCalledWith(a1.sessionId.toLowerCase(), 'b', b1.sessionId.toLowerCase());
    });

    it('on the Ungrouped bucket the agent leaves its group', () => {
      const api = fakeApi(groups());
      const { container } = render(<Custom sessions={all} api={api} />);
      drag('dragStart', rowOf(container, a1));
      drag('drop', headerOf(container, 'ungrouped'));
      expect(api.move).toHaveBeenCalledWith(a1.sessionId.toLowerCase(), null, null);
    });

    it('a group header dropped on another header reorders the groups', () => {
      const api = fakeApi(groups());
      const { container } = render(<Custom sessions={all} api={api} />);
      drag('dragStart', headerOf(container, 'a'));
      drag('drop', headerOf(container, 'b'));
      expect(api.reorder).toHaveBeenCalledWith(['b', 'a', 'c']);
    });

    it('inside a group that is not manual the drop is ignored and a visible hint says why', () => {
      const sorted = [group('a', 0, { sort: 'urgency' }), group('b', 1)];
      const api = fakeApi(sorted);
      const { container } = render(<Custom sessions={all} api={api} />);
      drag('dragStart', rowOf(container, a1));
      // no drop cursor (the page does not accept the drop) and the hint shows
      expect(drag('dragOver', rowOf(container, a2))).toBe(true);
      expect(container.ownerDocument.querySelector('[data-drop-hint]')?.textContent).toMatch(/ordered by urgency.*group settings/i);
      drag('drop', rowOf(container, a2));
      expect(api.move).not.toHaveBeenCalled();
    });

    it('a drop with nothing held does nothing (a file dragged from outside)', () => {
      const api = fakeApi(groups());
      const { container } = render(<Custom sessions={all} api={api} />);
      drag('drop', headerOf(container, 'b'));
      expect(api.move).not.toHaveBeenCalled();
      expect(api.reorder).not.toHaveBeenCalled();
    });
  });

  describe('settings of a group (the folder-cog button)', () => {
    it('changes the order, the header color and the body color at once, and renames', () => {
      const api = fakeApi(groups());
      render(<Custom sessions={all} api={api} />);
      fireEvent.click(screen.getByRole('button', { name: 'Settings of the group Group a' }));
      const panel = screen.getByRole('dialog', { name: 'Settings of the group Group a' });
      fireEvent.click(within(panel).getByRole('radio', { name: 'By urgency' }));
      expect(api.update).toHaveBeenLastCalledWith('a', { sort: 'urgency' });
      fireEvent.click(within(within(panel).getByRole('radiogroup', { name: 'Header color' })).getByRole('radio', { name: 'Red' }));
      expect(api.update).toHaveBeenLastCalledWith('a', { color: 'red' });
      fireEvent.click(within(within(panel).getByRole('radiogroup', { name: 'Body color' })).getByRole('radio', { name: 'Blue' }));
      expect(api.update).toHaveBeenLastCalledWith('a', { bodyColor: 'blue' });
      fireEvent.change(within(panel).getByLabelText('Name'), { target: { value: 'Focus' } });
      fireEvent.click(within(panel).getByRole('button', { name: 'Rename' }));
      expect(api.update).toHaveBeenLastCalledWith('a', { name: 'Focus' });
    });

    it('says why a name is refused, and keeps the Rename button off', () => {
      const api = fakeApi(groups());
      render(<Custom sessions={all} api={api} />);
      fireEvent.click(screen.getByRole('button', { name: 'Settings of the group Group a' }));
      const panel = screen.getByRole('dialog', { name: 'Settings of the group Group a' });
      fireEvent.change(within(panel).getByLabelText('Name'), { target: { value: '   ' } });
      expect(within(panel).getByText(/name is empty/i)).toBeInTheDocument();
      expect(within(panel).getByRole('button', { name: 'Rename' })).toBeDisabled();
    });

    it('closes with Escape', () => {
      render(<Custom sessions={all} api={fakeApi(groups())} />);
      fireEvent.click(screen.getByRole('button', { name: 'Settings of the group Group a' }));
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: /Settings of the group/ })).toBeNull();
    });

    it('has no settings button on the Ungrouped bucket', () => {
      render(<Custom sessions={[u1]} api={fakeApi([])} />);
      expect(screen.queryByRole('button', { name: /Settings of the group/ })).toBeNull();
    });
  });

  describe('flag and unread (the row menu)', () => {
    const marks = (): MarksApi & { setMarks: ReturnType<typeof vi.fn<MarksApi['setMarks']>> } => ({ setMarks: vi.fn<MarksApi['setMarks']>() });

    it('a right-click opens the menu: Flag, Mark as unread, Move to a group', () => {
      const api = marks();
      const { container } = render(<Custom sessions={all} api={fakeApi(groups())} marks={api} />);
      fireEvent.contextMenu(rowOf(container, a1), { clientX: 120, clientY: 80 });
      const menu = screen.getByRole('menu');
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Flag' }));
      expect(api.setMarks).toHaveBeenCalledWith(a1.sessionId.toLowerCase(), { flag: true });
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('the kebab button opens the same menu; a flagged agent offers to remove the flag, an unread one to mark it read', () => {
      const api = marks();
      const flagged = row({ displayName: 'flagged-one', customGroupId: 'a', customGroupOrder: 5, flagged: true, unread: true, state: 'done' });
      render(<Custom sessions={[flagged]} api={fakeApi(groups())} marks={api} />);
      fireEvent.click(screen.getByRole('button', { name: 'Actions of flagged-one' }));
      const menu = screen.getByRole('menu');
      fireEvent.click(within(menu).getByRole('menuitem', { name: 'Remove the flag' }));
      expect(api.setMarks).toHaveBeenCalledWith(flagged.sessionId.toLowerCase(), { flag: false });
      fireEvent.click(screen.getByRole('button', { name: 'Actions of flagged-one' }));
      fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Mark as read' }));
      expect(api.setMarks).toHaveBeenLastCalledWith(flagged.sessionId.toLowerCase(), { unread: false });
    });

    it('a flagged row says so (an icon with its text), and an unread idle agent shows the finished-unseen light', () => {
      const flagged = row({ displayName: 'flagged-one', customGroupId: 'a', customGroupOrder: 5, flagged: true });
      const unread = row({ displayName: 'unread-one', customGroupId: 'a', customGroupOrder: 6, state: 'idle', unread: true });
      const { container } = render(<Custom sessions={[flagged, unread]} api={fakeApi(groups())} marks={marks()} />);
      expect(within(rowOf(container, flagged)).getByText('Flagged')).toBeInTheDocument();
      expect(rowOf(container, unread).querySelector('[data-herdr-light="dot"]')).not.toBeNull();
    });

    it('without a marks API the menu still holds Move to a group, and no flag or unread item', () => {
      render(<Custom sessions={all} api={fakeApi(groups())} />);
      fireEvent.click(screen.getAllByRole('button', { name: /Actions of/ })[0] as HTMLElement);
      const menu = screen.getByRole('menu');
      expect(within(menu).getByRole('menuitem', { name: 'Move to a group...' })).toBeInTheDocument();
      expect(within(menu).queryByRole('menuitem', { name: 'Flag' })).toBeNull();
    });
  });

  it('M opens the Move dialog and Alt+ArrowDown moves an agent inside a manual group', () => {
    const api = fakeApi(groups());
    const { container } = render(<Custom sessions={all} api={api} />);
    fireEvent.keyDown(rowOf(container, a1), { key: 'ArrowDown', altKey: true });
    expect(api.move).toHaveBeenCalledWith(a1.sessionId.toLowerCase(), 'a', null);
    fireEvent.keyDown(rowOf(container, a1), { key: 'm' });
    expect(screen.getByRole('dialog', { name: /Move a-one to a group/ })).toBeInTheDocument();
  });

  it('Alt+ArrowDown on an agent of a group that is not manual says why nothing moves', () => {
    const api = fakeApi([group('a', 0, { sort: 'name' })]);
    const { container } = render(<Custom sessions={[a1, a2]} api={api} />);
    fireEvent.keyDown(rowOf(container, a1), { key: 'ArrowDown', altKey: true });
    expect(api.move).not.toHaveBeenCalled();
    expect(container.ownerDocument.querySelector('[data-drop-hint]')?.textContent).toMatch(/ordered by name/i);
  });

  it('Alt+ArrowDown on a group header moves the group', () => {
    const api = fakeApi(groups());
    const { container } = render(<Custom sessions={all} api={api} />);
    fireEvent.keyDown(headerOf(container, 'a'), { key: 'ArrowDown', altKey: true });
    expect(api.reorder).toHaveBeenCalledWith(['b', 'a', 'c']);
  });
});

describe('CustomList: one vertical axis for the row lights and the header icons (Herdr WAgents)', () => {
  const a1 = row({ folder: 'shop', displayName: 'a-one', customGroupId: 'a', customGroupOrder: 0, state: 'idle', statusUpdatedAt: 100 });
  const a2 = row({ folder: 'shop', displayName: 'a-two', customGroupId: 'a', customGroupOrder: 1, state: 'working', statusUpdatedAt: 50 });
  const a3 = row({ folder: 'shop', displayName: 'a-three', customGroupId: 'a', customGroupOrder: 2, state: 'done', statusUpdatedAt: 50 });

  it('every row light and the settings icon of the group sit in the same 28 px centred column, with the same right padding', () => {
    const { container } = render(<Custom sessions={[a1, a2, a3]} api={fakeApi([group('a', 0)])} />);
    const columns = Array.from(container.querySelectorAll<HTMLElement>('[data-status-column]'));
    // Three rows, the group settings column and the empty column of the Ungrouped header.
    expect(columns.length).toBeGreaterThanOrEqual(4);
    for (const column of columns) {
      expect(column.className).toContain('w-7');
      expect(column.className).toContain('justify-center');
    }
    const header = headerOf(container, 'a');
    expect(header.querySelector('[data-status-column] [data-row-icon-button]')).not.toBeNull();
    expect(header.className).toContain('pr-2.5');
    // The row ends 8 px (mx-2) plus 2 px (pr-0.5) from the list edge, the header 10 px: the same axis.
    expect(rowOf(container, a1).className).toContain('mx-2');
    expect(rowOf(container, a1).className).toContain('pr-0.5');
  });

  it('the open row has the gradient and the gold outline, the other rows do not', () => {
    const { container } = render(<Custom sessions={[a1, a2, a3]} api={fakeApi([group('a', 0)])} />);
    expect(rowOf(container, a2).className).not.toContain('--am-herdr-active-bg');
    fireEvent.click(rowOf(container, a2));
    expect(rowOf(container, a2).className).toContain('bg-[image:var(--am-herdr-active-bg)]');
    expect(rowOf(container, a2).className).toContain('--am-herdr-active-edge');
    expect(rowOf(container, a1).className).not.toContain('--am-herdr-active-bg');
  });
});
