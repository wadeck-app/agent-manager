import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { AgentRow } from '../data/types.js';
import { customSections, UNGROUPED_ID, type DropContext } from '../logic/customMode.js';
import { stepGroupIds } from '../logic/customGroups.js';
import { HERDR_ROW_BOX, HERDR_ROW_BOX_STACKED, herdrTint, isHerdrDensity, type HerdrDensity, stateTint } from '../logic/herdrRow.js';
import { isTypingTarget } from '../logic/nav.js';
import { agentId } from '../logic/states.js';
import { tabbableId, useListKeys } from '../ui/hooks.js';
import { BODY_LOOK } from '../ui/groupLook.js';
import { useUiVariant } from '../ui/UiVariants.js';
import type { ListProps } from './common.js';
import { CustomGroupBlock } from './CustomGroupBlock.js';
import { DropBar } from './DropBar.js';
import { EmptyNote } from './EmptyNote.js';
import { GroupConfigPanel } from './GroupConfigPanel.js';
import { GroupDialog } from './GroupDialog.js';
import { HerdrRowBody } from './HerdrRowBody.js';
import { isStacked } from './RowSecondary.js';
import { ListScroll } from './ListScroll.js';
import { MoveToGroupDialog } from './MoveToGroupDialog.js';
import { OptionShell } from './OptionShell.js';
import { useRowMenu } from './useRowMenu.js';
import { SubagentRows } from './SubagentRows.js';
import { useCustomDnd } from './useCustomDnd.js';

const DROP_HINT = 'absolute inset-x-0 top-0 z-20 border-b border-warning bg-warning-bg px-3 py-1.5 text-xs text-warning-text shadow-md';

type Anchor = { x: number; y: number };

/**
 * The Custom mode: ALL the live agents inside the user's custom groups (the ones no group claims in a last "Ungrouped" bucket), as the Herdr panel shows them.
 * Rows are the Herdr rows of the A/B question `ui-tree-density` (tinted by default here: a compact choice reads as tinted in this mode); each group has its own
 * order, header color and body color (the folder-cog button). Drag and drop, M (the Move dialog) and Alt+Up / Alt+Down arrange the agents and the groups;
 * a right-click (or the kebab button) flags an agent or marks it unread. Nothing is created for you: with no group the list says to use New group.
 */
export function CustomList({ sessions: shown, selectedId, onSelect, now, query, searching, options, groups, marks, rowActions }: ListProps) {
  // The view option "Show sub-agents under each agent": off, no row has a chevron, children or expansion state (the count chip stays).
  const showSubagents = options.subagents.show;
  const sections = useMemo(() => customSections(shown, groups?.groups ?? []), [shown, groups]);
  const rowsById = useMemo(() => new Map(sections.flatMap((section) => section.sessions).map((row) => [agentId(row), row])), [sections]);
  const hasGroups = (groups?.groups.length ?? 0) > 0;
  const variant = useUiVariant('treeDensity');
  const stackedRows = isStacked(useUiVariant('rowSeparator'));
  // Herdr rows in this mode: the compact Tree choice reads as the tinted Herdr row.
  const density: HerdrDensity = isHerdrDensity(variant) ? variant : 'herdr-tinted';
  const context = useMemo<DropContext>(
    () => ({ groups: sections.flatMap((section) => (section.group === null ? [] : [{ id: section.group.id, sort: section.group.sort }])), membersOf: (id) => (sections.find((section) => section.id === (id ?? UNGROUPED_ID))?.sessions ?? []).map(agentId) }),
    [sections],
  );
  const dnd = useCustomDnd(groups, context);
  const [moving, setMoving] = useState<string | undefined>(undefined);
  const [dialogFor, setDialogFor] = useState<string | undefined>(undefined);
  const [config, setConfig] = useState<{ id: string; anchor: Anchor } | undefined>(undefined);
  // The "..." menu of every row, also opened by a right-click or the context-menu key (see OptionShell): move, flag, unread, pin, mark seen.
  const rowMenu = useRowMenu({ marks, rowActions, onMove: groups === undefined ? undefined : setMoving });
  const refocus = useRef<{ attribute: 'data-session-id' | 'data-group-id'; value: string } | undefined>(undefined);
  // Sections the user opened or closed on this page (the server's collapsed flag decides otherwise; Ungrouped is local).
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  // Agents whose sub-agents the user opened (closed by default: the Custom list is about the agents).
  const [openAgents, setOpenAgents] = useState<Record<string, boolean>>({});
  const isOpen = (id: string): boolean => {
    const section = sections.find((candidate) => candidate.id === id);
    return searching || (overrides[id] ?? (section?.group === null || section === undefined ? true : !section.group.collapsed));
  };
  const toggle = (id: string, open: boolean): void => {
    setOverrides((current) => ({ ...current, [id]: open }));
    const section = sections.find((candidate) => candidate.id === id);
    if (section?.group != null) {
      groups?.update(id, { collapsed: !open });
    }
  };
  // The group of the selected agent opens (a selection by URL or by search must be visible), once per selection.
  useEffect(() => {
    const owner = sections.find((section) => section.sessions.some((row) => agentId(row) === selectedId));
    if (owner !== undefined) {
      setOverrides((current) => (current[owner.id] === undefined ? { ...current, [owner.id]: true } : current));
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
  // Folded groups and (while searching) empty ones are not in the tab order; the Ungrouped bucket only shows when it holds something or a drag may drop there.
  const visibleSections = sections.filter((section) => (searching ? section.sessions.length > 0 : section.id !== UNGROUPED_ID || section.sessions.length > 0 || dnd.dragging?.kind === 'agent'));
  const visibleIds = visibleSections.flatMap((section) => (isOpen(section.id) ? section.sessions.map(agentId) : []));
  const tabbable = tabbableId(visibleIds, selectedId);
  const listKeys = useListKeys({ onSelect });

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const rowElement = (event.target as HTMLElement).closest<HTMLElement>('[data-session-id]');
    const id = rowElement?.dataset['sessionId'];
    const session = id === undefined ? undefined : rowsById.get(id);
    if (groups !== undefined && !isTypingTarget(event.target) && !event.ctrlKey && !event.metaKey) {
      if (!event.altKey && event.key === 'm' && session !== undefined && id !== undefined) {
        event.preventDefault();
        setMoving(id);
        return;
      }
      if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        const step = event.key === 'ArrowUp' ? -1 : 1;
        const header = (event.target as HTMLElement).closest<HTMLElement>('[data-group-id]');
        if (header?.dataset['groupId'] !== undefined && event.target === header) {
          event.preventDefault();
          const ids = stepGroupIds(groups.groups, header.dataset['groupId'], step);
          if (ids !== undefined) {
            refocus.current = { attribute: 'data-group-id', value: header.dataset['groupId'] };
            groups.reorder(ids);
          }
          return;
        }
        const section = session === undefined ? undefined : sections.find((candidate) => candidate.group !== null && candidate.id === session.customGroupId);
        if (id !== undefined && section?.group != null) {
          event.preventDefault();
          if (section.sort !== 'manual') {
            dnd.notify(`This group is ordered ${section.sort === 'urgency' ? 'by urgency' : section.sort === 'name' ? 'by name' : 'by latest change'}: set its order to Manual in the group settings to move agents by hand.`);
            return;
          }
          const members = section.sessions.map(agentId);
          const at = members.indexOf(id);
          const to = at + step;
          if (at >= 0 && to >= 0 && to < members.length) {
            refocus.current = { attribute: 'data-session-id', value: id };
            groups.move(id, section.id, step === -1 ? (members[to] ?? null) : (members[to + 1] ?? null));
          }
          return;
        }
      }
    }
    listKeys(event);
  };

  const renderRow = (session: AgentRow, groupId: string | null, bodyClass: string) => {
    const id = agentId(session);
    const selected = id === selectedId;
    const tint = herdrTint(density, session.state, selected, session.flagged, session.unread);
    const over = dnd.over?.target.kind === 'row' && dnd.over.target.id === id && dnd.over.outcome.kind === 'move' ? dnd.over.outcome : undefined;
    // Before the target when the drop lands before it; after it when the dragged one comes from above and takes its place.
    const edge = over === undefined ? undefined : over.beforeId === id ? 'before' : 'after';
    const dragged = dnd.dragging?.kind === 'agent' && dnd.dragging.id === id;
    const hasChildren = showSubagents && session.subagentCount > 0;
    const open = hasChildren && openAgents[id] === true;
    // The background of an agent: its open look, its state tint (needs you, unseen, flagged), then the body color of its group.
    const base = herdrTint(density, session.state, false, session.flagged, session.unread) ?? bodyClass;
    return (
      <Fragment key={id}>
          <OptionShell
            role="treeitem"
            level={2}
            session={session}
            selected={selected}
            tabbable={id === tabbable}
            onSelect={onSelect}
            look={{ selected: `${tint ?? ''} ${stateTint(session.state, session.flagged, session.unread) === undefined ? bodyClass : ''}`, idle: base === '' ? 'hover:bg-muted-bg' : `${base} hover:brightness-95` }}
            className={`group relative ${stackedRows ? HERDR_ROW_BOX_STACKED : HERDR_ROW_BOX} ${dragged ? 'opacity-50' : ''}`}
            expanded={hasChildren ? open : undefined}
            rowProps={dnd.row(id, groupId)}
            {...(rowMenu.available ? { onMenu: (anchor: Anchor) => rowMenu.open(session, anchor) } : {})}
          >
            <DropBar edge={edge} />
            <HerdrRowBody session={session} density={density} selected={selected} now={now} terms={query.terms} showSlot={showSubagents} subagents={hasChildren ? { open, toggle: () => setOpenAgents((current) => ({ ...current, [id]: !open })) } : undefined} {...(rowMenu.available ? { onMenu: (anchor: Anchor) => rowMenu.open(session, anchor) } : {})} />
          </OptionShell>
        {open ? <SubagentRows sessionId={session.sessionId} /> : null}
      </Fragment>
    );
  };

  if (shown.length === 0) {
    return <EmptyNote title="No session to show" hint="Start Claude Code in a terminal and it appears here within 5 seconds." />;
  }
  const movingSession = moving === undefined ? undefined : rowsById.get(moving);
  const configGroup = config === undefined ? undefined : groups?.groups.find((group) => group.id === config.id);
  const dialogGroup = dialogFor === undefined ? undefined : groups?.groups.find((group) => group.id === dialogFor);
  return (
    <>
      {/* The hint floats over the top of the list: put in the flow it pushed every row down while it showed (a drag moves nothing on the page). */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      {dnd.hint !== '' ? (
        <p role="status" data-drop-hint="" className={DROP_HINT}>
          {dnd.hint}
        </p>
      ) : null}
      <ListScroll label="Agents by custom group" role="tree" onKeyDown={onKeyDown}>
        {!hasGroups && groups !== undefined ? (
          <p className="border-b border-border px-3 py-3 text-sm text-muted">No custom group yet: all the agents are below, ungrouped. Use New group in the toolbar to make one.</p>
        ) : null}
        {visibleSections.map((section, index) => (
          <CustomGroupBlock
            key={section.id}
            section={section}
            open={isOpen(section.id)}
            tabbable={visibleIds.length === 0 && index === 0}
            dnd={dnd}
            onToggle={(open) => toggle(section.id, open)}
            onConfig={section.group === null || groups === undefined ? undefined : (anchor) => setConfig({ id: section.id, anchor })}
            renderRow={(session) => renderRow(session, section.group?.id ?? null, section.group?.bodyColor == null ? '' : BODY_LOOK[section.group.bodyColor])}
          />
        ))}
      </ListScroll>
      </div>
      {groups !== undefined && movingSession !== undefined ? <MoveToGroupDialog session={movingSession} groups={groups} onClose={() => setMoving(undefined)} /> : null}
      {groups !== undefined && dialogGroup !== undefined ? <GroupDialog group={dialogGroup} memberCount={shown.filter((row) => row.customGroupId === dialogGroup.id).length} groups={groups} onClose={() => setDialogFor(undefined)} /> : null}
      {groups !== undefined && config !== undefined && configGroup !== undefined ? (
        <GroupConfigPanel
          key={configGroup.id}
          group={configGroup}
          anchor={config.anchor}
          groups={groups}
          onClose={() => setConfig(undefined)}
          onMore={() => {
            setDialogFor(configGroup.id);
            setConfig(undefined);
          }}
        />
      ) : null}
      {rowMenu.element}
    </>
  );
}

