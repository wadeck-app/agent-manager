import { useState } from 'react';
import { FOCUS_RING, useNow } from '../deps.js';
import { SubagentModeSwitch } from './SubagentModeSwitch.js';
import { SubagentSummary } from './SubagentSummary.js';
import { SubagentTimeline } from './SubagentTimeline.js';
import { countStatuses, FILTER_LABEL, filterItems, STATUS_FILTERS, type StatusFilter, type SubagentItem } from './subagentModel.js';
import type { SubagentsMode, TimelineOrder } from './subagentTypes.js';
import type { LocatePhase } from './useLocateCall.js';

export interface SubagentsViewProps {
  items: SubagentItem[];
  mode: SubagentsMode;
  onMode: (next: SubagentsMode) => void;
  order: TimelineOrder;
  onOrder: (next: TimelineOrder) => void;
  selectedId: string | undefined;
  phase: LocatePhase;
  onSelect: (agentId: string) => void;
  /** Problems reading the sub-agents folder (shown, never hidden). */
  note: string;
}

/** The body of the panel: the mode switch, the status filter, and the content of the chosen mode (a summary, or a timeline). */
export function SubagentsView({ items, mode, onMode, order, onOrder, selectedId, phase, onSelect, note }: SubagentsViewProps) {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const counts = countStatuses(items);
  // The elapsed time of an active sub-agent ticks every second; with none active a minute-level refresh is enough.
  const now = useNow(counts.active > 0 ? 1000 : 15_000);
  const filtered = filterItems(items, filter);
  const props = { items: filtered, all: items, now, selectedId, locate: phase, onSelect };
  const countOf = (value: StatusFilter): number => (value === 'all' ? counts.total : counts[value]);
  return (
    <div className="flex flex-col gap-2 py-2">
      {note !== '' ? <p className="px-3 text-xs text-warning-text">{note}</p> : null}
      <div className="px-3">
        <SubagentModeSwitch mode={mode} onMode={onMode} />
      </div>
      <div role="group" aria-label="Show sub-agents" className="flex flex-wrap gap-1 px-3">
        {STATUS_FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${filter === value ? 'border-primary bg-primary-light text-content' : 'border-border text-muted hover:bg-muted-bg hover:text-content'} ${FOCUS_RING}`}
          >
            {FILTER_LABEL[value]} <span className="tabular-nums">{countOf(value)}</span>
          </button>
        ))}
      </div>
      {mode === 'summary' ? <SubagentSummary {...props} filtered={filter !== 'all'} /> : <SubagentTimeline {...props} order={order} onOrder={onOrder} />}
    </div>
  );
}
