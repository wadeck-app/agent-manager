import { Search, X } from 'lucide-react';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { FILTERABLE_STATES, filterSessions, parseQuery, stateTokens, toggleStateToken } from '../logic/fuzzy.js';
import { countByState } from '../logic/grouping.js';
import { navTarget } from '../logic/nav.js';
import { agentId, ATTENTION, STATE_LABEL } from '../logic/states.js';
import { sortForState } from '../logic/grouping.js';
import { FOCUS_RING } from '../ui/IconButton.js';
import { focusComposer } from '../ui/hooks.js';
import { STATE_LOOK } from '../ui/stateLook.js';
import { StatusIcon } from '../ui/StatusIcon.js';
import { detailLine, type ListProps } from './common.js';
import { EmptyNote } from './EmptyNote.js';
import { ListScroll } from './ListScroll.js';
import { OptionShell } from './OptionShell.js';
import { Highlight } from './Highlight.js';
import { ProjectLabel } from './ProjectLabel.js';
import { RowMarks } from './RowMarks.js';
import { StateIconTip } from './StateIconTip.js';
import { TimeInState } from './TimeInState.js';

/**
 * Search first (the herdr goto picker and Raycast are the inspiration): the input is the entry point and the keyboard does the rest. Typing filters by fuzzy
 * match on name, folder, path and last activity; `state:done`, `project:shop` and `!state:idle` narrow it (own grammar, a typo is reported, not ignored).
 * Arrows move the highlight (the detail follows), Enter goes to the composer, Escape clears, `/` focuses the input from anywhere on the page.
 * Sub-variants: `search` input and list; `facets` the same plus one chip per state with its count; `minimal` the input alone, the list opens while it has the focus.
 */
export function PaletteList({ sessions, selectedId, onSelect, now, style }: ListProps) {
  const prefix = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const query = useMemo(() => parseQuery(text), [text]);
  const base = useMemo(() => [...sessions].sort((a, b) => ATTENTION[b.state] - ATTENTION[a.state] || sortForState(a.state)(a, b)), [sessions]);
  const results = useMemo(() => filterSessions(base, query), [base, query]);
  const ids = useMemo(() => results.map(agentId), [results]);
  const counts = useMemo(() => countByState(sessions), [sessions]);
  const activeStates = stateTokens(text);
  const listOpen = style !== 'minimal' || focused || text !== '';
  const optionId = (id: string): string => `${prefix}-${id}`;
  const highlighted = selectedId !== undefined && ids.includes(selectedId) ? selectedId : undefined;

  // `/` is a page shortcut (workspace/usePageShortcuts): it focuses the element marked data-agent-search, which is the input below.

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const target = navTarget(event.key, ids, highlighted);
      if (target !== undefined) {
        onSelect(target);
        // Keep the highlighted option in view inside the scrolling list.
        document.getElementById(optionId(target))?.scrollIntoView?.({ block: 'nearest' });
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = highlighted ?? ids[0];
      if (target !== undefined) {
        onSelect(target);
        focusComposer();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      // First Escape clears the text, the next one leaves the field (so the page shortcuts work again).
      if (text !== '') {
        setText('');
      } else {
        event.currentTarget.blur();
      }
    }
  };

  const onBlur = (event: React.FocusEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setFocused(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" onFocus={() => setFocused(true)} onBlur={onBlur}>
      <div className="flex flex-col gap-2 border-b border-border p-2">
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 h-am-icon-sm w-am-icon-sm -translate-y-1/2 text-muted" />
          <input
            ref={input}
            data-agent-search=""
            type="text"
            role="combobox"
            aria-expanded={listOpen}
            aria-controls={`${prefix}-list`}
            aria-activedescendant={highlighted === undefined ? undefined : optionId(highlighted)}
            aria-autocomplete="list"
            aria-label="Search agents"
            aria-describedby={query.problems.length > 0 ? `${prefix}-problems` : undefined}
            aria-invalid={query.problems.length > 0}
            placeholder="Search, or state:done project:shop"
            autoComplete="off"
            spellCheck={false}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onInputKey}
            className={`w-full rounded border border-border bg-bg py-2 pl-8 pr-8 text-sm text-content placeholder:text-muted ${FOCUS_RING}`}
          />
          {text !== '' ? (
            <button type="button" aria-label="Clear the search" onClick={() => { setText(''); input.current?.focus(); }} className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-content ${FOCUS_RING}`}>
              <X aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
            </button>
          ) : null}
        </div>
        {style === 'facets' ? (
          <div role="group" aria-label="Filter by state" className="flex flex-wrap gap-1.5">
            {FILTERABLE_STATES.filter((state) => counts[state] > 0 || activeStates.includes(state)).map((state) => {
              const pressed = activeStates.includes(state);
              return (
                <button
                  key={state}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => setText(toggleStateToken(text, state))}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${pressed ? `border-primary ${STATE_LOOK[state].bg} text-content` : 'border-border text-muted hover:bg-muted-bg'} ${FOCUS_RING}`}
                >
                  <StatusIcon state={state} sizeClass="h-am-icon-sm w-am-icon-sm" labelled={false} />
                  {STATE_LABEL[state]}
                  <span className="tabular-nums">{counts[state]}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        {query.problems.length > 0 ? (
          <p id={`${prefix}-problems`} role="status" className="text-xs text-warning-text">
            {query.problems.join('. ')}
          </p>
        ) : null}
        <p className="text-xs text-muted" role="status">
          {text === '' ? `${sessions.length} sessions` : `${results.length} of ${sessions.length} sessions`}
        </p>
      </div>
      {!listOpen ? (
        <EmptyNote title="Type to find an agent" hint="Press / anywhere on the page to search. Arrow keys move, Enter goes to the reply box." />
      ) : results.length === 0 ? (
        <EmptyNote
          title={sessions.length === 0 ? 'No session to show' : `No session matches '${text}'`}
          hint={sessions.length === 0 ? 'Start Claude Code in a terminal and it appears here within 5 seconds.' : 'Check the spelling, or remove a state: or project: filter.'}
          action={
            text !== '' ? (
              <button type="button" onClick={() => setText('')} className={`rounded border border-border px-2 py-1 text-sm text-content hover:bg-muted-bg ${FOCUS_RING}`}>
                Clear the search
              </button>
            ) : undefined
          }
        />
      ) : (
        <div id={`${prefix}-list`} className="flex min-h-0 flex-1 flex-col">
          <ListScroll label="Search results">
            {results.map((session) => {
              const id = agentId(session);
              const line = detailLine(session);
              return (
                <OptionShell key={id} elementId={optionId(id)} session={session} selected={id === selectedId} tabbable={false} onSelect={(value) => { onSelect(value); input.current?.focus(); }} className="min-h-am-hit px-3.5 py-2">
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
                        <p className="truncate text-xs text-muted" title={line}>
                          <Highlight text={line} terms={query.terms} />
                        </p>
                      ) : null}
                    </div>
                  </div>
                </OptionShell>
              );
            })}
          </ListScroll>
        </div>
      )}
    </div>
  );
}
