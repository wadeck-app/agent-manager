import { useState, type ReactNode } from 'react';
import type { AgentRow } from '../data/types.js';
import { agentId } from '../logic/states.js';
import type { MarksApi, RowActionsApi } from './common.js';
import { RowMenu, type RowMenuActions } from './RowMenu.js';

type Anchor = { x: number; y: number };

export interface RowMenuHost {
  /** Opens the menu of a row at a point of the window. */
  open: (session: AgentRow, anchor: Anchor) => void;
  /** The menu (render it once, anywhere in the list); null while closed. */
  element: ReactNode;
  /** False when the list has nothing to put in a menu (no marks, no actions, no groups): rows then draw no "..." button. */
  available: boolean;
}

/**
 * The menu of the rows of a list: the actions the page gave (marks, pin and seen) and the list's own Move to a group, one menu for every row, opened by the
 * "..." button, a right-click or the context-menu key. A list drawn alone (a test) has none of the page's actions and shows no button.
 */
export function useRowMenu({ marks, rowActions, onMove }: { marks: MarksApi | undefined; rowActions: RowActionsApi | undefined; onMove: ((sessionId: string) => void) | undefined }): RowMenuHost {
  const [menu, setMenu] = useState<{ session: AgentRow; anchor: Anchor } | undefined>(undefined);
  const available = marks !== undefined || rowActions !== undefined || onMove !== undefined;
  const element =
    menu === undefined ? null : (
      <RowMenu
        session={menu.session}
        anchor={menu.anchor}
        onClose={() => setMenu(undefined)}
        actions={buildActions(menu.session, { marks, rowActions, onMove })}
      />
    );
  return { open: (session, anchor) => setMenu({ session, anchor }), element, available };
}

function buildActions(session: AgentRow, { marks, rowActions, onMove }: { marks: MarksApi | undefined; rowActions: RowActionsApi | undefined; onMove: ((sessionId: string) => void) | undefined }): RowMenuActions {
  const id = agentId(session);
  const actions: RowMenuActions = {};
  if (onMove !== undefined) {
    actions.move = () => onMove(id);
  }
  if (marks !== undefined) {
    actions.flag = (flag) => marks.setMarks(id, { flag });
    actions.unread = (unread) => marks.setMarks(id, { unread });
  }
  if (rowActions !== undefined) {
    actions.pin = (pinned) => rowActions.pin(session, pinned);
    actions.seen = () => rowActions.seen(session);
  }
  return actions;
}
