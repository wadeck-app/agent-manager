import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useUrlParam } from '@wadeck-app/dsl-ui';
import { filterSessions, parseQuery } from '../logic/fuzzy.js';
import { firstNonEmptyTab, INBOX_TABS, nextNeedingYou, parseTab, tabCounts, tabSessions, type InboxTab } from '../logic/inbox.js';
import { agentId } from '../logic/states.js';
import { FOCUS_RING } from '../ui/IconButton.js';
import { tabbableId, useListKeys } from '../ui/hooks.js';
import { detailLine, type ListProps } from './common.js';
import { EmptyNote } from './EmptyNote.js';
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
 * Triage inbox (Linear Inbox, Superhuman split inbox and GitHub notifications are the inspiration): the tab says what to do, the row says why
 * (the reason line: what the agent waits for). Sub-variants: `tabs` underlined tabs with counts; `segmented` a segmented filter plus a search box;
 * `autonext` the tabs, and when the session you replied to stops needing you the next one that does is opened.
 */
export function InboxList({ sessions, selectedId, onSelect, now, style }: ListProps) {
  const [tabParam, setTabParam] = useUrlParam('tab');
  const counts = useMemo(() => tabCounts(sessions), [sessions]);
  const tab = parseTab(tabParam) ?? firstNonEmptyTab(counts);
  const [search, setSearch] = useState('');
  const query = useMemo(() => parseQuery(search), [search]);
  const tabSource = useMemo(() => tabSessions(sessions, tab), [sessions, tab]);
  const rows = useMemo(() => (style === 'segmented' ? filterSessions(tabSource, query) : tabSource), [style, tabSource, query]);
  const ids = useMemo(() => rows.map(agentId), [rows]);
  const tabbable = tabbableId(ids, selectedId);
  const onKeyDown = useListKeys({ onSelect });

  // autonext: remember whether the selected session needed you at the previous render; when it no longer does, open the next one that does.
  const previous = useRef<{ id: string; needed: boolean } | undefined>(undefined);
  useEffect(() => {
    if (style !== 'autonext' || selectedId === undefined) {
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
  }, [style, sessions, selectedId, onSelect]);

  const tabButtons = INBOX_TABS.map((entry) => {
    const active = entry.id === tab;
    const base = `flex shrink-0 items-center gap-1 whitespace-nowrap text-sm ${FOCUS_RING}`;
    const look =
      style === 'segmented'
        ? `rounded px-2 py-1 ${active ? 'bg-surface font-medium text-content shadow-sm' : 'text-muted hover:text-content'}`
        : `border-b-2 px-2 py-2 ${active ? 'border-primary font-medium text-content' : 'border-transparent text-muted hover:text-content'}`;
    return (
      <button key={entry.id} type="button" role="tab" id={`inbox-tab-${entry.id}`} aria-selected={active} aria-controls="inbox-panel" tabIndex={active ? 0 : -1} onClick={() => setTabParam(entry.id)} className={`${base} ${look}`}>
        {entry.label}
        <span className={`tabular-nums text-xs ${entry.id === 'needs-you' && counts['needs-you'] > 0 ? 'rounded-full bg-hue-red-bg px-1.5 text-hue-red' : counts[entry.id] === 0 ? 'text-muted opacity-60' : 'text-muted'}`}>{counts[entry.id]}</span>
      </button>
    );
  });
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
      <div className={style === 'segmented' ? 'flex flex-col gap-2 border-b border-border p-2' : 'border-b border-border'}>
        <div role="tablist" aria-label="Inbox" onKeyDown={onTabKeys} className={style === 'segmented' ? 'flex gap-0.5 overflow-x-auto rounded-md bg-muted-bg p-0.5' : 'flex overflow-x-auto'}>
          {tabButtons}
        </div>
        {style === 'segmented' ? (
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 h-am-icon-sm w-am-icon-sm -translate-y-1/2 text-muted" />
            <input
              type="search"
              aria-label="Filter this tab"
              data-agent-search=""
              placeholder="Filter by name or folder"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className={`w-full rounded border border-border bg-bg py-2 pl-8 pr-8 text-sm text-content placeholder:text-muted ${FOCUS_RING}`}
            />
            {search !== '' ? (
              <button type="button" aria-label="Clear the filter" onClick={() => setSearch('')} className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-content ${FOCUS_RING}`}>
                <X aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div id="inbox-panel" role="tabpanel" aria-labelledby={`inbox-tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
        {rows.length === 0 ? (
          search !== '' && style === 'segmented' ? (
            <EmptyNote
              title={`No session in this tab matches '${search}'`}
              hint={tabSource.length > 0 ? `${tabSource.length} sessions are in this tab: change the filter.` : undefined}
              action={
                <button type="button" onClick={() => setSearch('')} className={`rounded border border-border px-2 py-1 text-sm text-content hover:bg-muted-bg ${FOCUS_RING}`}>
                  Clear the filter
                </button>
              }
            />
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
                        <ProjectLabel session={session} className="flex-1" />
                        <RowMarks session={session} />
                        <TimeInState session={session} now={now} />
                      </div>
                      {line !== '' ? (
                        <p className={`truncate text-xs ${session.state === 'needs-you' ? 'text-hue-red' : 'text-muted'}`} title={line}>
                          {line}
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
