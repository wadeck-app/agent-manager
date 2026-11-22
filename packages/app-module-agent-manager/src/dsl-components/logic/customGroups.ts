import { placeMember, type CustomGroupDto, type SessionRowDto } from '../shared.js';
import { worstState, type AgentState } from './states.js';

/** The groups and who is in each (session ids in display order): what the user organized, independent of the filters and of the poll. */
export interface GroupLayout {
  groups: CustomGroupDto[];
  members: Record<string, string[]>;
}

/** A group with the rows the list shows in it (after the search) and the worst state of them (undefined when it is empty). */
export interface GroupSection {
  group: CustomGroupDto;
  sessions: SessionRowDto[];
  rollup: AgentState | undefined;
}

const idOf = (session: Pick<SessionRowDto, 'sessionId'>): string => session.sessionId.toLowerCase();

/** The layout the server answered: the groups by `order`, the members by `customGroupOrder` (a row naming an unknown group is ungrouped). */
export function layoutOf(groups: readonly CustomGroupDto[], rows: readonly SessionRowDto[]): GroupLayout {
  const sorted = [...groups].sort((a, b) => a.order - b.order);
  const members: Record<string, string[]> = Object.fromEntries(sorted.map((group) => [group.id, [] as string[]]));
  const grouped = rows.filter((row) => row.customGroupId !== null && members[row.customGroupId] !== undefined);
  for (const row of [...grouped].sort((a, b) => a.customGroupOrder - b.customGroupOrder || a.pid - b.pid)) {
    members[row.customGroupId as string]?.push(idOf(row));
  }
  return { groups: sorted, members };
}

export function layoutsEqual(a: GroupLayout, b: GroupLayout): boolean {
  return (
    a.groups.length === b.groups.length &&
    a.groups.every((group, index) => {
      const other = b.groups[index];
      const left = a.members[group.id] ?? [];
      const right = other === undefined ? [] : (b.members[other.id] ?? []);
      return other !== undefined && group.id === other.id && group.name === other.name && group.color === other.color && group.collapsed === other.collapsed && group.sort === other.sort && group.bodyColor === other.bodyColor && left.length === right.length && left.every((id, position) => id === right[position]);
    })
  );
}

/** The rows with their group and position taken from the layout (rows are returned as they are when nothing changes). */
export function applyLayout(rows: readonly SessionRowDto[], layout: GroupLayout): SessionRowDto[] {
  const where = new Map<string, { id: string; position: number }>();
  for (const group of layout.groups) {
    (layout.members[group.id] ?? []).forEach((id, position) => where.set(id, { id: group.id, position }));
  }
  return rows.map((row) => {
    const place = where.get(idOf(row));
    const customGroupId = place?.id ?? null;
    const customGroupOrder = place?.position ?? -1;
    return row.customGroupId === customGroupId && row.customGroupOrder === customGroupOrder ? row : { ...row, customGroupId, customGroupOrder };
  });
}

/** The layout after moving `sessionId` into `groupId` (null: out of every group), before `beforeId` (null: at the end). Undefined when the move is not possible. */
export function moveInLayout(layout: GroupLayout, sessionId: string, groupId: string | null, beforeId: string | null): GroupLayout | undefined {
  const id = sessionId.toLowerCase();
  if (groupId !== null && layout.members[groupId] === undefined) {
    return undefined;
  }
  const members: Record<string, string[]> = {};
  for (const group of layout.groups) {
    const current = layout.members[group.id] ?? [];
    if (group.id === groupId) {
      const placed = placeMember(current, id, beforeId);
      if (placed === undefined) {
        return undefined;
      }
      members[group.id] = placed;
    } else {
      members[group.id] = current.filter((member) => member !== id);
    }
  }
  return { groups: layout.groups, members };
}

/** The group ids in the order they take when `dragged` is dropped on the `after` (or before) side of `target`. Undefined when nothing changes. */
export function reorderedGroupIds(groups: readonly CustomGroupDto[], dragged: string, target: string, after: boolean): string[] | undefined {
  if (dragged === target) {
    return undefined;
  }
  const rest = groups.map((group) => group.id).filter((id) => id !== dragged);
  const at = rest.indexOf(target);
  if (at < 0 || !groups.some((group) => group.id === dragged)) {
    return undefined;
  }
  const next = [...rest.slice(0, at + (after ? 1 : 0)), dragged, ...rest.slice(at + (after ? 1 : 0))];
  return next.every((id, index) => id === groups[index]?.id) ? undefined : next;
}

/** The ids with `id` one step earlier (-1) or later (+1); undefined at the end of the list. */
export function stepGroupIds(groups: readonly CustomGroupDto[], id: string, step: -1 | 1): string[] | undefined {
  const ids = groups.map((group) => group.id);
  const at = ids.indexOf(id);
  const to = at + step;
  if (at < 0 || to < 0 || to >= ids.length) {
    return undefined;
  }
  [ids[at], ids[to]] = [ids[to] as string, ids[at] as string];
  return ids;
}

/** The session a dropped row goes before: the target itself when the pointer is in its upper half, else the member after it (null: the end of the group). */
export function dropBefore(memberIds: readonly string[], targetId: string, after: boolean): string | null {
  if (!after) {
    return targetId;
  }
  const at = memberIds.indexOf(targetId);
  return at < 0 ? null : (memberIds[at + 1] ?? null);
}

/** True when the pointer is in the lower half of the box (a drop there goes after the row). */
export function inLowerHalf(clientY: number, box: { top: number; height: number }): boolean {
  return clientY >= box.top + box.height / 2;
}

/**
 * The groups of the list: every group in order (an empty one too: it is a drop target) with its rows, and the rows no group claims. A group with no
 * matching row is left out while `hideEmpty` (a search must not list empty sections).
 */
export function partitionByGroup(sessions: readonly SessionRowDto[], groups: readonly CustomGroupDto[], hideEmpty: boolean): { sections: GroupSection[]; ungrouped: SessionRowDto[] } {
  const known = new Set(groups.map((group) => group.id));
  const sections = [...groups]
    .sort((a, b) => a.order - b.order)
    .map((group): GroupSection => {
      const rows = sessions.filter((session) => session.customGroupId === group.id).sort((a, b) => a.customGroupOrder - b.customGroupOrder || a.pid - b.pid);
      return { group, sessions: rows, rollup: worstState(rows.map((row) => row.state)) };
    });
  return {
    sections: hideEmpty ? sections.filter((section) => section.sessions.length > 0) : sections,
    ungrouped: sessions.filter((session) => session.customGroupId === null || !known.has(session.customGroupId)),
  };
}

/** The group a row is in, for the label of a search result; undefined when ungrouped. */
export function groupOfRow(row: Pick<SessionRowDto, 'customGroupId'>, groups: readonly CustomGroupDto[]): CustomGroupDto | undefined {
  return row.customGroupId === null ? undefined : groups.find((group) => group.id === row.customGroupId);
}
