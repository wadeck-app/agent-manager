import type { AgentRow } from '../data/types.js';
import { moveStatusOf, switchViewOf } from '../logic/adoptSwitch.js';
import { useDaemonDown } from './DaemonState.js';
import { MoveBadgeView } from './MoveBadgeView.js';

/**
 * The Move line of the header for a session that has no Move button (a discovered one, a background one): its readiness badge and, in muted words, why it cannot
 * move. A session that has the button carries its badge next to it (SwitchAction), so this renders nothing for it.
 */
export function MoveStatusLine({ session }: { session: AgentRow }) {
  const daemonDown = useDaemonDown();
  if (switchViewOf(session) !== undefined) {
    return null;
  }
  const status = moveStatusOf(session, daemonDown);
  if (status.badge === undefined && status.unavailable === undefined) {
    return null;
  }
  return (
    <div data-move-status="" className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
      {status.badge === undefined ? null : <MoveBadgeView badge={status.badge} />}
      {status.unavailable === undefined ? null : <span className="text-xs text-muted">{status.unavailable}</span>}
    </div>
  );
}
