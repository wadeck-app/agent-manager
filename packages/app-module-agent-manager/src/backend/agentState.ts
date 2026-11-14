import type { Session } from '@wadeck-app/agent-manager-core';
import type { UserState } from './userState.js';

/**
 * How long after the end of a turn an unseen idle session is "Done" rather than "Idle". The registry has no "turn finished" flag: a session that went
 * busy -> idle is seen in the watcher log (poc/results/registry-watch.ndjson) only as a status change, so "Done" is derived: idle, its status changed
 * less than this long ago, after the moment the module first saw it or the user marked it seen.
 */
export const DONE_WINDOW_MS = 30 * 60 * 1000;

/** The state of a session as the herdr layout shows it, without the pin (a pinned session keeps its state and is listed in Pinned as well). */
export type AgentState = 'needs-you' | 'done' | 'working' | 'idle' | 'other' | 'ended';

/** The groups of the panel, in display order. */
export type GroupId = 'pinned' | AgentState;

export const GROUP_ORDER: readonly GroupId[] = ['pinned', 'needs-you', 'done', 'working', 'idle', 'other', 'ended'];

export const GROUP_LABEL: Record<GroupId, string> = {
  pinned: 'Pinned',
  'needs-you': 'Needs you',
  done: 'Done',
  working: 'Working',
  idle: 'Idle',
  other: 'Other',
  ended: 'Ended',
};

/**
 * waiting -> needs-you (whatever it waits for); busy and shell -> working; idle -> done when its status changed after the last time the user saw it (the baseline written when the module first saw it, or Mark seen) and within the window, else idle.
 * A dead session (its process is gone) is `ended`, whatever its last registry status says. Any other status is `other`: shown in its own group
 * with its raw status, never dropped.
 */
export function stateOf(session: Session, seen: Readonly<Record<string, number>>, now: number): AgentState {
  if (!session.alive) {
    return 'ended';
  }
  if (session.status === 'waiting') {
    return 'needs-you';
  }
  if (session.status === 'busy' || session.status === 'shell') {
    return 'working';
  }
  if (session.status !== 'idle') {
    return 'other';
  }
  const since = session.statusUpdatedAt;
  if (since === undefined || now - since > DONE_WINDOW_MS) {
    return 'idle';
  }
  // No record yet: the module has not seen this session before (the baseline is written by the next poll), it was not finished "while you were away".
  const seenAt = seen[session.sessionId.toLowerCase()];
  return seenAt !== undefined && since > seenAt ? 'done' : 'idle';
}

export interface AgentEntry {
  session: Session;
  state: AgentState;
  pinned: boolean;
}

export interface AgentGroup {
  id: GroupId;
  label: string;
  entries: AgentEntry[];
}

/** Most recent state change first; a session without a timestamp goes last; ties keep the pid order (stable, no flicker between two polls). */
function byRecentChange(a: AgentEntry, b: AgentEntry): number {
  const left = a.session.statusUpdatedAt ?? Number.NEGATIVE_INFINITY;
  const right = b.session.statusUpdatedAt ?? Number.NEGATIVE_INFINITY;
  if (left !== right) {
    return right > left ? 1 : -1;
  }
  return a.session.pid - b.session.pid;
}

/** The non-empty groups in panel order. A pinned session is listed once, in Pinned, and keeps the icon of its state (as in the herdr panel). */
export function buildGroups(sessions: readonly Session[], user: UserState, now: number): AgentGroup[] {
  const pinned = new Set(user.pinned);
  const entries: AgentEntry[] = sessions.map((session) => ({ session, state: stateOf(session, user.seen, now), pinned: pinned.has(session.sessionId.toLowerCase()) }));
  const groups: AgentGroup[] = GROUP_ORDER.map((id) => ({
    id,
    label: GROUP_LABEL[id],
    entries: entries.filter((entry) => (id === 'pinned' ? entry.pinned : !entry.pinned && entry.state === id)).sort(byRecentChange),
  }));
  return groups.filter((group) => group.entries.length > 0);
}
