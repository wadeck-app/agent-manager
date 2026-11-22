import type { HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { AgentRow } from '../data/types.js';
import { stateTint } from '../logic/herdrRow.js';
import { agentId } from '../logic/states.js';
import { FOCUS_RING } from '../ui/focusRing.js';
import { visibleSessionIds } from '../workspace/usePageShortcuts.js';
import { RowCheckbox } from './RowCheckbox.js';
import { useSelection } from './selection.js';

export interface OptionShellProps {
  session: AgentRow;
  selected: boolean;
  /** Holds the tab stop of the list (roving tabindex). */
  tabbable: boolean;
  onSelect: (sessionId: string) => void;
  role?: 'option' | 'treeitem';
  level?: number;
  /** A row that can open (sub-agents): its state; undefined for a row that cannot. */
  expanded?: boolean;
  className?: string;
  /** Replaces the default selected and idle looks (the Herdr rows tint themselves by state). */
  look?: { selected: string; idle: string };
  /** Extra attributes of the row (the drag and drop handlers of the Tree list). */
  rowProps?: Pick<HTMLAttributes<HTMLDivElement>, 'draggable' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onDrop'>;
  children: ReactNode;
}

/** The selectable row of every list: the option role, roving tabindex, the data the keyboard hook reads, the selection and focus looks. */
export function OptionShell({ session, selected, tabbable, onSelect, role = 'option', level, expanded, className = '', look, rowProps, children }: OptionShellProps) {
  const id = agentId(session);
  const selection = useSelection();
  // The open row keeps the primary look; any other row has the tint of its state (needs you, finished and unseen, flagged), the same in every list mode.
  const tint = stateTint(session.state, session.flagged, session.unread);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Space selects like a click (Enter is the list's: select and go to the composer).
    if (event.key === ' ' && event.target === event.currentTarget) {
      event.preventDefault();
      onSelect(id);
      return;
    }
    // X ticks the box of the focused row (the keyboard way to build a selection); Escape (handled by the page) clears it.
    if (event.key === 'x' && selection !== null && !event.ctrlKey && !event.metaKey && !event.altKey && event.target === event.currentTarget) {
      event.preventDefault();
      selection.toggle(id);
    }
  };
  // Shift click adds the range from the last ticked row, Ctrl or Cmd click toggles the row; a plain click opens it (the selection is kept).
  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (selection !== null && event.shiftKey) {
      selection.selectRange(id, visibleSessionIds());
    } else if (selection !== null && (event.ctrlKey || event.metaKey)) {
      selection.toggle(id);
    } else {
      onSelect(id);
    }
  };
  return (
    <div
      role={role}
      aria-selected={selected}
      aria-level={level}
      aria-expanded={expanded}
      data-nav-item=""
      data-session-id={id}
      data-multi-selected={selection?.isSelected(id) === true ? 'true' : undefined}
      tabIndex={tabbable ? 0 : -1}
      onClick={onClick}
      // A shift click must not select the text between the two rows.
      onMouseDown={(event) => {
        if (selection !== null && event.shiftKey) {
          event.preventDefault();
        }
      }}
      onKeyDown={onKeyDown}
      {...rowProps}
      className={`group relative cursor-pointer text-sm ${look === undefined ? `border-l-2 ${selected ? 'border-primary bg-primary-light' : tint === undefined ? 'border-transparent hover:bg-muted-bg' : `border-transparent ${tint} hover:brightness-95`}` : selected ? look.selected : look.idle} ${FOCUS_RING} focus-visible:ring-inset ${selection?.isSelected(id) === true ? 'ring-2 ring-inset ring-primary' : ''} ${className}`}
    >
      <RowCheckbox id={id} name={session.displayName} />
      {children}
    </div>
  );
}
