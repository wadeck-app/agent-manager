import { useEffect, useMemo, useRef } from 'react';
import { Tooltip, useUrlParam } from '@wadeck-app/dsl-ui';
import { firstNonEmptyTab, INBOX_TABS, nextNeedingYou, parseTab, tabCounts, tabSessions, type InboxTab } from '../logic/inbox.js';
import { HERDR_ROW_BOX_MULTILINE, herdrLook } from '../logic/herdrRow.js';
import { agentId } from '../logic/states.js';
import { tabbableId, useListKeys } from '../ui/hooks.js';
import { RowButton } from '../ui/RowButton.js';
import { detailLine, type ListProps } from './common.js';
import { EmptyNote } from './EmptyNote.js';
import { Highlight } from './Highlight.js';
import { ListScroll } from './ListScroll.js';
import { OptionShell } from './OptionShell.js';
import { ProjectLabel } from './ProjectLabel.js';
import { RowMarks } from './RowMarks.js';
import { StateIconTip } from './StateIconTip.js';
import { TimeInState } from './TimeInState.js';
import { RowMenuButton } from './RowMenuButton.js';
import { useRowMenu } from './useRowMenu.js';


// The four tabs share the strip (no sideways scroll that hides "All 38"): a tab shrinks under its content and, when its label and its count no longer fit side by side, the count goes under the label.
const TAB_STRIP = 'flex';
const TAB = 'flex min-w-0 flex-auto flex-wrap items-center justify-center gap-x-1 border-b-2 px-1 py-1.5 text-sm';

const EMPTY_TEXT: Record<InboxTab, { title: string; hint: string }> = {
  'needs-you': { title: 'Nothing needs you', hint: 'No agent is waiting for a permission or an answer.' },
  done: { title: 'Nothing new is done', hint: 'Finished work you have not looked at yet appears here.' },
  working: { title: 'No agent is working', hint: 'Agents running a turn appear here.' },
  all: { title: 'No session to show', hint: 'Start Claude Code in a terminal and it appears here within 5 seconds.' },
};

/**
 * Triage inbox (Linear Inbox, Superhuman split inbox and GitHub notifications are the inspiration): underlined tabs with counts (Needs you, Done, Working, All;
 * the tab is in the URL, `?tab=`), the row says why (the reason line: what the agent waits for). The counts are those of the rows the search lets through.
 * Option `autoNext` (off by default): when the agent you are on stops needing you (you replied), the next one that needs you opens by itself.
 */
export function InboxList({ sessions, selectedId, onSelect, now, query, searching, options, marks, rowActions }: ListProps) {
  const autoNext = options.inbox.autoNext;
  // The "..." menu of every row: flag, unread, pin, mark seen (no groups here: no Move).
  const rowMenu = useRowMenu({ marks, rowActions, onMove: undefined });
  const [tabParam, setTabParam] = useUrlParam('tab');
  const counts = useMemo(() => tabCounts(sessions), [sessions]);
  const tab = parseTab(tabParam) ?? firstNonEmptyTab(counts);
  const rows = useMemo(() => tabSessions(sessions, tab), [sessions, tab]);
  const ids = useMemo(() => rows.map(agentId), [rows]);
  const tabbable = tabbableId(ids, selectedId);
  const onKeyDown = useListKeys({ onSelect });

  // autoNext: remember whether the selected session needed you at the previous render; when it no longer does, open the next one that does.
  const previous = useRef<{ id: string; needed: boolean } | undefined>(undefined);
  useEffect(() => {
    if (!autoNext || selectedId === undefined) {
      previous.current = undefined;
      return;
    }
    const current = sessions.find((session) => agentId(session) === selectedId);
    const needs = current?.state === 'needs-you';
    if (previous.current?.id === selectedId && previous.current.needed && !needs) {
      const next = nextNeedingYou(tabSessions(sessions, 'needs-you'), selectedId);
      if (next !== undefined) {
        onSelect(agentId(next));
      }
    }
    previous.current = { id: selectedId, needed: needs };
  }, [autoNext, sessions, selectedId, onSelect]);

  const onTabKeys = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const index = INBOX_TABS.findIndex((entry) => entry.id === tab);
    const move = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (move !== 0) {
      event.preventDefault();
      const next = INBOX_TABS[(index + move + INBOX_TABS.length) % INBOX_TABS.length];
      if (next !== undefined) {
        setTabParam(next.id);
        requestAnimationFrame(() => document.getElementById(`inbox-tab-${next.id}`)?.focus());
      }
    }
  };

  return (
    <>
      {rowMenu.element}
      <div className="border-b border-border">
        <div role="tablist" aria-label="Inbox" onKeyDown={onTabKeys} className={TAB_STRIP}>
          {INBOX_TABS.map((entry) => {
            const active = entry.id === tab;
            return (
              <RowButton
                key={entry.id}
                role="tab"
                id={`inbox-tab-${entry.id}`}
                aria-selected={active}
                aria-controls="inbox-panel"
                tabIndex={active ? 0 : -1}
                onClick={() => setTabParam(entry.id)}
                className={`${TAB} ${active ? 'border-primary font-medium text-content' : 'border-transparent text-muted hover:text-content'}`}
              >
                {entry.label}
                <span className={`tabular-nums text-xs ${entry.id === 'needs-you' && counts['needs-you'] > 0 ? 'rounded-full bg-hue-red-bg px-1.5 text-hue-red' : counts[entry.id] === 0 ? 'text-muted opacity-60' : 'text-muted'}`}>{counts[entry.id]}</span>
              </RowButton>
            );
          })}
        </div>
      </div>
      <div id="inbox-panel" role="tabpanel" aria-labelledby={`inbox-tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
        {rows.length === 0 ? (
          searching ? (
            <EmptyNote title="No agent in this tab matches the search" hint="Other tabs may hold matches: their counts show it." />
          ) : (
            <EmptyNote {...EMPTY_TEXT[tab]} />
          )
        ) : (
          <ListScroll label={`Agents, ${INBOX_TABS.find((entry) => entry.id === tab)?.label ?? ''}`} onKeyDown={onKeyDown}>
            {rows.map((session) => {
              const id = agentId(session);
              const line = detailLine(session);
              return (
                <OptionShell key={id} session={session} selected={id === selectedId} tabbable={id === tabbable} onSelect={onSelect} multiline look={herdrLook(session.state, session.flagged, session.unread)} {...(rowMenu.available ? { onMenu: (anchor: { x: number; y: number }) => rowMenu.open(session, anchor) } : {})} className={`${HERDR_ROW_BOX_MULTILINE} my-0.5 min-h-am-row py-2`}>
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5">
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
                      {line !== '' ? (
                        <Tooltip content={line} describe={false}>
                          <p data-tip-fit="" className={`truncate text-xs ${session.state === 'needs-you' ? 'text-hue-red' : 'text-muted-tint'}`}>
                            <Highlight text={line} terms={query.terms} />
                          </p>
                        </Tooltip>
                      ) : null}
                    </div>
                  </div>
                </OptionShell>
              );
            })}
          </ListScroll>
        )}
      </div>
    </>
  );
}
