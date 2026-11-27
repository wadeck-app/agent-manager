import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { RowButton, FOCUS_RING } from '../deps.js';
import { CappedRows } from './CappedRows.js';
import { SubagentProgress } from './SubagentProgress.js';
import { byAttention, countStatuses, describeCounts, isStale, type KeepAge, type SubagentItem } from './subagentModel.js';
import type { SubagentContentProps } from './subagentTypes.js';

/**
 * Content (a): the headline with a progress bar and the counts, what needs the eye first (running, then failed, then idle) as rows, and the finished ones
 * folded into one "N finished" line that opens on demand (capped, with "Show more"). A failed or idle one whose last activity is older than `keep` folds
 * there too ("N finished, M older failed or idle"; its icon and colour stay on its row), unless it is selected. The counts of the headline keep counting them.
 * With a status filter other than All the rows are simply that status, whatever their age.
 */
export function SubagentSummary({ items, all, filtered, keep, ...rest }: SubagentContentProps & { filtered: boolean; keep: KeepAge }) {
  const counts = countStatuses(all);
  const [open, setOpen] = useState(false);
  const sorted = byAttention(items);
  // A selected row stays where it is: its status line is where the click is answered.
  const folded = (item: SubagentItem): boolean => item.status === 'finished' || (item.dto.agentId !== rest.selectedId && isStale(item, rest.now, keep));
  const attention = filtered ? sorted : sorted.filter((item) => !folded(item));
  const finished = filtered ? [] : sorted.filter(folded);
  const older = finished.filter((item) => item.status !== 'finished').length;
  // The selected sub-agent is never hidden in a closed fold: its row is where the status of the click is written.
  const expanded = open || finished.some((item) => item.dto.agentId === rest.selectedId);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5 px-3 pt-1">
        <SubagentProgress counts={counts} />
        <p className="text-xs text-muted">{describeCounts(counts)}</p>
      </div>
      <ul className="flex flex-col gap-0.5 px-1">
        <CappedRows items={attention} {...rest} />
        {finished.length > 0 ? (
          <li>
            <RowButton type="button" aria-expanded={expanded} onClick={() => setOpen(!open)} className={`flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs font-medium text-muted hover:bg-muted-bg hover:text-content ${FOCUS_RING}`}>
              <Chevron aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0" />
              {foldLabel(finished.length - older, older)}
            </RowButton>
            {expanded ? (
              <ul className="flex flex-col gap-0.5">
                <CappedRows items={finished} {...rest} />
              </ul>
            ) : null}
          </li>
        ) : null}
        {attention.length === 0 && finished.length === 0 ? <li className="px-3 py-2 text-xs text-muted">No sub-agent with this status.</li> : null}
      </ul>
    </div>
  );
}

/** What the folded line holds, said as it is: "185 finished", "185 finished, 3 older failed or idle", or "3 older failed or idle". */
export function foldLabel(finished: number, older: number): string {
  const parts = [finished > 0 ? `${finished} finished` : '', older > 0 ? `${older} older failed or idle` : ''].filter((part) => part !== '');
  return parts.join(', ');
}
