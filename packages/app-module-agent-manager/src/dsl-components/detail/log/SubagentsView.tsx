import { CompactSelect } from '@wadeck-app/dsl-ui';
import { useState } from 'react';
import { useNow } from '../deps.js';
import { SubagentModeSwitch } from './SubagentModeSwitch.js';
import { SubagentSummary } from './SubagentSummary.js';
import { SubagentTimeline } from './SubagentTimeline.js';
import { countStatuses, FILTER_LABEL, filterItems, KEEP_AGES, KEEP_LABEL, STATUS_FILTERS, type KeepAge, type StatusFilter, type SubagentItem } from './subagentModel.js';
import type { SubagentsMode, TimelineOrder } from './subagentTypes.js';
import type { LocatePhase } from './useLocateCall.js';

export interface SubagentsViewProps {
  items: SubagentItem[];
  mode: SubagentsMode;
  onMode: (next: SubagentsMode) => void;
  order: TimelineOrder;
  onOrder: (next: TimelineOrder) => void;
  /** How long a failed or idle sub-agent stays among the rows that need the eye (Summary). */
  keep: KeepAge;
  onKeep: (next: KeepAge) => void;
  selectedId: string | undefined;
  phase: LocatePhase;
  onSelect: (agentId: string) => void;
  /** Problems reading the sub-agents folder (shown, never hidden). */
  note: string;
}

/** The body of the panel: the mode switch, the status filter, and the content of the chosen mode (a summary, or a timeline). */
export function SubagentsView({ items, mode, onMode, order, onOrder, keep, onKeep, selectedId, phase, onSelect, note }: SubagentsViewProps) {
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
      {/* A select, not four chips: the chips wrapped on two rows in the narrow rail, the select is one row at every width. */}
      <div className="px-3">
        <CompactSelect ariaLabel="Show sub-agents" size="sm" value={filter} onChange={(value) => setFilter(value as StatusFilter)} options={STATUS_FILTERS.map((value) => ({ value, label: `${FILTER_LABEL[value]} ${countOf(value)}` }))} />
      </div>
      {mode === 'summary' ? (
        <div className="flex items-center justify-between gap-2 px-3">
          <span className="text-xs text-muted">Keep failed and idle</span>
          <CompactSelect ariaLabel="Keep failed and idle sub-agents in view for" size="sm" value={keep} onChange={(value) => onKeep(value as KeepAge)} options={KEEP_AGES.map((age) => ({ value: age, label: KEEP_LABEL[age] }))} />
        </div>
      ) : null}
      {mode === 'summary' ? <SubagentSummary {...props} filtered={filter !== 'all'} keep={keep} /> : <SubagentTimeline {...props} order={order} onOrder={onOrder} />}
    </div>
  );
}
