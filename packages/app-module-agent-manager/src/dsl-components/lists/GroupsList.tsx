import { useId, useMemo } from 'react';
import { flatten, groupSessions } from '../logic/grouping.js';
import { agentId } from '../logic/states.js';
import { groupText } from '../ui/stateLook.js';
import { tabbableId, useListKeys } from '../ui/hooks.js';
import { FOCUS_RING } from '../ui/IconButton.js';
import { useCollapsed } from '../ui/useCollapsed.js';
import { ChevronDown, ChevronRight, Pin } from 'lucide-react';
import { detailLine, type ListProps } from './common.js';
import { EmptyNote } from './EmptyNote.js';
import { ListScroll } from './ListScroll.js';
import { OptionShell } from './OptionShell.js';
import { ProjectLabel } from './ProjectLabel.js';
import { RowMarks } from './RowMarks.js';
import { StateIconTip } from './StateIconTip.js';
import { TimeInState } from './TimeInState.js';

/**
 * Herdr-style groups: Pinned, Needs you, Done, Working, Idle (then Other and Ended when they exist), each with its count. Inside a group the order is
 * decision 46. Sub-variants: `comfortable` two lines (project and time, then session name and reason), `compact` one line like the herdr panel,
 * `preview` one line plus the last activity of the agent.
 */
/** Other and Ended are rarely what the user is after: they start collapsed until the user opens them (the choice is remembered per group). */
const COLLAPSED_BY_DEFAULT = { other: true, ended: true } as const;

export function GroupsList({ sessions, selectedId, onSelect, now, style }: ListProps) {
  const prefix = useId();
  const groups = useMemo(() => groupSessions(sessions), [sessions]);
  const { isCollapsed, toggle } = useCollapsed(COLLAPSED_BY_DEFAULT);
  const ids = useMemo(() => flatten(groups.filter((group) => !isCollapsed(group.id))).map(agentId), [groups, isCollapsed]);
  const tabbable = tabbableId(ids, selectedId);
  const onKeyDown = useListKeys({ onSelect });

  if (groups.length === 0) {
    return <EmptyNote title="No session to show" hint="Start Claude Code in a terminal and it appears here within 5 seconds." />;
  }
  return (
    <ListScroll label="Agents" onKeyDown={onKeyDown}>
      {groups.map((group) => {
        const headingId = `${prefix}-${group.id}`;
        const collapsed = isCollapsed(group.id);
        const Chevron = collapsed ? ChevronRight : ChevronDown;
        return (
          <div key={group.id} role="group" aria-labelledby={headingId} className="pb-1">
            <div id={headingId} className={`sticky top-0 z-10 bg-surface text-xs font-medium ${groupText(group.id)}`}>
              <button type="button" aria-expanded={!collapsed} aria-label={`${group.label}, ${group.sessions.length}`} onClick={() => toggle(group.id)} className={`flex w-full items-center gap-1.5 px-3.5 pb-1.5 pt-3.5 text-left ${FOCUS_RING} focus-visible:ring-inset`}>
                <Chevron aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0" />
                {group.id === 'pinned' ? <Pin aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" /> : null}
                <span>{group.label}</span>
                <span className="tabular-nums">{group.sessions.length}</span>
              </button>
            </div>
            {(collapsed ? [] : group.sessions).map((session) => {
              const id = agentId(session);
              const line = detailLine(session);
              return (
                <OptionShell key={id} session={session} selected={id === selectedId} tabbable={id === tabbable} onSelect={onSelect} className={style === 'comfortable' ? 'min-h-am-row px-3.5 py-2' : 'min-h-am-hit px-3.5 py-2'}>
                  {style === 'comfortable' ? (
                    <div className="flex items-start gap-2.5">
                      <span className="mt-0.5">
                        <StateIconTip session={session} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <ProjectLabel session={session} className="flex-1" />
                          <RowMarks session={session} />
                          <TimeInState session={session} now={now} />
                        </div>
                        {line !== '' ? (
                          <p className="truncate text-xs text-muted" title={line}>
                            {line}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <ProjectLabel session={session} className="flex-1" />
                        <RowMarks session={session} />
                        <TimeInState session={session} now={now} />
                        <StateIconTip session={session} />
                      </div>
                      {style === 'preview' && line !== '' ? (
                        <p className="truncate pr-6 text-xs text-muted" title={line}>
                          {line}
                        </p>
                      ) : null}
                    </>
                  )}
                </OptionShell>
              );
            })}
          </div>
        );
      })}
    </ListScroll>
  );
}
