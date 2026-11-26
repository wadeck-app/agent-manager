import { Tooltip } from '@wadeck-app/dsl-ui';
import { useId, useMemo } from 'react';
import { flatten, groupSessions } from '../logic/grouping.js';
import { agentId } from '../logic/states.js';
import { groupText } from '../ui/stateLook.js';
import { GROUP_STATE_EDGE, GroupHeaderName, groupHeaderBox, groupHeaderCount } from '../ui/groupHeaderLook.js';
import { useUiVariant } from '../ui/UiVariants.js';
import { tabbableId, useListKeys } from '../ui/hooks.js';
import { FOCUS_RING } from '../ui/focusRing.js';
import { useCollapsed } from '../ui/useCollapsed.js';
import { ChevronDown, ChevronRight, Pin } from 'lucide-react';
import { detailLine, type ListProps } from './common.js';
import { EmptyNote } from './EmptyNote.js';
import { Highlight } from './Highlight.js';
import { GroupSelectBox } from './GroupSelectBox.js';
import { ListScroll } from './ListScroll.js';
import { OptionShell } from './OptionShell.js';
import { ProjectLabel } from './ProjectLabel.js';
import { RowMarks } from './RowMarks.js';
import { StateIconTip } from './StateIconTip.js';
import { TimeInState } from './TimeInState.js';
import { RowMenuButton } from './RowMenuButton.js';
import { useRowMenu } from './useRowMenu.js';

/**
 * Herdr-style groups: Pinned, Needs you, Done, Working, Idle (then Other and Ended when they exist), each with its count; a group without a row is not shown
 * (so a search hides the empty ones). Inside a group the order is decision 46. One look: two lines per row (folder and session name, then why it needs you or
 * what it did last); the option `preview` off drops the second line.
 */
/** Other and Ended are rarely what the user is after: they start collapsed until the user opens them (the choice is remembered per group). */
const COLLAPSED_BY_DEFAULT = { other: true, ended: true } as const;

export function GroupsList({ sessions, selectedId, onSelect, now, query, searching, options, marks, rowActions }: ListProps) {
  const prefix = useId();
  // The "..." menu of every row: flag, unread, pin, mark seen (no groups here: no Move).
  const rowMenu = useRowMenu({ marks, rowActions, onMove: undefined });
  const preview = options.groups.preview;
  const headerStyle = useUiVariant('groupHeader');
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
    <>
    {rowMenu.element}
    <ListScroll label="Agents" onKeyDown={onKeyDown}>
      {groups.map((group) => {
        const headingId = `${prefix}-${group.id}`;
        const collapsed = collapsedNow(group.id);
        const Chevron = collapsed ? ChevronRight : ChevronDown;
        return (
          <div key={group.id} role="group" aria-labelledby={headingId} className="pb-1">
            <div id={headingId} className={`sticky top-0 z-10 flex items-center bg-surface ${groupText(group.id)}`}>
              {/* Selection mode only: before the button (a box inside a button is invalid), at the x of the boxes of the rows (14 px). */}
              <GroupSelectBox ids={group.sessions.map(agentId)} name={group.label} className="pl-3.5" />
              <button type="button" aria-expanded={!collapsed} aria-label={`${group.label}, ${group.sessions.length}`} onClick={() => toggle(group.id)} className={`flex min-w-0 flex-1 items-center gap-1.5 text-left ${groupHeaderBox(headerStyle, GROUP_STATE_EDGE[group.id])} ${FOCUS_RING} focus-visible:ring-inset`}>
                <Chevron aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                {group.id === 'pinned' ? <Pin aria-hidden="true" className="h-3.5 w-3.5" /> : null}
                <GroupHeaderName variant={headerStyle} text={group.label} textClass={groupText(group.id)} />
                <span className={groupHeaderCount(headerStyle)}>{group.sessions.length}</span>
              </button>
            </div>
            {(collapsed ? [] : group.sessions).map((session) => {
              const id = agentId(session);
              const line = detailLine(session);
              return (
                <OptionShell key={id} session={session} selected={id === selectedId} tabbable={id === tabbable} onSelect={onSelect} multiline {...(rowMenu.available ? { onMenu: (anchor: { x: number; y: number }) => rowMenu.open(session, anchor) } : {})} className={preview ? 'min-h-am-row px-3.5 py-2' : 'min-h-am-hit px-3.5 py-2'}>
                  <div className="flex items-start gap-2.5">
                    <span className={preview ? 'mt-0.5' : ''}>
                      <StateIconTip session={session} />
                    </span>
                    <div className="min-w-0 flex-1">
                      {/* One line, never wrapping: name (takes the room), marks as icons, then the age and the "..." button in their fixed columns, so the ages and the buttons of all the rows are vertical axes. */}
                      <div className="flex items-center gap-2">
                        <ProjectLabel session={session} className="min-w-0 flex-1" terms={query.terms} line={line} />
                        <RowMarks session={session} iconOnly />
                        <TimeInState session={session} now={now} />
                        {rowMenu.available ? (
                          <span className="-my-1 -mr-2 shrink-0">
                            <RowMenuButton name={session.displayName} onMenu={(anchor) => rowMenu.open(session, anchor)} />
                          </span>
                        ) : null}
                      </div>
                      {preview && line !== '' ? (
                        <Tooltip content={line} describe={false}>
                          <p data-tip-fit="" className="truncate text-xs text-muted-tint">
                            <Highlight text={line} terms={query.terms} />
                          </p>
                        </Tooltip>
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
    </>
  );
}
