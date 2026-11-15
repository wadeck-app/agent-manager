import { CardBody } from './CardBody.js';
import { RailItem } from './RailItem.js';
import { useId, useMemo } from 'react';
import { groupByHarness } from '../logic/harness.js';
import { agentId } from '../logic/states.js';
import { sortForState } from '../logic/grouping.js';
import { ATTENTION } from '../logic/states.js';
import { STATE_LOOK } from '../ui/stateLook.js';
import { tabbableId, useListKeys } from '../ui/hooks.js';
import { detailLine, type ListProps } from './common.js';
import { EmptyNote } from './EmptyNote.js';
import { ListScroll } from './ListScroll.js';
import { OptionShell } from './OptionShell.js';
import { RowMarks } from './RowMarks.js';
import { StateIconTip } from './StateIconTip.js';
import { TimeInState } from './TimeInState.js';
import type { AgentRow } from '../data/types.js';

/**
 * Rich entries like the vertical tabs of Warp or an Arc-like sidebar: title, last-activity subtitle, folder, status pill. Sub-variants: `cards` the cards
 * in urgency order; `rail` a narrow rail of monograms with a status icon that opens as a panel while the pointer or the focus is on it; `harness` the
 * cards grouped by Claude Code version, newest first.
 */
export function CardsList({ sessions, selectedId, onSelect, now, style }: ListProps) {
  const prefix = useId();
  const ordered = useMemo(() => [...sessions].sort((a, b) => ATTENTION[b.state] - ATTENTION[a.state] || sortForState(a.state)(a, b)), [sessions]);
  const harnessGroups = useMemo(() => (style === 'harness' ? groupByHarness(sessions) : []), [sessions, style]);
  const visible = style === 'harness' ? harnessGroups.flatMap((group) => group.sessions) : ordered;
  const ids = visible.map(agentId);
  const tabbable = tabbableId(ids, selectedId);
  const onKeyDown = useListKeys({ onSelect });

  if (sessions.length === 0) {
    return <EmptyNote title="No session to show" hint="Start Claude Code in a terminal and it appears here within 5 seconds." />;
  }
  const label = (session: AgentRow): string => `${session.displayName}, ${session.folder}, ${STATE_LOOK[session.state].label}`;
  const card = (session: AgentRow) => {
    const id = agentId(session);
    return (
      <OptionShell key={id} look="card" label={label(session)} session={session} selected={id === selectedId} tabbable={id === tabbable} onSelect={onSelect}>
        <CardBody session={session} now={now} />
      </OptionShell>
    );
  };

  if (style === 'rail') {
    return (
      <div className="group/rail absolute inset-y-0 left-0 z-20 flex w-14 flex-col overflow-hidden border-r border-border bg-surface transition-[width] duration-150 focus-within:w-80 focus-within:shadow-xl hover:w-80 hover:shadow-xl motion-reduce:transition-none">
        <ListScroll label="Agents" onKeyDown={onKeyDown}>
          {visible.map((session) => {
            const id = agentId(session);
            return (
              <OptionShell key={id} label={label(session)} session={session} selected={id === selectedId} tabbable={id === tabbable} onSelect={onSelect} className="min-h-am-row px-3 py-2.5">
                <RailItem session={session} now={now} />
              </OptionShell>
            );
          })}
        </ListScroll>
      </div>
    );
  }
  if (style === 'harness') {
    return (
      <ListScroll label="Agents by Claude Code version" onKeyDown={onKeyDown}>
        {harnessGroups.map((group, index) => (
          <div key={group.label} role="group" aria-labelledby={`${prefix}-${index}`}>
            <div id={`${prefix}-${index}`} className="sticky top-0 z-10 flex items-center gap-1.5 bg-surface px-3 pb-1 pt-3 text-xs font-medium text-muted">
              <span>{group.label}</span>
              <span className="tabular-nums">{group.sessions.length}</span>
            </div>
            {group.sessions.map(card)}
          </div>
        ))}
      </ListScroll>
    );
  }
  return (
    <ListScroll label="Agents" onKeyDown={onKeyDown}>
      {visible.map(card)}
    </ListScroll>
  );
}
