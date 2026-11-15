import { Bot } from 'lucide-react';
import { CountChips } from './CountChips.js';
import type { SubagentCounts } from './subagentModel.js';

/** The title of every container: the robot icon, "70 sub-agents" and the chips of what needs the eye. */
export function SubagentsTitle({ counts }: { counts: SubagentCounts }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Bot aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-muted" />
      <span className="truncate text-xs font-medium text-content">
        {counts.total} sub-agent{counts.total === 1 ? '' : 's'}
      </span>
      <CountChips counts={counts} />
    </span>
  );
}
