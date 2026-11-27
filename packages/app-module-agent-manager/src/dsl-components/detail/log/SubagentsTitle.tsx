import { Bot } from 'lucide-react';
import { CountChips } from './CountChips.js';
import type { SubagentCounts } from './subagentModel.js';

/** The title of every container: the robot icon (`icon`; the open rail leaves it out, its tab button shows it), "70 sub-agents" whole, never cut, and the chips of what needs the eye. */
export function SubagentsTitle({ counts, icon = true }: { counts: SubagentCounts; icon?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {icon ? <Bot aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-muted" /> : null}
      <span className="shrink-0 whitespace-nowrap text-xs font-medium text-content">
        {counts.total} sub-agent{counts.total === 1 ? '' : 's'}
      </span>
      <CountChips counts={counts} />
    </span>
  );
}
