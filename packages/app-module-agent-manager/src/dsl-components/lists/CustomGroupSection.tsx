import { Tooltip } from '@wadeck-app/dsl-ui';
import { ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { AgentRow } from '../data/types.js';
import type { GroupSection } from '../logic/customGroups.js';
import { FOCUS_RING } from '../ui/focusRing.js';
import { GROUP_LOOK } from '../ui/groupLook.js';
import { GroupHeaderName, groupHeaderBox, groupHeaderCount } from '../ui/groupHeaderLook.js';
import { StatusColumn } from '../ui/StatusColumn.js';
import { useUiVariant } from '../ui/UiVariants.js';
import { DropBar } from './DropBar.js';
import { RollupLight } from './RollupLight.js';
import { GroupDot } from './GroupDot.js';
import { GroupSelectBox } from './GroupSelectBox.js';
import type { GroupDnd } from './useGroupDnd.js';
import { RowIconButton } from './RowIconButton.js';

export interface CustomGroupSectionProps {
  section: GroupSection;
  open: boolean;
  /** Holds the tab stop of the list (nothing else is focusable: every group is empty or closed and so is every folder). */
  tabbable: boolean;
  dnd: GroupDnd;
  onToggle: (open: boolean) => void;
  onEdit: () => void;
  renderRow: (session: AgentRow) => ReactNode;
}

/**
 * One custom group of the Tree: a header (open or close, drag to reorder the groups, edit) and its agents. An empty group says what to do. Enter and Space
 * toggle, ArrowRight and ArrowLeft open and close, E edits, Alt+Up and Alt+Down move the group (handled by the list).
 */
export function CustomGroupSection({ section, open, tabbable, dnd, onToggle, onEdit, renderRow }: CustomGroupSectionProps) {
  const { group, sessions, rollup } = section;
  const headerStyle = useUiVariant('groupHeader');
  const look = GROUP_LOOK[group.color ?? 'none'];
  // The three looks of the A/B question ui-group-header; classes written in full.
  const headerLook = groupHeaderBox(headerStyle, look.edge);
  const Chevron = open ? ChevronDown : ChevronRight;
  const edge = dnd.over?.kind === 'header' && dnd.over.id === group.id ? (dnd.over.after ? 'after' : 'before') : undefined;
  const into = dnd.over?.kind === 'section' && dnd.over.id === group.id;
  const dragged = dnd.dragging?.kind === 'group' && dnd.dragging.id === group.id;
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // The keys of a button or field inside the header are theirs.
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
    } else if (event.key === 'e') {
      event.preventDefault();
      onEdit();
    }
  };
  return (
    <div role="none" data-custom-group={group.id} {...dnd.section(group)} className={into ? 'ring-2 ring-inset ring-primary' : ''}>
      <div
        role="treeitem"
        aria-level={1}
        aria-expanded={open}
        aria-selected={false}
        data-nav-item=""
        data-group-id={group.id}
        tabIndex={tabbable ? 0 : -1}
        onClick={() => onToggle(!open)}
        onKeyDown={onKeyDown}
        {...dnd.header(group)}
        className={`group relative flex cursor-pointer items-center gap-1.5 hover:bg-muted-bg ${headerLook} ${dragged ? 'opacity-50' : ''} ${FOCUS_RING} focus-visible:ring-inset`}
      >
        <DropBar edge={edge} />
        {/* Selection mode only: the first item of the header, at the x of the boxes of the rows. */}
        <GroupSelectBox ids={sessions.map((session) => session.sessionId.toLowerCase())} name={group.name} />
        <Chevron aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted" />
        <GroupDot color={group.color} />
        <GroupHeaderName variant={headerStyle} text={group.name} textClass={look.text} />
        <span className={groupHeaderCount(headerStyle)}>{sessions.length}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <Tooltip content="Edit the group: name, color, order, delete (E)" side="left">
            <RowIconButton label={`Edit the group ${group.name}`} onClick={() => onEdit()} icon={<Pencil aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />} />
          </Tooltip>
          {rollup !== undefined ? (
            <RollupLight state={rollup} subject="group" />
          ) : (
            <StatusColumn>{null}</StatusColumn>
          )}
        </span>
      </div>
      {open ? (
        <div role="group" aria-label={group.name}>
          {sessions.length === 0 ? (
            <p className="px-8 py-2 text-xs text-muted">Empty group. Drag an agent here, or press M on an agent and choose this group.</p>
          ) : (
            sessions.map((session) => renderRow(session))
          )}
        </div>
      ) : null}
    </div>
  );
}
