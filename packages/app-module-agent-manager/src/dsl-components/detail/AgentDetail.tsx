import { useAbTest, useRegisterAbTests } from '@wadeck-app/dsl-ui';
import type { AgentRow } from '../data/types.js';
import { Composer } from './composer/Composer.js';
import { LogViewer } from './log/LogViewer.js';
import type { SubagentsContent, SubagentsLayout } from './log/subagentTypes.js';

/**
 * What the detail pane shows under the header: the log of the session (scrolls inside) and the reply box (fixed at the bottom). How the sub-agents of the
 * session are shown is two A/B tests declared here in code (a YAML AbTest cannot hand a value to a component), shown in the same dock as the others:
 * `subagents-layout` (where) and `subagents-content` (what). `subagentsLayout` and `subagentsContent` force one (tests, or a caller with a fixed choice).
 */
export interface AgentDetailProps {
  session: AgentRow;
  subagentsLayout?: SubagentsLayout;
  subagentsContent?: SubagentsContent;
}

export function AgentDetail({ session, subagentsLayout, subagentsContent }: AgentDetailProps) {
  const layout = useAbTest<SubagentsLayout>({
    id: 'subagents-layout',
    label: 'Sub-agents: layout',
    initial: 'panel',
    options: {
      panel: { label: 'Side panel', hint: 'A column beside the log, always open, when the window is 1700 px wide or more (below that it opens from a strip above the log, as the Strip variant does).' },
      strip: { label: 'Strip', hint: 'One line above the log with the counts; it opens in place and scrolls inside a bounded height. Works at every width.' },
      badge: { label: 'Badge', hint: 'A badge with the counts at the right of a thin bar above the log; it opens a popover over the log and closes when you pick a sub-agent.' },
    },
  });
  const content = useAbTest<SubagentsContent>({
    id: 'subagents-content',
    label: 'Sub-agents: content',
    initial: 'summary',
    options: {
      summary: { label: 'Summary', hint: 'Progress bar and counts; running, failed and idle ones first, the finished ones folded into "N finished" (40 at a time).' },
      groups: { label: 'By type', hint: 'Grouped by agent type with a count and a status bar per group; groups with something running or failed start open.' },
      timeline: { label: 'Timeline', hint: 'One bar per sub-agent on a common time axis: what ran at the same time and for how long, and the peak concurrency.' },
    },
  });
  useRegisterAbTests([...(subagentsLayout === undefined ? [layout] : []), ...(subagentsContent === undefined ? [content] : [])]);
  return (
    <div data-agent-detail="" className="flex min-h-0 flex-1 flex-col">
      <LogViewer session={session} subagentsLayout={subagentsLayout ?? layout.value} subagentsContent={subagentsContent ?? content.value} />
      <Composer session={session} />
    </div>
  );
}
