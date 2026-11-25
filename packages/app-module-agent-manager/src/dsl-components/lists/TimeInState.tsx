import type { AgentRow } from '../data/types.js';
import { describeTimeInState, timeInState } from '../logic/time.js';
import { Tooltip } from '../ui/Tooltip.js';

/** Time in state ("3m") with the sentence in a tooltip. */
export function TimeInState({ session, now, className = 'text-xs' }: { session: AgentRow; now: number; className?: string }) {
  const text = timeInState(session.statusUpdatedAt, now);
  if (text === '') {
    return null;
  }
  return (
    <Tooltip content={describeTimeInState(session.statusUpdatedAt, now)}>
      <span data-herdr-age="" className={`shrink-0 tabular-nums text-muted-tint ${className}`}>{text}</span>
    </Tooltip>
  );
}
