import { useCallback, useState, type DragEvent, type HTMLAttributes } from 'react';
import { dropBefore, inLowerHalf, reorderedGroupIds } from '../logic/customGroups.js';
import type { CustomGroupDto } from '../shared.js';
import type { GroupsApi } from './common.js';

/** What is being dragged: an agent row (with the group it came from) or a group header. */
type Drag = { kind: 'agent'; id: string; from: string | null } | { kind: 'group'; id: string };

/** What the pointer is over, for the drop indicator: a row or a header (a bar above or below), or a whole section (a ring). */
export type Over = { kind: 'row' | 'header'; id: string; after: boolean } | { kind: 'section'; id: string } | { kind: 'ungrouped' };

type Handlers = Pick<HTMLAttributes<HTMLDivElement>, 'draggable' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onDrop' | 'onDragLeave'>;

/** The type of the data put on the drag: it also keeps a foreign drag (a file, a link) from being taken for ours. */
export const DRAG_TYPE = 'application/x-agent-manager-group-dnd';

function transferOf(event: DragEvent): DataTransfer | null {
  // Absent in a test environment that builds the event without one; a real browser always sets it.
  return (event as { dataTransfer: DataTransfer | null }).dataTransfer;
}

export function startDrag(event: DragEvent, id: string): void {
  const transfer = transferOf(event);
  if (transfer !== null) {
    transfer.effectAllowed = 'move';
    transfer.setData(DRAG_TYPE, id);
    // Firefox starts no drag without text data.
    transfer.setData('text/plain', id);
  }
}

export function acceptDrop(event: DragEvent): void {
  event.preventDefault();
  const transfer = transferOf(event);
  if (transfer !== null) {
    transfer.dropEffect = 'move';
  }
}

function lowerHalf(event: DragEvent): boolean {
  return inLowerHalf(event.clientY, event.currentTarget.getBoundingClientRect());
}

export interface GroupDnd {
  /** What is dragged now, for the looks of the source (dimmed) and the drop hints. */
  dragging: Drag | undefined;
  over: Over | undefined;
  /** An agent row: draggable; when `members` is given the row is in a custom group (its visible members, in order) and is also a drop target for an agent. */
  row: (sessionId: string, groupId: string | null, members?: readonly string[]) => Handlers;
  /** The header of a group: draggable (reorders the groups), and a drop target for an agent (end of the group) and for another group (before or after). */
  header: (group: CustomGroupDto) => Handlers;
  /** The whole section of a group: a drop target for an agent. */
  section: (group: CustomGroupDto) => Handlers;
  /** The area of the ungrouped agents: a drop target for an agent that is in a group. */
  ungrouped: () => Handlers;
}

/**
 * Native HTML5 drag and drop for the custom groups (no library): agents move into a group, out of it, inside it; group headers reorder the groups. The
 * decisions are the pure functions of logic/customGroups.ts; this hook only turns pointer events into them. The keyboard does the same through the Move
 * dialog and Alt+Up / Alt+Down (TreeList).
 */
export function useGroupDnd(api: GroupsApi | undefined): GroupDnd {
  const [dragging, setDragging] = useState<Drag | undefined>(undefined);
  const [over, setOver] = useState<Over | undefined>(undefined);
  const end = useCallback((): void => {
    setDragging(undefined);
    setOver(undefined);
  }, []);
  // Leaving a target for another element of the same section fires dragleave then dragover: clear only when the pointer left the target for good.
  const leave = (event: DragEvent): void => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
      setOver(undefined);
    }
  };

  if (api === undefined) {
    const none: Handlers = {};
    return { dragging, over, row: () => none, header: () => none, section: () => none, ungrouped: () => none };
  }

  return {
    dragging,
    over,
    row: (sessionId, groupId, members) => ({
      draggable: true,
      onDragStart: (event) => {
        // The sub-agent rows and the buttons inside a row are not ours to drag.
        event.stopPropagation();
        startDrag(event, sessionId);
        setDragging({ kind: 'agent', id: sessionId, from: groupId });
      },
      onDragEnd: end,
      ...(members === undefined || groupId === null
        ? {}
        : {
            onDragOver: (event: DragEvent<HTMLDivElement>) => {
              if (dragging?.kind !== 'agent') {
                return;
              }
              event.stopPropagation();
              acceptDrop(event);
              setOver({ kind: 'row', id: sessionId, after: lowerHalf(event) });
            },
            onDrop: (event: DragEvent<HTMLDivElement>) => {
              if (dragging?.kind !== 'agent') {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              const before = dropBefore(members, sessionId, lowerHalf(event));
              end();
              // Dropped on itself, or just before itself: nothing to move.
              if (sessionId !== dragging.id && before !== dragging.id) {
                api.move(dragging.id, groupId, before);
              }
            },
          }),
    }),
    header: (group) => ({
      draggable: true,
      onDragStart: (event) => {
        event.stopPropagation();
        startDrag(event, group.id);
        setDragging({ kind: 'group', id: group.id });
      },
      onDragEnd: end,
      onDragOver: (event) => {
        if (dragging === undefined) {
          return;
        }
        event.stopPropagation();
        acceptDrop(event);
        setOver(dragging.kind === 'group' ? { kind: 'header', id: group.id, after: lowerHalf(event) } : { kind: 'section', id: group.id });
      },
      onDrop: (event) => {
        if (dragging === undefined) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const after = lowerHalf(event);
        end();
        if (dragging.kind === 'agent') {
          api.move(dragging.id, group.id, null);
          return;
        }
        const ids = reorderedGroupIds(api.groups, dragging.id, group.id, after);
        if (ids !== undefined) {
          api.reorder(ids);
        }
      },
    }),
    section: (group) => ({
      onDragOver: (event) => {
        if (dragging?.kind !== 'agent') {
          return;
        }
        acceptDrop(event);
        setOver({ kind: 'section', id: group.id });
      },
      onDragLeave: leave,
      onDrop: (event) => {
        if (dragging?.kind !== 'agent') {
          return;
        }
        event.preventDefault();
        end();
        api.move(dragging.id, group.id, null);
      },
    }),
    ungrouped: () => ({
      onDragOver: (event) => {
        // An agent that is already ungrouped has nowhere to go here: no drop cursor, no hint.
        if (dragging?.kind !== 'agent' || dragging.from === null) {
          return;
        }
        acceptDrop(event);
        setOver({ kind: 'ungrouped' });
      },
      onDragLeave: leave,
      onDrop: (event) => {
        if (dragging?.kind !== 'agent' || dragging.from === null) {
          return;
        }
        event.preventDefault();
        end();
        api.move(dragging.id, null, null);
      },
    }),
  };
}
