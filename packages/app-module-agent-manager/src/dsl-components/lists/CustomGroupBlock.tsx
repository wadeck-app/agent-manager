import { ChevronDown, ChevronRight, FolderCog } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { AgentRow } from '../data/types.js';
import { UNGROUPED_ID, type CustomSection } from '../logic/customMode.js';
import { STATE_LOOK } from '../ui/stateLook.js';
import { FOCUS_RING } from '../ui/focusRing.js';
import { GROUP_LOOK } from '../ui/groupLook.js';
import { StatusIcon } from '../ui/StatusIcon.js';
import { Tooltip } from '../ui/Tooltip.js';
import { DropBar } from './DropBar.js';
import type { CustomDnd } from './useCustomDnd.js';

export interface CustomGroupBlockProps {
  section: CustomSection;
  open: boolean;
  /** Holds the tab stop of the list (nothing else is focusable). */
  tabbable: boolean;
  dnd: CustomDnd;
  onToggle: (open: boolean) => void;
  /** Opens the settings of the group at this point (the folder-cog button, the E key, a right-click on the header); absent for the Ungrouped bucket. */
  onConfig: ((anchor: { x: number; y: number }) => void) | undefined;
  renderRow: (session: AgentRow) => ReactNode;
}

/**
 * One block of the Custom list: a quiet header (fold chevron, name, count, and when folded the most urgent state of its agents, folder-cog button) then its
 * agents and a strip under the last one that is the "bottom of the group" drop target. Enter and Space fold, ArrowRight and ArrowLeft open and close, E opens
 * the settings, Alt+Up and Alt+Down move the group (handled by the list). The Ungrouped bucket is the same without the settings and the move.
 */
export function CustomGroupBlock({ section, open, tabbable, dnd, onToggle, onConfig, renderRow }: CustomGroupBlockProps) {
  const { group, sessions, rollup } = section;
  const name = group?.name ?? 'Ungrouped';
  const look = GROUP_LOOK[group?.color ?? 'none'];
  const groupId = group?.id ?? null;
  const Chevron = open ? ChevronDown : ChevronRight;
  const overHeader = dnd.over?.target.kind === 'header' && dnd.over.target.groupId === groupId;
  const overEnd = dnd.over?.target.kind === 'end' && dnd.over.target.groupId === groupId;
  const dragged = dnd.dragging?.kind === 'group' && dnd.dragging.id === groupId;
  // A group dropped on this header takes its place: the bar sits on the side it will land.
  const edge = overHeader && dnd.dragging?.kind === 'group' ? 'before' : undefined;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // The keys of a button inside the header are its own.
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    if (event.key === 'ArrowRight' && !open) {
      event.preventDefault();
      onToggle(true);
    } else if (event.key === 'ArrowLeft' && open) {
      event.preventDefault();
      onToggle(false);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      onToggle(!open);
    } else if (event.key === 'e' && onConfig !== undefined) {
      event.preventDefault();
      const box = event.currentTarget.getBoundingClientRect();
      onConfig({ x: box.right - 280, y: box.bottom });
    }
  };
  return (
    <div role="none" data-custom-section={section.id} className="pb-1">
      <div
        role="treeitem"
        aria-level={1}
        aria-expanded={open}
        aria-selected={false}
        data-nav-item=""
        {...(group === null ? {} : { 'data-group-id': group.id })}
        {...(group === null ? { 'data-ungrouped': '' } : {})}
        tabIndex={tabbable ? 0 : -1}
        onClick={() => onToggle(!open)}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => {
          if (onConfig !== undefined) {
            event.preventDefault();
            onConfig({ x: event.clientX, y: event.clientY });
          }
        }}
        {...dnd.header(groupId)}
        className={`group relative flex min-h-[28px] cursor-pointer items-center gap-1.5 px-3 pt-2 text-xs ${overHeader && dnd.dragging?.kind === 'agent' ? 'bg-primary-light' : ''} ${dragged ? 'opacity-50' : ''} ${FOCUS_RING} focus-visible:ring-inset`}
      >
        <DropBar edge={edge} />
        <Chevron aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-muted" />
        <span className={`min-w-0 truncate font-medium ${group?.color === null || group === null ? 'text-muted' : look.text}`} title={name}>
          {name}
        </span>
        <span className="tabular-nums text-muted">{sessions.length}</span>
        {/* Folded: the most urgent state inside, so a closed group still says when something needs you. */}
        {!open && rollup !== undefined ? (
          <Tooltip content={`${STATE_LOOK[rollup].label}: the most urgent state in this group`} side="right">
            <span className="inline-flex">
              <StatusIcon state={rollup} />
            </span>
          </Tooltip>
        ) : null}
        {onConfig !== undefined ? (
          <span className="ml-auto flex shrink-0 items-center">
            <Tooltip content="Group settings: name, order, colors (E)" side="left">
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Settings of the group ${name}`}
                aria-haspopup="dialog"
                onClick={(event) => {
                  event.stopPropagation();
                  const box = event.currentTarget.getBoundingClientRect();
                  onConfig({ x: box.right - 280, y: box.bottom + 2 });
                }}
                className={`inline-flex h-6 w-6 items-center justify-center rounded text-muted opacity-60 hover:bg-muted-bg hover:text-content hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100 ${FOCUS_RING}`}
              >
                <FolderCog aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
              </button>
            </Tooltip>
          </span>
        ) : null}
      </div>
      {open ? (
        <div role="group" aria-label={name}>
          {sessions.length === 0 ? <p className="px-8 py-1.5 text-xs text-muted">{section.id === UNGROUPED_ID ? 'Every agent is in a group.' : 'Empty. Drag an agent here, or press M on an agent.'}</p> : sessions.map((session) => renderRow(session))}
          {/* The strip under the last agent: a drop here puts the agent at the bottom of the group. */}
          <div data-group-end={section.id} {...dnd.end(groupId)} className={`relative ${dnd.dragging?.kind === 'agent' ? 'h-3' : 'h-1'}`}>
            {overEnd ? <span aria-hidden="true" data-drop-indicator="end" className="pointer-events-none absolute inset-x-0 top-1 z-10 h-0.5 bg-primary" /> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
