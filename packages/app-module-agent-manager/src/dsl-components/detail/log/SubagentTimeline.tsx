import { useDateFormat } from '@wadeck-app/dsl-ui';
import { FOCUS_RING } from '../deps.js';
import { MoreButtons } from './MoreButtons.js';
import { buildTimeline, elapsedMs, formatElapsed, STATUS_LOOK } from './subagentModel.js';
import type { SubagentContentProps } from './subagentTypes.js';
import { useCapped } from './useCapped.js';

const ROWS = 150;

/**
 * Content (c): one bar per sub-agent on a common time axis (start to end, "now" for a running one): what ran at the same time and for how long, at a glance.
 * The bars are drawn with the status colour and the row carries the status icon, so colour is not the only signal. The list is sorted by start.
 */
export function SubagentTimeline({ items, now, selectedId, onSelect }: SubagentContentProps) {
  const formatter = useDateFormat();
  // "10:42" in the locale of the app, no seconds.
  const clock = (at: number): string => formatter.intl({ hour: '2-digit', minute: '2-digit' }).format(at);
  const timeline = buildTimeline(items, now);
  const capped = useCapped(timeline.bars, ROWS);
  if (timeline.bars.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted">{items.length === 0 ? 'No sub-agent with this status.' : 'No start time is known for these sub-agents.'}</p>;
  }
  return (
    <div className="flex flex-col gap-1 px-2 pb-2">
      <p className="flex items-center justify-between gap-2 px-1 text-xs text-muted">
        <span className="tabular-nums">{clock(timeline.from)}</span>
        <span>
          {timeline.bars.length} sub-agents, up to {timeline.peak} at once
        </span>
        <span className="tabular-nums">{items.some((item) => item.status === 'active') ? 'now' : clock(timeline.to)}</span>
      </p>
      <ul className="flex flex-col gap-0.5">
        {capped.shown.map(({ item, left, width }) => {
          const look = STATUS_LOOK[item.status];
          const Icon = look.icon;
          const elapsed = elapsedMs(item, now);
          const selected = selectedId === item.dto.agentId;
          return (
            <li key={item.dto.agentId}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(item.dto.agentId)}
                title={`${item.title} (${look.label}${elapsed === undefined ? '' : `, ${formatElapsed(elapsed)}`})`}
                className={`flex w-full items-center gap-2 rounded border-l-2 py-1 pl-1.5 pr-1 text-left text-xs ${selected ? 'border-primary bg-primary-light' : 'border-transparent hover:bg-muted-bg'} ${FOCUS_RING}`}
              >
                <Icon aria-hidden="true" className={`h-am-icon w-am-icon shrink-0 ${look.text} ${look.iconClass}`} />
                <span className="w-[42%] min-w-0 shrink-0 truncate text-sm text-content">{item.title}</span>
                <span className="relative h-3.5 min-w-0 flex-1 rounded bg-muted-bg">
                  <span className={`absolute inset-y-0 rounded ${look.bar}`} style={{ left: `${left}%`, width: `${width}%` }} />
                </span>
                <span className="w-16 shrink-0 text-right tabular-nums text-muted">{elapsed === undefined ? '' : formatElapsed(elapsed)}</span>
                <span className="sr-only">{look.label}</span>
              </button>
            </li>
          );
        })}
        <MoreButtons hidden={capped.hidden} step={ROWS} onMore={capped.more} onAll={capped.all} />
      </ul>
      {timeline.undated > 0 ? <p className="px-1 text-xs text-muted">{timeline.undated} without a known start are not drawn.</p> : null}
    </div>
  );
}
