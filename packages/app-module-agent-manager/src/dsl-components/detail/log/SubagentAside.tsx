import { IconButton } from '@wadeck-app/dsl-ui';
import { Bot, PanelRightClose, PanelRightOpen, TriangleAlert, X } from 'lucide-react';
import { AUTO_ML_FROM_PX, FOCUS_RING, Tooltip, useMinWidth } from '../deps.js';
import { CountChips } from './CountChips.js';
import { countStatuses, STATUS_LOOK } from './subagentModel.js';
import { SubagentsTitle } from './SubagentsTitle.js';
import { SubagentsView, type SubagentsViewProps } from './SubagentsView.js';
import type { LocatePhase } from './useLocateCall.js';

export interface SubagentAsideProps extends SubagentsViewProps {
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
 * The side panel of the sub-agents, at every window width. Open: a column beside the log (narrower under ASIDE_WIDE_MIN_PX) with its title and counts, a button
 * that collapses it, then the view. Collapsed: a slim rail that keeps the total, the counts of the sub-agents that are active, failed or of unknown status, and
 * the state of the selected one, so the panel is never invisible, and a button that opens it. The choice is remembered by the caller.
 */
export function SubagentAside({ collapsed, onCollapsed, problem, onDismissProblem, ...view }: SubagentAsideProps) {
  const counts = countStatuses(view.items);
  const wide = useMinWidth(ASIDE_WIDE_MIN_PX);
  const total = `${counts.total} sub-agent${counts.total === 1 ? '' : 's'}`;
  if (collapsed) {
    const selected = view.selectedId === undefined ? undefined : view.items.find((item) => item.dto.agentId === view.selectedId);
    const look = selected === undefined ? undefined : STATUS_LOOK[selected.status];
    const SelectedIcon = look?.icon;
    const selectedName = selected === undefined ? '' : `Selected: ${selected.title}, ${look?.label.toLowerCase() ?? ''}, ${phaseWords(view.phase)}`;
    return (
      <aside aria-label="Sub-agents" className="flex min-h-0 w-am-hit shrink-0 flex-col items-center gap-2 border-l border-border py-1">
<IconButton aria-label={`Show the sub-agents panel (${total})`} title="Show the sub-agents panel" aria-expanded={false} onClick={() => onCollapsed(false)} icon={<PanelRightOpen aria-hidden="true" className="h-4 w-4" />} />
        <span aria-hidden="true" className="flex flex-col items-center gap-1 text-xs text-muted">
          <Bot className="h-am-icon-sm w-am-icon-sm" />
          <span className="tabular-nums text-content">{counts.total}</span>
        </span>
        <CountChips counts={counts} vertical />
        {SelectedIcon !== undefined && look !== undefined ? (
          <span role="img" aria-label={selectedName} title={selectedName} className={`inline-flex rounded-full border-2 border-primary p-0.5 ${look.text}`}>
            <SelectedIcon aria-hidden="true" className={`h-am-icon-sm w-am-icon-sm ${look.iconClass}`} />
          </span>
        ) : null}
        {problem !== '' ? <span role="img" aria-label={problem} title={problem} className="text-warning-text">
            <TriangleAlert aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          </span> : null}
      </aside>
    );
  }
  return (
    <aside aria-label="Sub-agents" className={`flex min-h-0 shrink-0 flex-col border-l border-border ${wide ? ASIDE_WIDTH.wide : ASIDE_WIDTH.narrow}`}>
      <div className="flex shrink-0 items-center justify-between gap-1 border-b border-border pl-3">
        <h3 className="min-w-0">
          <SubagentsTitle counts={counts} />
        </h3>
<IconButton aria-label="Collapse the sub-agents panel" aria-expanded onClick={() => onCollapsed(true)} icon={<PanelRightClose aria-hidden="true" className="h-4 w-4" />} />
      </div>
      {problem !== '' ? (
        <div role="alert" className="flex items-start gap-1.5 border-b border-warning bg-warning-bg px-3 py-1.5 text-xs text-warning-text">
          <p className="min-w-0 flex-1">{problem}</p>
<IconButton size="icon-xs" aria-label="Dismiss the note about the panel settings" onClick={onDismissProblem} icon={<X aria-hidden="true" className="h-3 w-3" />} />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <SubagentsView {...view} />
      </div>
    </aside>
  );
}
