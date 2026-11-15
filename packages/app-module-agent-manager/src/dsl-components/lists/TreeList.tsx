import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { agentId } from '../logic/states.js';
import { buildTree, quietFolders, type FolderNode } from '../logic/tree.js';
import { FOCUS_RING } from '../ui/IconButton.js';
import { STATE_LOOK } from '../ui/stateLook.js';
import { StatusIcon } from '../ui/StatusIcon.js';
import { Tooltip } from '../ui/Tooltip.js';
import { tabbableId, useListKeys } from '../ui/hooks.js';
import { RollupDots } from './RollupDots.js';
import { detailLine, type ListProps } from './common.js';
import { EmptyNote } from './EmptyNote.js';
import { ListScroll } from './ListScroll.js';
import { OptionShell } from './OptionShell.js';
import { ProjectLabel } from './ProjectLabel.js';
import { RowMarks } from './RowMarks.js';
import { StateIconTip } from './StateIconTip.js';
import { SubagentRows } from './SubagentRows.js';
import { TimeInState } from './TimeInState.js';

/**
 * Folders (working directories) as parents, their sessions beneath. A folder shows the worst state of its sessions (needs you wins over working).
 * Sub-variants: `expanded` every folder open; `attention` folders that do not need you start closed; `rollup` every folder starts closed and shows a
 * dot and a count per state. A folder you opened or closed by hand keeps your choice; a folder holding the selected session is opened.
 * A session that started sub-agents has a chevron (and ArrowRight / ArrowLeft): opening it fetches its sub-agent tree (the log route sends it) and nests the
 * sub-agents under it. They are listed, not selectable: the sub-agent logs are not served.
 */
export function TreeList({ sessions, selectedId, onSelect, now, style }: ListProps) {
  const nodes = useMemo(() => buildTree(sessions), [sessions]);
  const quiet = useMemo(() => new Set(quietFolders(nodes)), [nodes]);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const isOpen = (node: FolderNode): boolean => overrides[node.cwd] ?? (style === 'expanded' ? true : style === 'attention' ? !quiet.has(node.cwd) : false);

  // The folder of the selected session is opened (a selection by URL or by search must be visible), once per selection.
  useEffect(() => {
    const owner = nodes.find((node) => node.sessions.some((session) => agentId(session) === selectedId));
    if (owner !== undefined) {
      setOverrides((current) => (current[owner.cwd] === undefined ? { ...current, [owner.cwd]: true } : current));
    }
  }, [selectedId, nodes]);

  // Not memoised on purpose: it reads isOpen, which closes over the overrides and the style.
  const visibleIds = nodes.flatMap((node) => (isOpen(node) ? node.sessions.map(agentId) : []));
  const tabbable = tabbableId(visibleIds, selectedId);
  const listKeys = useListKeys({ onSelect });
  // Sessions with sub-agents the user opened (lazily fetched when the row opens).
  const [openAgents, setOpenAgents] = useState<Record<string, boolean>>({});
  const toggleAgents = (sessionId: string, open: boolean): void => setOpenAgents((current) => ({ ...current, [sessionId]: open }));
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-session-id]');
    const id = row?.dataset['sessionId'];
    const session = id === undefined ? undefined : sessions.find((candidate) => agentId(candidate) === id);
    if (id !== undefined && session !== undefined && session.subagentCount > 0 && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
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

  if (nodes.length === 0) {
    return <EmptyNote title="No session to show" hint="Start Claude Code in a terminal and it appears here within 5 seconds." />;
  }
  return (
    <ListScroll label="Agents by folder" role="tree" onKeyDown={onKeyDown}>
      {nodes.map((node) => {
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
              tabIndex={visibleIds.length === 0 && node === nodes[0] ? 0 : -1}
              onClick={() => toggle(node, !open)}
              onKeyDown={(event) => onFolderKey(event, node)}
              className={`flex cursor-pointer items-center gap-1.5 px-2 py-2 text-sm hover:bg-muted-bg ${FOCUS_RING} focus-visible:ring-inset`}
            >
              <Chevron aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-muted" />
              <FolderIcon aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-muted" />
              <span className="truncate font-semibold text-content" title={node.cwd}>
                {node.folder}
              </span>
              {node.disambiguation !== '' ? (
                <span className="truncate text-xs text-muted" title={node.disambiguation}>
                  {node.disambiguation}
                </span>
              ) : null}
              <span className="ml-auto flex shrink-0 items-center gap-2">
                {!open && style === 'rollup' ? null : <span className="text-xs tabular-nums text-muted">{node.sessions.length}</span>}
                {!open && style === 'rollup' ? (
                  <RollupDots node={node} />
                ) : (
                  <Tooltip content={`${STATE_LOOK[node.rollup].label}: the most urgent state in this folder`} side="left">
                    <span className="inline-flex">
                      <StatusIcon state={node.rollup} />
                    </span>
                  </Tooltip>
                )}
              </span>
            </div>
            {open ? (
              <div role="group">
                {node.sessions.map((session) => {
                  const id = agentId(session);
                  const line = detailLine(session);
                  return (
                    <Fragment key={id}>
                    <OptionShell role="treeitem" level={2} session={session} selected={id === selectedId} tabbable={id === tabbable} onSelect={onSelect} className="min-h-am-hit py-2 pl-5 pr-3" expanded={session.subagentCount > 0 ? openAgents[id] === true : undefined}>
                      <div className="flex items-center gap-2">
                        {session.subagentCount > 0 ? (
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-label={openAgents[id] === true ? `Hide the ${session.subagentCount} sub-agents` : `Show the ${session.subagentCount} sub-agents`}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleAgents(id, openAgents[id] !== true);
                            }}
                            className={`inline-flex h-am-icon-sm w-am-icon-sm shrink-0 items-center justify-center rounded text-muted hover:text-content ${FOCUS_RING}`}
                          >
                            {openAgents[id] === true ? <ChevronDown aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" /> : <ChevronRight aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />}
                          </button>
                        ) : (
                          <span aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0" />
                        )}
                        <StateIconTip session={session} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-content" title={session.displayName}>
                            {session.displayName}
                          </span>
                          {line !== '' ? (
                            <span className="block truncate text-xs text-muted" title={line}>
                              {line}
                            </span>
                          ) : null}
                        </span>
                        <RowMarks session={session} />
                        <TimeInState session={session} now={now} />
                      </div>
                    </OptionShell>
                    {openAgents[id] === true ? <SubagentRows sessionId={session.sessionId} /> : null}
                    </Fragment>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </ListScroll>
  );
}
