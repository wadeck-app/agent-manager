import { useDateFormat } from '@wadeck-app/dsl-ui';
import { relativeTime } from './format.js';
import { LOG_META } from './sizes.js';

/** The time of a row: relative text with the exact time as native title. The compact style shows the clock time and the relative one in the title. */
export function TimeLabel({ timestamp, now, clock = false }: { timestamp: number | undefined; now: number; clock?: boolean }) {
  if (timestamp === undefined) {
    return null;
  }
  const formatter = useDateFormat();
  const relative = relativeTime(timestamp, now);
  const exact = formatter.exact(timestamp);
  return (
    <time dateTime={new Date(timestamp).toISOString()} title={clock ? `${exact} (${relative})` : exact} className={`${LOG_META} tabular-nums text-muted`}>
      {clock ? formatter.intl({ hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(timestamp) : relative}
    </time>
  );
}
