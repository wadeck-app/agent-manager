import { Tooltip, useDateFormat } from '@wadeck-app/dsl-ui';
import { relativeTime } from './format.js';
import { LOG_META } from './sizes.js';

/** The time of a row: relative text (the clock time in the compact style) with the exact time in its tooltip. The tooltip never holds the relative text: it ticks, and a card whose text changes while it is read is a flicker. */
export function TimeLabel({ timestamp, now, clock = false }: { timestamp: number | undefined; now: number; clock?: boolean }) {
  if (timestamp === undefined) {
    return null;
  }
  const formatter = useDateFormat();
  const relative = relativeTime(timestamp, now);
  const exact = formatter.exact(timestamp);
  return (
    <Tooltip content={exact}>
      <time dateTime={new Date(timestamp).toISOString()} className={`shrink-0 whitespace-nowrap ${LOG_META} tabular-nums text-muted`}>
        {clock ? formatter.intl({ hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(timestamp) : relative}
      </time>
    </Tooltip>
  );
}
