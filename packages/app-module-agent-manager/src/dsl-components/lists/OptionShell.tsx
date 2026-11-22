import type { HTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import type { AgentRow } from '../data/types.js';
import { agentId } from '../logic/states.js';
import { FOCUS_RING } from '../ui/focusRing.js';

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
  /** Extra attributes of the row (the drag and drop handlers of the Tree list). */
  rowProps?: Pick<HTMLAttributes<HTMLDivElement>, 'draggable' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onDrop'>;
  children: ReactNode;
}

/** The selectable row of every list: the option role, roving tabindex, the data the keyboard hook reads, the selection and focus looks. */
export function OptionShell({ session, selected, tabbable, onSelect, role = 'option', level, expanded, className = '', rowProps, children }: OptionShellProps) {
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
      aria-level={level}
      aria-expanded={expanded}
      data-nav-item=""
      data-session-id={id}
      tabIndex={tabbable ? 0 : -1}
      onClick={() => onSelect(id)}
      onKeyDown={onKeyDown}
      {...rowProps}
      className={`cursor-pointer text-sm border-l-2 ${selected ? 'border-primary bg-primary-light' : 'border-transparent hover:bg-muted-bg'} ${FOCUS_RING} focus-visible:ring-inset ${className}`}
    >
      {children}
    </div>
  );
}
