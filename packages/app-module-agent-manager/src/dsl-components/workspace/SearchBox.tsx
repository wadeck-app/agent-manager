import { Search, X } from 'lucide-react';
import { useId, type KeyboardEvent } from 'react';
import { FOCUS_RING } from '../ui/IconButton.js';

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
}

/**
 * The search box of the toolbar, for every mode (`/` focuses it from anywhere). Typing filters by fuzzy match on name, folder, path and last activity;
 * `state:done`, `project:shop` and `!state:idle` narrow it (own grammar: a typo is reported). Arrows move the selection (the detail follows), Enter goes to the
 * reply box, Escape clears the text and, once empty, leaves the field so the page shortcuts work again.
 */
export function SearchBox({ text, onText, shown, total, problems, onMove, onEnter }: SearchBoxProps) {
  const problemsId = useId();
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
  return (
    <div className="relative min-w-32 max-w-lg flex-1">
      <Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 h-am-icon-sm w-am-icon-sm -translate-y-1/2 text-muted" />
      <input
        data-agent-search=""
        type="text"
        aria-label="Search agents"
        aria-describedby={problems.length > 0 ? problemsId : undefined}
        aria-invalid={problems.length > 0}
        placeholder="Search, or state:done project:shop (press /)"
        autoComplete="off"
        spellCheck={false}
        value={text}
        onChange={(event) => onText(event.target.value)}
        onKeyDown={onKeyDown}
        className={`h-am-hit w-full rounded border bg-bg pl-8 text-sm text-content placeholder:text-muted ${text === '' ? 'pr-2' : 'pr-24'} ${problems.length > 0 ? 'border-warning' : 'border-border'} ${FOCUS_RING}`}
      />
      {text !== '' ? (
        <span className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
          <span role="status" className="text-xs tabular-nums text-muted">
            {shown} of {total}
          </span>
          <button type="button" aria-label="Clear the search box" onClick={() => onText('')} className={`rounded p-0.5 text-muted hover:text-content ${FOCUS_RING}`}>
            <X aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          </button>
        </span>
      ) : null}
      {problems.length > 0 ? (
        <p id={problemsId} role="status" className="absolute left-0 top-full z-20 mt-1 rounded border border-warning bg-warning-bg px-2 py-1 text-xs text-warning-text shadow">
          {problems.join('. ')}
        </p>
      ) : null}
    </div>
  );
}
