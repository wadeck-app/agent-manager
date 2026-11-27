import { IconButton } from '@wadeck-app/dsl-ui';
import { Bot, PanelRightClose, PanelRightOpen, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { AUTO_ML_FROM_PX, Tooltip, useMediaQuery, useMinWidth, type AgentRow } from '../deps.js';
import { PermissionsPanel } from '../permissions/PermissionsPanel.js';
import type { SessionGrantsFeed } from '../permissions/useSessionGrants.js';
import { CountChips } from './CountChips.js';
import { RailTabButton } from './RailTabButton.js';
import { ShieldWithBadge } from './ShieldWithBadge.js';
import { countStatuses, STATUS_LOOK } from './subagentModel.js';
import { SubagentsTitle } from './SubagentsTitle.js';
import { SubagentsView, type SubagentsViewProps } from './SubagentsView.js';
import type { LocatePhase } from './useLocateCall.js';

const COLLAPSED_ASIDE = 'flex min-h-0 w-am-hit shrink-0 flex-col items-center gap-2 border-l border-border py-1';
const PROBLEM_ALERT = 'flex items-start gap-1.5 border-b border-warning bg-warning-bg px-3 py-1.5 text-xs text-warning-text';

/** The two tabs of the right rail. */
export type RailTab = 'subagents' | 'permissions';

export interface SubagentAsideProps extends SubagentsViewProps {
  /** The session of the log: the Permissions tab lists its bypasses. */
  session: AgentRow;
  /** The bypasses of the session and of its project (read by the log, so the badge shows while the tab is closed). */
  grants: SessionGrantsFeed;
  tab: RailTab;
  onTab: (tab: RailTab) => void;
  collapsed: boolean;
  onCollapsed: (collapsed: boolean) => void;
  /** Set when the saved settings of the panel could not be read or saved: shown, with a way to dismiss it. */
  problem: string;
  onDismissProblem: () => void;
}


/** Under this width (the one where the text scale `auto` steps up from M) the open panel is narrower, so the log keeps its room: one constant for both. */
export const ASIDE_WIDE_MIN_PX = AUTO_ML_FROM_PX;
const ASIDE_WIDTH = { wide: 'w-am-aside', narrow: 'w-64' } as const;

/** What the log is doing for the selected sub-agent, in words (the rail has no room for the row that says it). */
function phaseWords(phase: LocatePhase): string {
  switch (phase) {
    case 'searching':
      return 'looking for its call';
    case 'found':
      return 'showing its call';
    case 'missing':
      return 'call not found';
    case 'error':
      return 'search failed';
    case 'idle':
      return 'selected';
  }
}

/**
 * The right rail of the detail: the sub-agents and the permissions (the bypasses of the session). Open: a column beside the log (narrower under ASIDE_WIDE_MIN_PX)
 * with the title and counts of the tab shown, the two tab buttons, a button that collapses it, then the tab. Collapsed: a slim rail that keeps the total, the
 * counts of the sub-agents that are active, failed or of unknown status, the state of the selected one and the Permissions button with its badge, so the panel is
 * never invisible, and a button that opens it. The choice is remembered by the caller.
 */
export function SubagentAside({ collapsed, onCollapsed, problem, onDismissProblem, session, grants, tab, onTab, ...view }: SubagentAsideProps) {
  const counts = countStatuses(view.items);
  const wide = useMinWidth(ASIDE_WIDE_MIN_PX);
  // On a phone the open rail floats over the log (it would leave the log a sliver beside it).
  const phone = useMediaQuery('(max-width: 599px)');
  const total = `${counts.total} sub-agent${counts.total === 1 ? '' : 's'}`;
  const bypasses = grants.view?.active;
  const permissionsLabel = bypasses === undefined ? 'Permissions' : `Permissions: ${bypasses} active bypass${bypasses === 1 ? '' : 'es'}`;
  // The region is named after the tab it shows.
  const ariaLabel = tab === 'permissions' ? 'Permissions' : 'Sub-agents';
  if (collapsed) {
    const selected = view.selectedId === undefined ? undefined : view.items.find((item) => item.dto.agentId === view.selectedId);
    const look = selected === undefined ? undefined : STATUS_LOOK[selected.status];
    const SelectedIcon = look?.icon;
    const selectedName = selected === undefined ? '' : `Selected: ${selected.title}, ${look?.label.toLowerCase() ?? ''}, ${phaseWords(view.phase)}`;
    return (
      <aside aria-label={ariaLabel} className={COLLAPSED_ASIDE}>
        <IconButton aria-label={tab === 'permissions' ? `Show the permissions panel (${permissionsLabel})` : `Show the sub-agents panel (${total})`} aria-expanded={false} onClick={() => onCollapsed(false)} icon={<PanelRightOpen aria-hidden="true" className="h-4 w-4" />} />
        <span aria-hidden="true" className="flex flex-col items-center gap-1 text-xs text-muted">
          <Bot className="h-am-icon-sm w-am-icon-sm" />
          <span className="tabular-nums text-content">{counts.total}</span>
        </span>
        <CountChips counts={counts} vertical />
        {SelectedIcon !== undefined && look !== undefined ? (
          <Tooltip content={selectedName} side="left" describe={false}>
            <span role="img" aria-label={selectedName} className={`inline-flex rounded-full border-2 border-primary p-0.5 ${look.text}`}>
              <SelectedIcon aria-hidden="true" className={`h-am-icon-sm w-am-icon-sm ${look.iconClass}`} />
            </span>
          </Tooltip>
        ) : null}
        <IconButton
          aria-label={permissionsLabel}
          onClick={() => {
            onTab('permissions');
            onCollapsed(false);
          }}
          className="relative"
          icon={<ShieldWithBadge count={bypasses} />}
        />
        {problem !== '' ? (
          <Tooltip content={problem} side="left" describe={false}>
            <span role="img" aria-label={problem} className="text-warning-text">
              <TriangleAlert aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
            </span>
          </Tooltip>
        ) : null}
      </aside>
    );
  }
  return (
    <aside aria-label={ariaLabel} className={`flex min-h-0 shrink-0 flex-col border-l border-border ${phone ? 'absolute inset-y-0 right-0 z-10 w-[min(20rem,92%)] bg-surface shadow-lg' : wide ? ASIDE_WIDTH.wide : ASIDE_WIDTH.narrow}`}>
      <div className="flex shrink-0 items-center justify-between gap-1 border-b border-border pl-3">
        <h3 className="min-w-0 flex-1">
          {tab === 'subagents' ? (
            <SubagentsTitle counts={counts} />
          ) : (
            <span className="flex items-center gap-2 text-xs font-medium text-content">
              <ShieldCheck aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-muted" />
              Permissions
            </span>
          )}
        </h3>
        <div role="group" aria-label="Panel tabs" className="flex shrink-0 items-center">
          <RailTabButton active={tab === 'subagents'} label={`Sub-agents tab: ${total}`} onClick={() => onTab('subagents')}>
            <Bot aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          </RailTabButton>
          <RailTabButton active={tab === 'permissions'} label={permissionsLabel} onClick={() => onTab('permissions')}>
            <ShieldWithBadge count={bypasses} />
          </RailTabButton>
        </div>
        <IconButton aria-label={tab === 'permissions' ? 'Collapse the permissions panel' : 'Collapse the sub-agents panel'} aria-expanded onClick={() => onCollapsed(true)} icon={<PanelRightClose aria-hidden="true" className="h-4 w-4" />} />
      </div>
      {problem !== '' ? (
        <div role="alert" className={PROBLEM_ALERT}>
          <p className="min-w-0 flex-1">{problem}</p>
          <IconButton size="icon-xs" aria-label="Dismiss the note about the panel settings" onClick={onDismissProblem} icon={<X aria-hidden="true" className="h-3 w-3" />} />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {tab === 'permissions' ? (
          <PermissionsPanel session={session} feed={grants} />
        ) : view.items.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted">{view.note === '' ? 'This session has no sub-agents.' : view.note}</p>
        ) : (
          <SubagentsView {...view} />
        )}
      </div>
    </aside>
  );
}
