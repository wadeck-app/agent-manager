import { useDateFormat } from '@wadeck-app/dsl-ui';
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react';
import { RowButton, FOCUS_RING, Tooltip } from '../deps.js';
import { SubagentTip } from './SubagentTip.js';
import { MoreButtons } from './MoreButtons.js';
import { buildTimeline, elapsedMs, formatElapsed, STATUS_LOOK } from './subagentModel.js';
import type { SubagentContentProps, TimelineOrder } from './subagentTypes.js';
import { useCapped } from './useCapped.js';

const ROWS = 150;

/**
 * The timeline: one bar per sub-agent on a common time axis (start to end, "now" for an active one): what ran at the same time and for how long, at a glance.
 * The bars are drawn with the status colour and the row carries the status icon, so colour is not the only signal. Most recent on top by default, by the same key as the Summary: the last activity (end time, else last write, else start).
 * The axis anchor ("10:12 ... now") sits at the end the most recent sub-agent is at, and is a button that reverses the order: with the most recent on top
 * it is above the rows, with the oldest on top it is below them. It sticks to the edge of the panel at that end, so it stays in reach in a long list. The earliest clock is at its left, "now" (or the last clock) at its right.
 */
export function SubagentTimeline({ items, now, selectedId, onSelect, order, onOrder }: SubagentContentProps & { order: TimelineOrder; onOrder: (next: TimelineOrder) => void }) {
  const formatter = useDateFormat();
  // "10:42" in the locale of the app, no seconds.
  const clock = (at: number): string => formatter.intl({ hour: '2-digit', minute: '2-digit' }).format(at);
  const timeline = buildTimeline(items, now, order);
  const capped = useCapped(timeline.bars, ROWS);
  if (timeline.bars.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted">{items.length === 0 ? 'No sub-agent with this status.' : 'No start time is known for these sub-agents.'}</p>;
  }
  const recentFirst = order === 'recent';
  const Sort = recentFirst ? ArrowDownWideNarrow : ArrowUpNarrowWide;
  const label = `Sort order: ${recentFirst ? 'most recent first' : 'oldest first'}, activate to reverse`;
  const anchor = (
    <div className={`sticky z-10 flex items-center justify-between gap-2 bg-surface px-1 py-1 text-xs text-muted ${recentFirst ? 'top-0' : 'bottom-0'}`}>
      <span className="tabular-nums">{clock(timeline.from)}</span>
      <Tooltip content={`${recentFirst ? 'Most recent first' : 'Oldest first'}, by last activity (end time, else last write, else start), like the Summary. Click to reverse the order.`} side="left">
        <RowButton
          type="button"
          aria-label={label}
          onClick={() => onOrder(recentFirst ? 'oldest' : 'recent')}
          className={`inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 tabular-nums text-content hover:bg-muted-bg ${FOCUS_RING}`}
        >
          {items.some((item) => item.status === 'active') ? 'now' : clock(timeline.to)}
          <Sort aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-muted" />
        </RowButton>
      </Tooltip>
    </div>
  );
  return (
    <div className="flex flex-col gap-1 px-2 pb-2">
      <p className="px-1 text-xs text-muted">
        {timeline.bars.length} sub-agents, up to {timeline.peak} at once
      </p>
      {recentFirst ? anchor : null}
      <ul className="flex flex-col gap-0.5">
        {capped.shown.map(({ item, left, width }) => {
          const look = STATUS_LOOK[item.status];
          const Icon = look.icon;
          const elapsed = elapsedMs(item, now);
          const selected = selectedId === item.dto.agentId;
          return (
            <li key={item.dto.agentId}>
              <SubagentTip item={item} now={now}>
              <RowButton
                type="button"
                data-tip-fill=""
                aria-pressed={selected}
                onClick={() => onSelect(item.dto.agentId)}
                className={`flex w-full items-center gap-2 rounded border-l-2 py-1 pl-1.5 pr-1 text-left text-xs ${selected ? 'border-primary bg-primary-light' : 'border-transparent hover:bg-muted-bg'} ${FOCUS_RING}`}
              >
                <Icon aria-hidden="true" className={`h-am-icon w-am-icon shrink-0 ${look.text} ${look.iconClass}`} />
                <span className="w-[42%] min-w-0 shrink-0 truncate text-sm text-content">{item.title}</span>
                <span className="relative h-3.5 min-w-0 flex-1 rounded bg-muted-bg">
                  <span className={`absolute inset-y-0 rounded ${look.bar}`} style={{ left: `${left}%`, width: `${width}%` }} />
                </span>
                <span className="w-16 shrink-0 text-right tabular-nums text-muted">{elapsed === undefined ? '' : formatElapsed(elapsed)}</span>
                <span className="sr-only">{look.label}</span>
              </RowButton>
              </SubagentTip>
            </li>
          );
        })}
        <MoreButtons hidden={capped.hidden} step={ROWS} onMore={capped.more} onAll={capped.all} />
      </ul>
      {recentFirst ? null : anchor}
      {timeline.undated > 0 ? <p className="px-1 text-xs text-muted">{timeline.undated} without a known start are not drawn.</p> : null}
    </div>
  );
}
