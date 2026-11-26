import { Tooltip } from '@wadeck-app/dsl-ui';
import type { AgentRow } from '../data/types.js';
import { describeTimeInState, timeInState } from '../logic/time.js';

/**
 * The fixed width of the age column of every row (32 px: "59m", "12d" at 11 or 12 px), right aligned: the ages of all the rows sit on one vertical axis, whatever
 * the marks (flag, pin, Needs you) in front of them. The column is drawn even when the registry gives no time, so the buttons after it never move.
 */
export const AGE_COLUMN = 'inline-block w-8 shrink-0 text-right';

/** Time in state ("3m") with the sentence in a tooltip, in the fixed age column. */
export function TimeInState({ session, now, className = 'text-xs' }: { session: AgentRow; now: number; className?: string }) {
  const text = timeInState(session.statusUpdatedAt, now);
  if (text === '') {
    return <span data-herdr-age-empty="" aria-hidden="true" className={AGE_COLUMN} />;
  }
  return (
    <Tooltip content={describeTimeInState(session.statusUpdatedAt, now)}>
      <span data-herdr-age="" className={`${AGE_COLUMN} tabular-nums text-muted-tint ${className}`}>{text}</span>
    </Tooltip>
  );
}
