import { GROUP_ORDER, STATE_LABEL, type AgentState, type GroupId, type SessionRowDto } from './states.js';

export interface AgentGroup {
  id: GroupId;
  label: string;
  sessions: SessionRowDto[];
}

/** Oldest status change first (the longest wait on top), a session without a time last; ties by pid so two polls never reorder rows. */
function oldestFirst(a: SessionRowDto, b: SessionRowDto): number {
  const left = a.statusUpdatedAt ?? Number.POSITIVE_INFINITY;
  const right = b.statusUpdatedAt ?? Number.POSITIVE_INFINITY;
  return left !== right ? (left < right ? -1 : 1) : a.pid - b.pid;
}

/** Most recent status change first, a session without a time last; ties by pid. */
function newestFirst(a: SessionRowDto, b: SessionRowDto): number {
  const left = a.statusUpdatedAt ?? Number.NEGATIVE_INFINITY;
  const right = b.statusUpdatedAt ?? Number.NEGATIVE_INFINITY;
  return left !== right ? (right > left ? 1 : -1) : a.pid - b.pid;
}

/** Decision 46: Needs you and Done oldest first, Working, Idle, Other and Ended most recent first. */
export function sortForState(state: AgentState): (a: SessionRowDto, b: SessionRowDto) => number {
  return state === 'needs-you' || state === 'done' ? oldestFirst : newestFirst;
}

/** Pinned in pin order (decision 46): the order the user pinned them in, first pinned on top; pid breaks a tie so two polls never reorder rows. */
function pinnedOrder(a: SessionRowDto, b: SessionRowDto): number {
  return a.pinOrder - b.pinOrder || a.pid - b.pid;
}

/** The non-empty groups in panel order. A pinned session is listed once, in Pinned, and keeps the icon of its state. */
export function groupSessions(sessions: readonly SessionRowDto[]): AgentGroup[] {
  const groups: AgentGroup[] = GROUP_ORDER.map((id) => ({
    id,
    label: STATE_LABEL[id],
    sessions: sessions
      .filter((session) => (id === 'pinned' ? session.pinned : !session.pinned && session.state === id))
      .sort(id === 'pinned' ? pinnedOrder : sortForState(id)),
  }));
  return groups.filter((group) => group.sessions.length > 0);
}

/** The sessions in the order the groups show them (what the keyboard walks through). */
export function flatten(groups: readonly AgentGroup[]): SessionRowDto[] {
  return groups.flatMap((group) => group.sessions);
}

/** Counts by state, pinned rows counted under their state (the header of a group counts what it shows, this counts what exists). */
export function countByState(sessions: readonly SessionRowDto[]): Record<AgentState, number> {
  const counts: Record<AgentState, number> = { 'needs-you': 0, done: 0, working: 0, idle: 0, other: 0, ended: 0 };
  for (const session of sessions) {
    counts[session.state] += 1;
  }
  return counts;
}
