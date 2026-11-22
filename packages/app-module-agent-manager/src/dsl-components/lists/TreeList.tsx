import { ChevronDown, ChevronRight, Folder, FolderInput, FolderOpen } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { partitionByGroup, stepGroupIds } from '../logic/customGroups.js';
import { herdrTint, isHerdrDensity } from '../logic/herdrRow.js';
import { isTypingTarget } from '../logic/nav.js';
import { agentId } from '../logic/states.js';
import { buildTree, flatByUrgency, quietFolders, type FolderNode } from '../logic/tree.js';
import type { AgentRow } from '../data/types.js';
import { FOCUS_RING } from '../ui/focusRing.js';
import { STATE_LOOK } from '../ui/stateLook.js';
import { GroupHeaderName, groupHeaderBar, groupHeaderCount } from '../ui/groupHeaderLook.js';
import { GROUP_LOOK } from '../ui/groupLook.js';
import { StatusIcon } from '../ui/StatusIcon.js';
import { Tooltip } from '../ui/Tooltip.js';
import { useUiVariant } from '../ui/UiVariants.js';
import { tabbableId, useListKeys } from '../ui/hooks.js';
import { detailLine, type ListProps } from './common.js';
import { EmptyNote } from './EmptyNote.js';
import { HerdrRowBody } from './HerdrRowBody.js';
import { Highlight } from './Highlight.js';
import { CustomGroupSection } from './CustomGroupSection.js';
import { DropBar } from './DropBar.js';
import { GroupDialog } from './GroupDialog.js';
import { GroupSelectBox } from './GroupSelectBox.js';
import { ListScroll } from './ListScroll.js';
import { MoveToGroupDialog } from './MoveToGroupDialog.js';
import { OptionShell } from './OptionShell.js';
import { ProjectLabel } from './ProjectLabel.js';
import { RowMarks } from './RowMarks.js';
import { StateIconTip } from './StateIconTip.js';
import { SubagentRows } from './SubagentRows.js';
import { TimeInState } from './TimeInState.js';
import { useGroupDnd } from './useGroupDnd.js';

/** The agents that want you: the ones whose sub-agents open by themselves in the `attention` expansion. */
function wantsYou(session: AgentRow): boolean {
  return session.state === 'needs-you' || session.state === 'done';
}

/**
 * The agents as a tree. Option `grouping`: `workspace` puts the working directories (folders) as parents, each showing the worst state of its agents; `none`
 * is a flat list of agents (most urgent first) with the folder in the row. Option `expansion`: `all` opens every folder; `attention` opens only the folders that
 * hold something that needs you (Needs you, Done, unknown status) and opens the sub-agents of the agents that want you. A folder you opened or closed by
 * hand keeps your choice; the folder of the selected agent is opened; while searching every folder is open (the choice comes back when the search ends).
 * An agent that started sub-agents has a chevron (and ArrowRight / ArrowLeft): opening it fetches its sub-agent tree (the log route sends it) and nests the
 * sub-agents under it. They are listed, not selectable: the sub-agent logs are not served.
 */
export function TreeList({ sessions: shown, selectedId, onSelect, now, query, searching, options, groups }: ListProps) {
  const { grouping, expansion } = options.tree;
  // The view option "Show sub-agents under each agent": off, no row has a chevron, children or expansion state (the count chip stays).
  const showSubagents = options.subagents.show;
  // The custom groups come first; what no group claims is the automatic tree (by workspace, or flat) below them.
  const { sections, ungrouped: sessions } = useMemo(() => partitionByGroup(shown, groups?.groups ?? [], searching), [shown, groups, searching]);
  const hasGroups = (groups?.groups.length ?? 0) > 0;
  const dnd = useGroupDnd(groups);
  const density = useUiVariant('treeDensity');
  // The look of the headers of the folders (the A/B question ui-group-header applies to them as well as to the custom groups).
  const headerStyle = useUiVariant('groupHeader');
  const [moving, setMoving] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<string | undefined>(undefined);
  // The element to focus once the list was redrawn after a keyboard move (the row or header moved in the DOM and the browser drops its focus).
  const refocus = useRef<{ attribute: 'data-session-id' | 'data-group-id'; value: string } | undefined>(undefined);
  // Groups the user opened or closed on this page; without a choice the server's collapsed flag decides (and, in the attention expansion, what needs you).
  const [groupOverrides, setGroupOverrides] = useState<Record<string, boolean>>({});
  const nodes = useMemo(() => buildTree(sessions), [sessions]);
  const flat = useMemo(() => flatByUrgency(sessions), [sessions]);
  const quiet = useMemo(() => new Set(quietFolders(nodes)), [nodes]);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  // While searching every folder is open, whatever was closed by hand: a match inside a closed folder would be invisible (and skipped by the keyboard).
  const isOpen = (node: FolderNode): boolean => searching || (overrides[node.cwd] ?? (expansion === 'all' ? true : !quiet.has(node.cwd)));

  // The folder of the selected agent is opened (a selection by URL or by search must be visible), once per selection.
  useEffect(() => {
    const owner = nodes.find((node) => node.sessions.some((session) => agentId(session) === selectedId));
    if (owner !== undefined) {
      setOverrides((current) => (current[owner.cwd] === undefined ? { ...current, [owner.cwd]: true } : current));
    }
  }, [selectedId, nodes]);
  useEffect(() => {
    const owner = sections.find((section) => section.sessions.some((session) => agentId(session) === selectedId));
    if (owner !== undefined) {
      setGroupOverrides((current) => (current[owner.group.id] === undefined ? { ...current, [owner.group.id]: true } : current));
    }
  }, [selectedId, sections]);
  useEffect(() => {
    const target = refocus.current;
    if (target !== undefined) {
      const element = document.querySelector<HTMLElement>(`[${target.attribute}="${CSS.escape(target.value)}"]`);
      if (element !== null) {
        element.focus();
        refocus.current = undefined;
      }
    }
  });
  // A search opens every group (a match inside a closed one would be invisible). A group that needs attention stays open in the attention expansion.
  const groupOpen = (section: (typeof sections)[number]): boolean =>
    searching || (groupOverrides[section.group.id] ?? (expansion === 'attention' && (section.rollup === 'needs-you' || section.rollup === 'done' || section.rollup === 'other') ? true : !section.group.collapsed));
  const toggleGroup = (id: string, open: boolean): void => {
    setGroupOverrides((current) => ({ ...current, [id]: open }));
    groups?.update(id, { collapsed: !open });
  };

  // Not memoised on purpose: it reads isOpen, which closes over the overrides and the options.
  const visibleIds = [...sections.flatMap((section) => (groupOpen(section) ? section.sessions.map(agentId) : [])), ...(grouping === 'none' ? flat.map(agentId) : nodes.flatMap((node) => (isOpen(node) ? node.sessions.map(agentId) : [])))];
  const tabbable = tabbableId(visibleIds, selectedId);
  const listKeys = useListKeys({ onSelect });
  // Agents whose sub-agents the user opened or closed by hand; without a choice the expansion option decides.
  const [openAgents, setOpenAgents] = useState<Record<string, boolean>>({});
  const agentsOpen = (session: AgentRow): boolean => openAgents[agentId(session)] ?? (expansion === 'attention' && wantsYou(session));
  const toggleAgents = (sessionId: string, open: boolean): void => setOpenAgents((current) => ({ ...current, [sessionId]: open }));
  // M opens the Move dialog of the focused agent; Alt+Up and Alt+Down move the focused agent inside its group, or the focused group among the groups.
  const keyboardGroupMove = (event: KeyboardEvent<HTMLElement>, id: string | undefined, session: AgentRow | undefined): boolean => {
    if (groups === undefined) {
      return false;
    }
    if (!event.altKey && event.key === 'm' && id !== undefined && session !== undefined) {
      event.preventDefault();
      setMoving(id);
      return true;
    }
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) {
      return false;
    }
    const step = event.key === 'ArrowUp' ? -1 : 1;
    const header = (event.target as HTMLElement).closest<HTMLElement>('[data-group-id]');
    if (header?.dataset['groupId'] !== undefined && event.target === header) {
      event.preventDefault();
      const ids = stepGroupIds(groups.groups, header.dataset['groupId'], step);
      if (ids !== undefined) {
        refocus.current = { attribute: 'data-group-id', value: header.dataset['groupId'] };
        groups.reorder(ids);
      }
      return true;
    }
    const section = session?.customGroupId === null || session === undefined ? undefined : sections.find((candidate) => candidate.group.id === session.customGroupId);
    if (id !== undefined && section !== undefined) {
      event.preventDefault();
      const members = section.sessions.map(agentId);
      const at = members.indexOf(id);
      const to = at + step;
      if (at >= 0 && to >= 0 && to < members.length) {
        refocus.current = { attribute: 'data-session-id', value: id };
        // Up: before the previous member. Down: before the one after the next (the end of the group when there is none).
        groups.move(id, section.group.id, step === -1 ? (members[to] ?? null) : (members[to + 1] ?? null));
      }
      return true;
    }
    return false;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-session-id]');
    const id = row?.dataset['sessionId'];
    const session = id === undefined ? undefined : shown.find((candidate) => agentId(candidate) === id);
    if (groups !== undefined && !isTypingTarget(event.target) && !event.ctrlKey && !event.metaKey && keyboardGroupMove(event, id, session)) {
      return;
    }
    if (showSubagents && id !== undefined && session !== undefined && session.subagentCount > 0 && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault();
      toggleAgents(id, event.key === 'ArrowRight');
      return;
    }
    listKeys(event);
  };

  const toggle = (node: FolderNode, open: boolean): void => setOverrides((current) => ({ ...current, [node.cwd]: open }));
  const onFolderKey = (event: KeyboardEvent<HTMLDivElement>, node: FolderNode): void => {
    const open = isOpen(node);
    if (event.key === 'ArrowRight' && !open) {
      event.preventDefault();
      toggle(node, true);
    } else if (event.key === 'ArrowLeft' && open) {
      event.preventDefault();
      toggle(node, false);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      toggle(node, !open);
    }
  };

  const agentRow = (session: AgentRow, level: 1 | 2, showFolder: boolean, members?: readonly string[]) => {
    const id = agentId(session);
    const edge = dnd.over?.kind === 'row' && dnd.over.id === id ? (dnd.over.after ? 'after' : 'before') : undefined;
    const dragged = dnd.dragging?.kind === 'agent' && dnd.dragging.id === id;
    const line = detailLine(session);
    const hasChildren = showSubagents && session.subagentCount > 0;
    const open = hasChildren && agentsOpen(session);
    const herdr = isHerdrDensity(density);
    const selected = id === selectedId;
    const tint = herdrTint(density, session.state, selected, session.flagged, session.unread);
    const nameLine = showFolder ? (
      <ProjectLabel session={session} terms={query.terms} />
    ) : (
      <span className="block truncate text-content" title={session.displayName}>
        <Highlight text={session.displayName} terms={query.terms} />
      </span>
    );
    return (
      <Fragment key={id}>
        <OptionShell
          role="treeitem"
          level={level}
          session={session}
          selected={selected}
          tabbable={id === tabbable}
          onSelect={onSelect}
          {...(herdr && density === 'herdr-tinted' ? { look: { selected: `border-l-2 border-transparent ${tint ?? ''}`, idle: `border-l-2 border-transparent ${tint ?? 'hover:bg-muted-bg'}` } } : {})}
          className={`group relative ${herdr ? 'h-[31px] py-0 pr-2' : 'min-h-am-hit py-1 pr-3'} ${level === 2 ? 'pl-5' : 'pl-3'} ${dragged ? 'opacity-50' : ''}`}
          expanded={hasChildren ? open : undefined}
          rowProps={dnd.row(id, session.customGroupId, members)}
        >
          <DropBar edge={edge} />
          {herdr ? (
            <HerdrRowBody
              session={session}
              density={density}
              now={now}
              terms={query.terms}
              showSlot={showSubagents}
              subagents={hasChildren ? { open, toggle: () => toggleAgents(id, !open) } : undefined}
              onMove={groups === undefined ? undefined : () => setMoving(id)}
            />
          ) : (
            <div className="flex items-center gap-2">
              {hasChildren ? (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={open ? `Hide the ${session.subagentCount} sub-agents` : `Show the ${session.subagentCount} sub-agents`}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleAgents(id, !open);
                  }}
                  className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-tint hover:bg-muted-bg hover:text-content ${FOCUS_RING}`}
                >
                  {open ? <ChevronDown aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" /> : <ChevronRight aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />}
                </button>
              ) : showSubagents ? (
                <span aria-hidden="true" className="h-6 w-6 shrink-0" />
              ) : null}
              <StateIconTip session={session} />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5" title={line === '' ? undefined : line}>
                  <span className="min-w-0 flex-1">{nameLine}</span>
                  <RowMarks session={session} iconOnly />
                </span>
              </span>
              {groups !== undefined ? (
                <Tooltip content="Move to a group (M)" side="left">
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`Move ${session.displayName} to a group`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setMoving(id);
                    }}
                    className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-tint opacity-0 hover:bg-muted-bg hover:text-content focus-visible:opacity-100 group-hover:opacity-100 ${FOCUS_RING}`}
                  >
                    <FolderInput aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
                  </button>
                </Tooltip>
              ) : null}
              <TimeInState session={session} now={now} />
            </div>
          )}
        </OptionShell>
        {open ? <SubagentRows sessionId={session.sessionId} /> : null}
      </Fragment>
    );
  };

  if (shown.length === 0) {
    return <EmptyNote title="No session to show" hint="Start Claude Code in a terminal and it appears here within 5 seconds." />;
  }
  const groupRows = sections.map((section, index) => (
    <CustomGroupSection
      key={section.group.id}
      section={section}
      open={groupOpen(section)}
      tabbable={visibleIds.length === 0 && index === 0}
      dnd={dnd}
      onToggle={(open) => toggleGroup(section.group.id, open)}
      onEdit={() => setEditing(section.group.id)}
      renderRow={(session) => agentRow(session, 2, false, section.sessions.map(agentId))}
    />
  ));
  const automatic =
    grouping === 'none'
      ? flat.map((session) => agentRow(session, 1, true))
      : nodes.map((node) => {
          const open = isOpen(node);
          const Chevron = open ? ChevronDown : ChevronRight;
          const FolderIcon = open ? FolderOpen : Folder;
          return (
            <div key={node.cwd} role="none">
              <div
                role="treeitem"
                aria-level={1}
                aria-expanded={open}
                aria-selected={false}
                data-nav-item=""
                tabIndex={visibleIds.length === 0 && sections.length === 0 && node === nodes[0] ? 0 : -1}
                onClick={() => toggle(node, !open)}
                onKeyDown={(event) => onFolderKey(event, node)}
                className={`group flex cursor-pointer items-center gap-1.5 px-2 py-2 text-sm hover:bg-muted-bg ${groupHeaderBar(headerStyle, GROUP_LOOK.none.edge)} ${FOCUS_RING} focus-visible:ring-inset`}
              >
                <Chevron aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-muted" />
                <FolderIcon aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-muted" />
                <GroupHeaderName variant={headerStyle} text={node.folder} textClass={GROUP_LOOK.none.text} title={node.cwd} />
                {node.disambiguation !== '' ? (
                  <span className="truncate text-xs text-muted" title={node.disambiguation}>
                    {node.disambiguation}
                  </span>
                ) : null}
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  <GroupSelectBox ids={node.sessions.map(agentId)} name={node.folder} />
                  <span className={`text-xs tabular-nums text-muted ${groupHeaderCount(headerStyle)}`}>{node.sessions.length}</span>
                  <Tooltip content={`${STATE_LOOK[node.rollup].label}: the most urgent state in this folder`} side="left">
                    <span className="inline-flex">
                      <StatusIcon state={node.rollup} />
                    </span>
                  </Tooltip>
                </span>
              </div>
              {open ? <div role="group">{node.sessions.map((session) => agentRow(session, 2, false))}</div> : null}
            </div>
          );
        });
  const movingSession = moving === undefined ? undefined : shown.find((session) => agentId(session) === moving);
  const editingGroup = editing === undefined ? undefined : groups?.groups.find((group) => group.id === editing);
  const dialogs = (
    <>
      {groups !== undefined && movingSession !== undefined ? <MoveToGroupDialog session={movingSession} groups={groups} onClose={() => setMoving(undefined)} /> : null}
      {groups !== undefined && editingGroup !== undefined ? (
        <GroupDialog group={editingGroup} memberCount={shown.filter((session) => session.customGroupId === editingGroup.id).length} groups={groups} onClose={() => setEditing(undefined)} />
      ) : null}
    </>
  );
  if (!hasGroups) {
    return (
      <>
        <ListScroll label={grouping === 'none' ? 'Agents' : 'Agents by folder'} role="tree" onKeyDown={onKeyDown}>
          {automatic}
        </ListScroll>
        {dialogs}
      </>
    );
  }
  const ungroupedOver = dnd.over?.kind === 'ungrouped';
  return (
    <>
      <ListScroll label="Agents by group" role="tree" onKeyDown={onKeyDown}>
        {groupRows}
        <div role="group" aria-label="Ungrouped" data-ungrouped="" {...dnd.ungrouped()} className={`min-h-am-hit ${ungroupedOver ? 'ring-2 ring-inset ring-primary' : ''}`}>
          <p className="border-t border-border px-3 pb-1 pt-3 text-xs font-medium text-muted">{grouping === 'none' ? 'Ungrouped' : 'Ungrouped, by workspace'}</p>
          {sessions.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">{searching ? 'No ungrouped agent matches.' : 'Every agent is in a group. Drop one here to take it out of its group.'}</p>
          ) : (
            automatic
          )}
        </div>
      </ListScroll>
      {dialogs}
    </>
  );
}
