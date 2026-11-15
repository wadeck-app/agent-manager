import type { AgentState, SessionRowDto } from '../shared.js';

export type { AgentState, SessionRowDto };

/** The groups of the panel, in display order (decision 44). Pinned is an overlay: a pinned row leaves its state group and keeps its state icon. */
export type GroupId = 'pinned' | AgentState;

export const GROUP_ORDER: readonly GroupId[] = ['pinned', 'needs-you', 'done', 'working', 'idle', 'other', 'ended'];

export const STATE_LABEL: Record<GroupId, string> = {
  pinned: 'Pinned',
  'needs-you': 'Needs you',
  done: 'Done',
  working: 'Working',
  idle: 'Idle',
  other: 'Other',
  ended: 'Ended',
};

/** What a state means, for the tooltip of its icon and the legend. */
export const STATE_MEANING: Record<AgentState, string> = {
  'needs-you': 'Waiting for you: a permission prompt or a question',
  done: 'Finished since you last looked',
  working: 'Running a turn',
  idle: 'Finished and already seen',
  other: 'A registry status this page does not know',
  ended: 'The process is gone, only the registry file is left',
};

/**
 * How urgent a state is, higher first: the roll-up of a folder takes the highest of its children (herdr: "blocked wins over working").
 * Our own order beyond that: an unknown status is surfaced before Done and Working so it is never hidden behind a quiet folder.
 */
export const ATTENTION: Record<AgentState, number> = { 'needs-you': 6, other: 5, done: 4, working: 3, idle: 2, ended: 1 };

/** The states that wait for the user. */
export const NEEDS_ATTENTION: readonly AgentState[] = ['needs-you', 'done'];

/** Session id used as an identity everywhere (the routes are case-insensitive, the URL keeps one spelling). */
export function agentId(session: Pick<SessionRowDto, 'sessionId'>): string {
  return session.sessionId.toLowerCase();
}

/** The worst (most urgent) state of a list, undefined for an empty list. */
export function worstState(states: readonly AgentState[]): AgentState | undefined {
  let worst: AgentState | undefined;
  for (const state of states) {
    if (worst === undefined || ATTENTION[state] > ATTENTION[worst]) {
      worst = state;
    }
  }
  return worst;
}
