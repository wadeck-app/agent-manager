import type { KeyboardEvent, ReactNode } from 'react';
import type { AgentRow } from '../data/types.js';
import { agentId } from '../logic/states.js';
import { FOCUS_RING } from '../ui/IconButton.js';

export interface OptionShellProps {
  session: AgentRow;
  selected: boolean;
  /** Holds the tab stop of the list (roving tabindex). */
  tabbable: boolean;
  onSelect: (sessionId: string) => void;
  role?: 'option' | 'treeitem';
  level?: number;
  /** The accessible name when the visible text is not enough (the icon rail shows monograms only). */
  label?: string;
  /** A row that can open (sub-agents): its state; undefined for a row that cannot. */
  expanded?: boolean;
  /** The element id (the palette points aria-activedescendant at it). */
  elementId?: string;
  /** `card`: a bordered card with margins instead of a full-width row. */
  look?: 'row' | 'card';
  className?: string;
  children: ReactNode;
}

/** The selectable row of every list: the option role, roving tabindex, the data the keyboard hook reads, the selection and focus looks. */
export function OptionShell({ session, selected, tabbable, onSelect, role = 'option', level, label, expanded, elementId, look = 'row', className = '', children }: OptionShellProps) {
  const id = agentId(session);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Space selects like a click (Enter is the list's: select and go to the composer).
    if (event.key === ' ' && event.target === event.currentTarget) {
      event.preventDefault();
      onSelect(id);
    }
  };
  return (
    <div
      role={role}
      aria-selected={selected}
      id={elementId}
      aria-label={label}
      aria-level={level}
      aria-expanded={expanded}
      data-nav-item=""
      data-session-id={id}
      tabIndex={tabbable ? 0 : -1}
      onClick={() => onSelect(id)}
      onKeyDown={onKeyDown}
      className={`cursor-pointer text-sm ${look === 'card' ? `mx-2 my-1.5 rounded-lg border ${selected ? 'border-primary bg-primary-light' : 'border-border hover:bg-muted-bg'}` : `border-l-2 ${selected ? 'border-primary bg-primary-light' : 'border-transparent hover:bg-muted-bg'}`} ${FOCUS_RING} focus-visible:ring-inset ${className}`}
    >
      {children}
    </div>
  );
}
