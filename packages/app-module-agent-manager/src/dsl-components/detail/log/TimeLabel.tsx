import { Tooltip, useDateFormat } from '@wadeck-app/dsl-ui';
import { relativeTime } from './format.js';
import { LOG_META } from './sizes.js';

/** The time of a row: relative text with the exact time in its tooltip. The tooltip never holds the relative text: it ticks, and a card whose text changes while it is read is a flicker. */
export function TimeLabel({ timestamp, now }: { timestamp: number | undefined; now: number }) {
  if (timestamp === undefined) {
    return null;
  }
  const formatter = useDateFormat();
  const exact = formatter.exact(timestamp);
  return (
    <Tooltip content={exact}>
      <time dateTime={new Date(timestamp).toISOString()} className={`shrink-0 whitespace-nowrap ${LOG_META} tabular-nums text-muted`}>
        {relativeTime(timestamp, now)}
      </time>
    </Tooltip>
  );
}
