import { Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { IconButton, Tooltip } from '@wadeck-app/dsl-ui';
import { FOCUS_RING } from '../ui/focusRing.js';
import { BareInput, SEARCH_ICON } from '../ui/BareInput.js';
import { OPEN_SEARCH_EVENT, type OpenSearchEvent } from '../ui/hooks.js';
import { TIP_FILL } from '../ui/tipWrap.js';

const PROBLEMS_NOTE = 'absolute left-0 top-full z-20 mt-1 rounded border border-warning bg-warning-bg px-2 py-1 text-xs text-warning-text shadow';

const SEARCH_BOX = 'relative flex min-w-40 max-w-lg flex-1';

// Narrow screen, field open: it takes a whole row of the toolbar, whatever the room.
const SEARCH_BOX_COMPACT = 'relative flex min-w-0 basis-full';

export interface SearchBoxProps {
  text: string;
  onText: (text: string) => void;
  /** Agents the search lets through, and the agents there are: "3 of 15". */
  shown: number;
  total: number;
  /** What the user typed that cannot be applied (an unknown state...): shown, never ignored. */
  problems: readonly string[];
  /** ArrowDown (1) and ArrowUp (-1): move the selection through the list. */
  onMove: (step: 1 | -1) => void;
  /** Enter: open the selected (or first) agent and go to its reply box. */
  onEnter: () => void;
  /** Narrow screen: the field hides behind one icon button and opens on a row of its own (Escape or leaving it empty closes it again). */
  compact?: boolean;
}

/**
 * The search box of the toolbar, for every mode (`/` focuses it from anywhere). Typing filters by fuzzy match on name, folder, path and last activity;
 * `state:done`, `project:shop` and `!state:idle` narrow it (own grammar: a typo is reported). Arrows move the selection (the detail follows), Enter goes to the
 * reply box, Escape clears the text and, once empty, leaves the field so the page shortcuts work again.
 */
export function SearchBox({ text, onText, shown, total, problems, onMove, onEnter, compact = false }: SearchBoxProps) {
  const problemsId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const [opened, setOpened] = useState(false);
  // A text or a problem keeps the field visible: an active filter never hides behind a closed field.
  const collapsed = compact && !opened && text === '' && problems.length === 0;
  // The / shortcut finds no field while it is collapsed: it asks the field to open (see focusSearch).
  useEffect(() => {
    const open = (event: Event): void => {
      (event as OpenSearchEvent).detail.handled = true;
      setOpened(true);
    };
    window.addEventListener(OPEN_SEARCH_EVENT, open);
    return () => window.removeEventListener(OPEN_SEARCH_EVENT, open);
  }, []);
  // The field has just appeared because the user asked for it: typing comes next.
  useEffect(() => {
    if (opened && !collapsed) {
      fieldRef.current?.focus();
    }
  }, [opened, collapsed]);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      onMove(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onEnter();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (text !== '') {
        onText('');
      } else {
        event.currentTarget.blur();
      }
    }
  };
  if (collapsed) {
    return <IconButton size="icon-sm" variant="ghost" aria-label="Search agents" aria-expanded={false} onClick={() => setOpened(true)} icon={<Search aria-hidden="true" className="h-4 w-4" />} />;
  }
  return (
    // A flex box: the wrapper of the Tooltip (TIP_FILL) fills the field through its flex-basis.
    <div className={compact ? SEARCH_BOX_COMPACT : SEARCH_BOX}>
      <Search aria-hidden="true" className={SEARCH_ICON} />
      <Tooltip className={TIP_FILL} content="Search by name, folder, path or last activity. Filters: state:done, project:shop, !state:idle. Press / to focus." describe={false}>
      <BareInput
        ref={fieldRef}
        data-tip-fill=""
        data-agent-search=""
        type="text"
        aria-label="Search agents"
        aria-describedby={problems.length > 0 ? problemsId : undefined}
        aria-invalid={problems.length > 0}
        placeholder={compact ? 'Search agents' : 'Search agents (press /)'}
        autoComplete="off"
        spellCheck={false}
        value={text}
        onChange={(event) => onText(event.target.value)}
        onKeyDown={onKeyDown}
        // Compact: leaving the field empty folds it back to the icon.
        onBlur={() => setOpened(false)}
        className={`h-7 w-full rounded border bg-bg pl-8 text-sm text-content placeholder:text-muted ${text === '' ? 'pr-2' : 'pr-24'} ${problems.length > 0 ? 'border-warning' : 'border-border'} ${FOCUS_RING}`}
      />
      </Tooltip>
      {text !== '' ? (
        <span className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
          <span role="status" className="text-xs tabular-nums text-muted">
            {shown} of {total}
          </span>          <IconButton size="icon-xs" aria-label="Clear the search box" onClick={() => onText('')} icon={<X aria-hidden="true" className="h-3 w-3" />} />
        </span>
      ) : null}
      {problems.length > 0 ? (
        <p id={problemsId} role="status" className={PROBLEMS_NOTE}>
          {problems.join('. ')}
        </p>
      ) : null}
    </div>
  );
}
