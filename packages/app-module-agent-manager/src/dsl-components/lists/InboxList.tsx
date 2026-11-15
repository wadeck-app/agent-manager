import { useEffect, useMemo, useRef } from 'react';
import { useUrlParam } from '@wadeck-app/dsl-ui';
import { firstNonEmptyTab, INBOX_TABS, nextNeedingYou, parseTab, tabCounts, tabSessions, type InboxTab } from '../logic/inbox.js';
import { agentId } from '../logic/states.js';
import { FOCUS_RING } from '../ui/IconButton.js';
import { tabbableId, useListKeys } from '../ui/hooks.js';
import { detailLine, type ListProps } from './common.js';
import { EmptyNote } from './EmptyNote.js';
import { Highlight } from './Highlight.js';
import { ListScroll } from './ListScroll.js';
import { OptionShell } from './OptionShell.js';
import { ProjectLabel } from './ProjectLabel.js';
import { RowMarks } from './RowMarks.js';
import { StateIconTip } from './StateIconTip.js';
import { TimeInState } from './TimeInState.js';

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
export function InboxList({ sessions, selectedId, onSelect, now, query, searching, options }: ListProps) {
  const autoNext = options.inbox.autoNext;
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
      <div className="border-b border-border">
        <div role="tablist" aria-label="Inbox" onKeyDown={onTabKeys} className="flex overflow-x-auto">
          {INBOX_TABS.map((entry) => {
            const active = entry.id === tab;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={`inbox-tab-${entry.id}`}
                aria-selected={active}
                aria-controls="inbox-panel"
                tabIndex={active ? 0 : -1}
                onClick={() => setTabParam(entry.id)}
                className={`flex shrink-0 items-center gap-1 whitespace-nowrap border-b-2 px-2 py-2 text-sm ${active ? 'border-primary font-medium text-content' : 'border-transparent text-muted hover:text-content'} ${FOCUS_RING}`}
              >
                {entry.label}
                <span className={`tabular-nums text-xs ${entry.id === 'needs-you' && counts['needs-you'] > 0 ? 'rounded-full bg-hue-red-bg px-1.5 text-hue-red' : counts[entry.id] === 0 ? 'text-muted opacity-60' : 'text-muted'}`}>{counts[entry.id]}</span>
              </button>
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
                <OptionShell key={id} session={session} selected={id === selectedId} tabbable={id === tabbable} onSelect={onSelect} className="min-h-am-row border-b border-border px-3.5 py-2.5">
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5">
                      <StateIconTip session={session} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <ProjectLabel session={session} className="flex-1" terms={query.terms} />
                        <RowMarks session={session} />
                        <TimeInState session={session} now={now} />
                      </div>
                      {line !== '' ? (
                        <p className={`truncate text-xs ${session.state === 'needs-you' ? 'text-hue-red' : 'text-muted'}`} title={line}>
                          <Highlight text={line} terms={query.terms} />
                        </p>
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
