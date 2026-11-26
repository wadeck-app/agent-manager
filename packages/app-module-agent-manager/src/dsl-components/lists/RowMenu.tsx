import { ContextMenu, type ContextMenuItem } from '@wadeck-app/dsl-ui';
import { CircleDot, Eye, Flag, FlagOff, FolderInput, Pin, PinOff } from 'lucide-react';
import { useEffect } from 'react';
import type { AgentRow } from '../data/types.js';

/** What the menu of a row can do; an absent function removes its item (a list without custom groups has no Move). */
export interface RowMenuActions {
  move?: () => void;
  flag?: (flag: boolean) => void;
  unread?: (unread: boolean) => void;
  pin?: (pinned: boolean) => void;
  seen?: () => void;
}

// data-am-menu marks the menu as ours: the portaled panel is styled by a rule of styles/agents.css that only matches a menu holding such an icon.
const ICON = { className: 'h-4 w-4', 'data-am-menu': '' } as const;

/**
 * The menu of an agent row (the "..." button at the end of the row, a right-click, or the context-menu key or Shift+F10 on the focused row): every action of
 * the row in one place, so none depends on hover. It is the library ContextMenu (arrows, Home and End move, Enter picks, Escape or a press outside closes), opened
 * at the point of the window the row gave. Sections, with a divider between: Move to a group; flag, mark as unread and pin; mark as seen (a finished agent). None of
 * the actions destroys anything, so no item is styled as dangerous. Choosing an item acts and closes the menu. Mark as unread shows the blue "finished, not
 * seen" dot until the agent is selected (the Herdr behavior).
 */
export function RowMenu({ session, anchor, onClose, actions }: { session: AgentRow; anchor: { x: number; y: number }; onClose: () => void; actions: RowMenuActions }) {
  const { move, flag, unread, pin, seen } = actions;
  // The focus was on the row or on its button when the menu opened: it goes back there when the menu closes (the library has no control to return to, its trigger is a point).
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (before?.isConnected === true) {
        before.focus();
      }
    };
  }, []);

  const sections: ContextMenuItem[][] = [
    move === undefined ? [] : [{ label: 'Move to a group...', icon: <FolderInput {...ICON} />, onClick: move }],
    [
      ...(flag === undefined ? [] : [{ label: session.flagged ? 'Remove the flag' : 'Flag', icon: session.flagged ? <FlagOff {...ICON} /> : <Flag {...ICON} />, onClick: () => flag(!session.flagged) }]),
      ...(unread === undefined ? [] : [{ label: session.unread ? 'Mark as read' : 'Mark as unread', icon: <CircleDot {...ICON} />, onClick: () => unread(!session.unread) }]),
      ...(pin === undefined ? [] : [{ label: session.pinned ? 'Unpin' : 'Pin', icon: session.pinned ? <PinOff {...ICON} /> : <Pin {...ICON} />, onClick: () => pin(!session.pinned) }]),
    ],
    seen === undefined || session.state !== 'done' ? [] : [{ label: 'Mark as seen', icon: <Eye {...ICON} />, onClick: seen }],
  ].filter((section) => section.length > 0);
  const items = sections.flatMap((section, index): ContextMenuItem[] => (index === 0 ? section : [{ label: '', separator: true, onClick: () => undefined }, ...section]));

  return (
    // A zero size box at the point: the library menu hangs from its trigger, which is empty here.
    <div data-row-menu-anchor="" aria-label={`Actions of ${session.displayName}`} style={{ position: 'fixed', left: anchor.x, top: anchor.y, width: 0, height: 0 }}>
      <ContextMenu
        open
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
        side="bottom"
        align="start"
        items={items}
        trigger={<span aria-hidden="true" />}
      />
    </div>
  );
}
