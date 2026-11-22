import type { CustomGroupDto, GroupSort, SessionRowDto } from '../shared.js';
import { ATTENTION, worstState, type AgentState } from './states.js';

/*
 * The Custom mode: ALL live agents inside the user's custom groups (ungrouped ones in a last bucket), the way the user's Herdr panel (the WAgents mod, sort mode
 * "Custom groups") shows them. Pure functions: ordering, sections, and the drop rules. See research/ui-audit.md for what was ported and what was not.
 */

/** The id of the bucket of the agents no group claims (never a group id: those are UUIDs). */
export const UNGROUPED_ID = 'ungrouped';

/** The words of the order of a group in the hint and the menu. */
export const SORT_LABEL: Record<GroupSort, string> = { manual: 'Manual (drag and drop)', urgency: 'By urgency', name: 'By name', recent: 'By latest change' };

/**
 * The row as the Custom mode shows it: an agent marked unread shows the "finished, not seen" dot instead of the idle ring (the Herdr behavior); a more urgent
 * state is never hidden by the mark. The same object back when nothing changes.
 */
export function effectiveRow(row: SessionRowDto): SessionRowDto {
  return row.unread && row.state === 'idle' ? { ...row, state: 'done' } : row;
}

/** The rows of a group in the order of its setting. `manual` is the saved position; the others are computed, newest change first inside a state. */
export function sortMembers(sort: GroupSort, rows: readonly SessionRowDto[]): SessionRowDto[] {
  const recent = (a: SessionRowDto, b: SessionRowDto): number => (b.statusUpdatedAt ?? 0) - (a.statusUpdatedAt ?? 0);
  const byPid = (a: SessionRowDto, b: SessionRowDto): number => a.pid - b.pid;
  const compare = {
    manual: (a: SessionRowDto, b: SessionRowDto) => a.customGroupOrder - b.customGroupOrder || byPid(a, b),
    // Needs you first (the order of ATTENTION), then the most recent change.
    urgency: (a: SessionRowDto, b: SessionRowDto) => ATTENTION[b.state] - ATTENTION[a.state] || recent(a, b) || byPid(a, b),
    name: (a: SessionRowDto, b: SessionRowDto) => a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()) || byPid(a, b),
    recent: (a: SessionRowDto, b: SessionRowDto) => recent(a, b) || byPid(a, b),
  }[sort];
  return [...rows].sort(compare);
}

/** One block of the list: a custom group, or the Ungrouped bucket (`group` null). */
export interface CustomSection {
  id: string;
  group: CustomGroupDto | null;
  /** The agents in the order of the group's setting (the unread ones already shown as done). */
  sessions: SessionRowDto[];
  /** The most urgent state of the agents, undefined when the section is empty: shown on a folded header. */
  rollup: AgentState | undefined;
  sort: GroupSort;
}

/** Every group in order (an empty one too: it is a drop target), then the Ungrouped bucket with the rows no group claims. */
export function customSections(rows: readonly SessionRowDto[], groups: readonly CustomGroupDto[]): CustomSection[] {
  const known = new Set(groups.map((group) => group.id));
  const shown = rows.map(effectiveRow);
  const sections = [...groups]
    .sort((a, b) => a.order - b.order)
    .map((group): CustomSection => {
      const sessions = sortMembers(group.sort, shown.filter((row) => row.customGroupId === group.id));
      return { id: group.id, group, sessions, rollup: worstState(sessions.map((row) => row.state)), sort: group.sort };
    });
  const loose = sortMembers('urgency', shown.filter((row) => row.customGroupId === null || !known.has(row.customGroupId)));
  return [...sections, { id: UNGROUPED_ID, group: null, sessions: loose, rollup: worstState(loose.map((row) => row.state)), sort: 'urgency' }];
}

/** What is held: an agent (with the group it comes from, null = Ungrouped) or a group header. */
export type Held = { kind: 'agent'; id: string; from: string | null } | { kind: 'group'; id: string };

/** Where it is dropped: onto an agent row, onto a group header (`groupId` null: the Ungrouped bucket), or onto the strip under the last agent of a group. */
export type DropTarget = { kind: 'row'; id: string; groupId: string | null } | { kind: 'header'; groupId: string | null } | { kind: 'end'; groupId: string | null };

export interface DropContext {
  /** The groups in display order. */
  groups: readonly Pick<CustomGroupDto, 'id' | 'sort'>[];
  /** The ids of the agents shown in a group (null: the Ungrouped bucket), in display order. */
  membersOf: (groupId: string | null) => readonly string[];
}

export type DropOutcome = { kind: 'none' } | { kind: 'move'; sessionId: string; groupId: string | null; beforeId: string | null } | { kind: 'reorder'; ids: string[] } | { kind: 'ignored'; hint: string };

const NONE: DropOutcome = { kind: 'none' };

/** The ids with `from` taking the place of `to`: dropped on a later item it lands after it, on an earlier one before it. */
function moved(ids: readonly string[], from: string, to: string): string[] {
  const i = ids.indexOf(from);
  const j = ids.indexOf(to);
  if (i < 0 || j < 0 || i === j) {
    return [...ids];
  }
  const next = [...ids];
  next.splice(i, 1);
  next.splice(j, 0, from);
  return next;
}

/**
 * What a drop does. The held item is a PARAMETER: a handler that clears it before validating the target silently rejects every drop (the bug of the Herdr mod
 * that cost a debugging round), so the caller reads it, clears its state, and decides here with what it read.
 *
 * - agent on an agent of another group: joins that group before it; on a group header or the strip under its last agent: joins at the end.
 * - agent on an agent of its own group: takes the target's place; ignored, with a hint, when the group is not ordered by hand.
 * - agent on the Ungrouped bucket: leaves its group.
 * - group header on group header: the groups reorder. Nothing else a group can be dropped on.
 */
export function resolveDrop(held: Held | undefined, target: DropTarget, ctx: DropContext): DropOutcome {
  if (held === undefined) {
    return NONE;
  }
  if (held.kind === 'group') {
    if (target.kind !== 'header' || target.groupId === null || target.groupId === held.id) {
      return NONE;
    }
    const ids = ctx.groups.map((group) => group.id);
    const next = moved(ids, held.id, target.groupId);
    return next.every((id, index) => id === ids[index]) ? NONE : { kind: 'reorder', ids: next };
  }
  const groupId = target.groupId;
  const members = ctx.membersOf(groupId);
  const sort = groupId === null ? 'manual' : (ctx.groups.find((group) => group.id === groupId)?.sort ?? 'manual');
  if (groupId === null) {
    return held.from === null ? NONE : { kind: 'move', sessionId: held.id, groupId: null, beforeId: null };
  }
  const sameGroup = held.from === groupId;
  if (sameGroup && sort !== 'manual') {
    return { kind: 'ignored', hint: `This group is ordered ${SORT_LABEL[sort].toLowerCase()}, so a drop inside it changes nothing. Set its order to Manual in the group settings (the folder button of its header) to arrange it by hand.` };
  }
  // Another group's order decides the place itself: the agent just joins.
  const placeable = sort === 'manual';
  if (target.kind === 'row') {
    if (target.id === held.id) {
      return NONE;
    }
    if (!sameGroup) {
      return { kind: 'move', sessionId: held.id, groupId, beforeId: placeable ? target.id : null };
    }
    const from = members.indexOf(held.id);
    const to = members.indexOf(target.id);
    if (from < 0 || to < 0) {
      return NONE;
    }
    return { kind: 'move', sessionId: held.id, groupId, beforeId: from < to ? (members[to + 1] ?? null) : target.id };
  }
  // The header or the strip: the end of the group (nothing to do when it already is the last one).
  if (sameGroup && members[members.length - 1] === held.id) {
    return NONE;
  }
  return { kind: 'move', sessionId: held.id, groupId, beforeId: null };
}
