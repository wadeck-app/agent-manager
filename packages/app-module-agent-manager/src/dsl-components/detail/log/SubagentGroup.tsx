import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { FOCUS_RING } from '../deps.js';
import { MoreButtons } from './MoreButtons.js';
import { SubagentProgress } from './SubagentProgress.js';
import { SubagentRow } from './SubagentRow.js';
import { STATUS_LOOK, type TypeGroup } from './subagentModel.js';
import type { SubagentContentProps } from './subagentTypes.js';
import { useCapped } from './useCapped.js';

const GROUP_PAGE = 20;

/** One agent type: a header with the counts and a status bar (opens on click), then its rows. */
export function SubagentGroup({ group, now, selectedId, locate, onSelect }: Omit<SubagentContentProps, 'items' | 'all'> & { group: TypeGroup }) {
  const attention = group.counts.active + group.counts.failed > 0;
  const holdsSelection = group.items.some((item) => item.dto.agentId === selectedId);
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  // Until the user chooses, a group opens when something in it needs the eye (running, failed) or holds the selection.
  const isOpen = open ?? (attention || holdsSelection);
  const Chevron = isOpen ? ChevronDown : ChevronRight;
  const capped = useCapped(group.items, GROUP_PAGE);
  return (
    <li className="rounded border border-border">
      <button type="button" aria-expanded={isOpen} onClick={() => setOpen(!isOpen)} className={`flex w-full flex-col gap-1.5 rounded px-2 py-1.5 text-left hover:bg-muted-bg ${FOCUS_RING}`}>
        <span className="flex w-full items-center gap-1.5 text-xs">
          <Chevron aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate font-medium text-content">{group.type}</span>
          {group.counts.active > 0 ? <span className={`shrink-0 tabular-nums ${STATUS_LOOK.active.text}`}>{group.counts.active} active</span> : null}
          {group.counts.failed > 0 ? <span className={`shrink-0 tabular-nums ${STATUS_LOOK.failed.text}`}>{group.counts.failed} failed</span> : null}
          <span className="shrink-0 tabular-nums text-muted">{group.items.length}</span>
        </span>
        <SubagentProgress counts={group.counts} slim />
      </button>
      {isOpen ? (
        <ul className="flex flex-col gap-0.5 border-t border-border p-1">
          {capped.shown.map((item) => (
            <SubagentRow key={item.dto.agentId} item={item} now={now} selected={selectedId === item.dto.agentId} locate={locate} onSelect={onSelect} />
          ))}
          <MoreButtons hidden={capped.hidden} step={GROUP_PAGE} onMore={capped.more} onAll={capped.all} />
        </ul>
      ) : null}
    </li>
  );
}
