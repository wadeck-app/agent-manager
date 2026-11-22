import { useCallback, useState, type DragEvent, type HTMLAttributes } from 'react';
import { resolveDrop, type DropContext, type DropOutcome, type DropTarget, type Held } from '../logic/customMode.js';
import type { GroupsApi } from './common.js';
import { acceptDrop, startDrag } from './useGroupDnd.js';

type Handlers = Pick<HTMLAttributes<HTMLElement>, 'draggable' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onDrop' | 'onDragLeave'>;

/** What the pointer is over and what a drop there would do (for the indicator). */
export interface CustomOver {
  target: DropTarget;
  outcome: DropOutcome;
}

export interface CustomDnd {
  /** What is held now (dims the source, tells the list a drag is going on). */
  dragging: Held | undefined;
  over: CustomOver | undefined;
  /** Why a drop here is ignored; empty when there is nothing to say. The list shows it. */
  hint: string;
  /** Says something in the hint line (the keyboard move of a group that is not manual); it goes away by itself. */
  notify: (hint: string) => void;
  /** An agent row: draggable, and a target (it joins the group before it, or takes its place). */
  row: (sessionId: string, groupId: string | null) => Handlers;
  /** A group header: draggable when it is a real group, a target for an agent (end of the group) and for another header (reorder). */
  header: (groupId: string | null) => Handlers;
  /** The strip under the last agent of a group: a target for an agent (bottom of the group). */
  end: (groupId: string | null) => Handlers;
  /** The whole block of a group (header, agents, empty-group line, gaps): the fallback target for an agent, so a drop never lands on a dead spot. The parts above stop the event first. */
  block: (groupId: string | null) => Handlers;
}

const NO_HANDLERS: Handlers = {};

/**
 * Native HTML5 drag and drop of the Custom mode. The decisions are `resolveDrop` (logic/customMode.ts, tested); this hook turns pointer events into them.
 * PITFALL (found in the Herdr mod): the drop handler reads the held item FIRST, clears it, and decides with what it read: clearing it before validating the
 * target rejects every drop without a word.
 */
export function useCustomDnd(api: GroupsApi | undefined, ctx: DropContext): CustomDnd {
  const [dragging, setDragging] = useState<Held | undefined>(undefined);
  const [over, setOver] = useState<CustomOver | undefined>(undefined);
  const [hint, setHint] = useState('');
  const notify = useCallback((text: string): void => {
    setHint(text);
    window.setTimeout(() => setHint((current) => (current === text ? '' : current)), 6000);
  }, []);
  const end = useCallback((): void => {
    setDragging(undefined);
    setOver(undefined);
    setHint('');
  }, []);
  if (api === undefined) {
    return { dragging, over, hint, notify, row: () => NO_HANDLERS, header: () => NO_HANDLERS, end: () => NO_HANDLERS, block: () => NO_HANDLERS };
  }

  const apply = (outcome: DropOutcome): void => {
    if (outcome.kind === 'move') {
      api.move(outcome.sessionId, outcome.groupId, outcome.beforeId);
    } else if (outcome.kind === 'reorder') {
      api.reorder(outcome.ids);
    }
  };
  // One target, three events. `held` is read from the state of THIS render and passed on, never looked up again after end().
  const target = (to: DropTarget): Handlers => ({
    onDragOver: (event: DragEvent<HTMLElement>) => {
      const held = dragging;
      if (held === undefined) {
        return;
      }
      event.stopPropagation();
      const outcome = resolveDrop(held, to, ctx);
      if (outcome.kind === 'ignored') {
        // No drop cursor, and a visible reason.
        setHint(outcome.hint);
        setOver({ target: to, outcome });
        return;
      }
      if (outcome.kind === 'none') {
        setHint('');
        setOver(undefined);
        return;
      }
      acceptDrop(event);
      setHint('');
      setOver({ target: to, outcome });
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      const held = dragging;
      if (held === undefined) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      end();
      apply(resolveDrop(held, to, ctx));
    },
  });

  return {
    dragging,
    over,
    hint,
    notify,
    row: (sessionId, groupId) => ({
      draggable: true,
      onDragStart: (event) => {
        // The buttons inside a row are not ours to drag.
        event.stopPropagation();
        startDrag(event, sessionId);
        setDragging({ kind: 'agent', id: sessionId, from: groupId });
      },
      onDragEnd: end,
      ...target({ kind: 'row', id: sessionId, groupId }),
    }),
    header: (groupId) => ({
      ...(groupId === null
        ? {}
        : {
            draggable: true,
            onDragStart: (event: DragEvent<HTMLElement>) => {
              event.stopPropagation();
              startDrag(event, groupId);
              setDragging({ kind: 'group', id: groupId });
            },
            onDragEnd: end,
          }),
      ...target({ kind: 'header', groupId }),
    }),
    end: (groupId) => target({ kind: 'end', groupId }),
    // Same decision as the strip under the last agent: the end of the group (a group being dragged is not accepted here: resolveDrop only takes it on a header).
    block: (groupId) => target({ kind: 'end', groupId }),
  };
}
