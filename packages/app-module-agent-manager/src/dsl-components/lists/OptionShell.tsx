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
  /** Opens the menu of the row at a point of the window: a right-click, the context-menu key or Shift+F10 (which report no pointer: the menu opens under the row). */
  onMenu?: (anchor: { x: number; y: number }) => void;
  /** The row has several lines (Groups, Inbox): in the selection mode its checkbox sits on the first line, with the state icon, instead of the middle of the row. */
  multiline?: boolean;
  children: ReactNode;
}

/** The selectable row of every list: the option role, roving tabindex, the data the keyboard hook reads, the selection and focus looks. */
export function OptionShell({ session, selected, tabbable, onSelect, role = 'option', level, expanded, className = '', look, rowProps, onMenu, multiline = false, children }: OptionShellProps) {
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
    // The context-menu key and Shift+F10 open the menu of the row (the browser may or may not turn them into a contextmenu event: handled here, once).
    if (onMenu !== undefined && event.target === event.currentTarget && (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey))) {
      event.preventDefault();
      const box = event.currentTarget.getBoundingClientRect();
      onMenu({ x: box.left + 24, y: box.bottom });
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
      onContextMenu={(event) => {
        if (onMenu !== undefined) {
          event.preventDefault();
          const box = event.currentTarget.getBoundingClientRect();
          onMenu(event.clientX === 0 && event.clientY === 0 ? { x: box.left + 24, y: box.bottom } : { x: event.clientX, y: event.clientY });
        }
      }}
      {...rowProps}
      className={`group relative cursor-pointer text-sm ${look === undefined ? `border-l-2 ${selected ? 'border-primary bg-primary-light' : tint === undefined ? 'border-transparent hover:bg-muted-bg' : `border-transparent ${tint} hover:brightness-95`}` : selected ? look.selected : look.idle} ${FOCUS_RING} focus-visible:ring-inset ${selection?.isSelected(id) === true ? 'ring-2 ring-inset ring-primary' : ''} ${className}`}
    >
      {/* One wrapper in both states (the row keeps its DOM when the mode turns on): `contents` takes no room, in the mode it is the line of the checkbox column and the body. */}
      <div data-row-line="" className={selection?.mode === true ? `flex h-full ${multiline ? 'items-start' : 'items-center'} gap-2` : 'contents'}>
        <RowCheckbox id={id} name={session.displayName} firstLine={multiline} />
        <div className={selection?.mode === true ? 'h-full min-w-0 flex-1' : 'contents'}>{children}</div>
      </div>
    </div>
  );
}
