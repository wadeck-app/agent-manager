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
import { Highlight } from './Highlight.js';
import { ListScroll } from './ListScroll.js';
import { OptionShell } from './OptionShell.js';
import { ProjectLabel } from './ProjectLabel.js';
import { RowMarks } from './RowMarks.js';
import { StateIconTip } from './StateIconTip.js';
import { TimeInState } from './TimeInState.js';

/**
 * Herdr-style groups: Pinned, Needs you, Done, Working, Idle (then Other and Ended when they exist), each with its count; a group without a row is not shown
 * (so a search hides the empty ones). Inside a group the order is decision 46. One look: two lines per row (folder and session name, then why it needs you or
 * what it did last); the option `preview` off drops the second line.
 */
/** Other and Ended are rarely what the user is after: they start collapsed until the user opens them (the choice is remembered per group). */
const COLLAPSED_BY_DEFAULT = { other: true, ended: true } as const;

export function GroupsList({ sessions, selectedId, onSelect, now, query, searching, options }: ListProps) {
  const prefix = useId();
  const preview = options.groups.preview;
  const groups = useMemo(() => groupSessions(sessions), [sessions]);
  const { isCollapsed, toggle } = useCollapsed(COLLAPSED_BY_DEFAULT);
  // While searching every group is open: a match inside a collapsed group would be invisible.
  const collapsedNow = (id: string): boolean => !searching && isCollapsed(id);
  const ids = useMemo(() => flatten(groups.filter((group) => !(!searching && isCollapsed(group.id)))).map(agentId), [groups, isCollapsed, searching]);
  const tabbable = tabbableId(ids, selectedId);
  const onKeyDown = useListKeys({ onSelect });

  if (groups.length === 0) {
    return <EmptyNote title="No session to show" hint="Start Claude Code in a terminal and it appears here within 5 seconds." />;
  }
  return (
    <ListScroll label="Agents" onKeyDown={onKeyDown}>
      {groups.map((group) => {
        const headingId = `${prefix}-${group.id}`;
        const collapsed = collapsedNow(group.id);
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
                <OptionShell key={id} session={session} selected={id === selectedId} tabbable={id === tabbable} onSelect={onSelect} className={preview ? 'min-h-am-row px-3.5 py-2' : 'min-h-am-hit px-3.5 py-2'}>
                  <div className="flex items-start gap-2.5">
                    <span className={preview ? 'mt-0.5' : ''}>
                      <StateIconTip session={session} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <ProjectLabel session={session} className="flex-1" terms={query.terms} />
                        <RowMarks session={session} />
                        <TimeInState session={session} now={now} />
                      </div>
                      {preview && line !== '' ? (
                        <p className="truncate text-xs text-muted" title={line}>
                          <Highlight text={line} terms={query.terms} />
                        </p>
                      ) : null}
                    </div>
                  </div>
                </OptionShell>
              );
            })}
          </div>
        );
      })}
    </ListScroll>
  );
}
