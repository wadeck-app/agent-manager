import type { Session } from '@wadeck-app/agent-manager-core';
import type { AgentState } from '../commons/api.js';

/**
 * How long after the end of a turn an unseen idle session is "Done" rather than "Idle". The registry has no "turn finished" flag: a session that went
 * busy -> idle is seen in the watcher log (poc/results/registry-watch.ndjson) only as a status change, so "Done" is derived: idle, its status changed
 * less than this long ago, after the moment the module first saw it or the user marked it seen.
 */
export const DONE_WINDOW_MS = 30 * 60 * 1000;

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
