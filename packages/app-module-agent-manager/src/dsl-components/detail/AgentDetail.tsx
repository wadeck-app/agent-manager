import type { AgentRow } from '../data/types.js';
import { Composer } from './composer/Composer.js';
import { LogViewer } from './log/LogViewer.js';

/**
 * What the detail pane shows under the header: the log of the session (scrolls inside, with the sub-agent panel beside it) and the reply box (fixed at the
 * bottom).
 */
export interface AgentDetailProps {
  session: AgentRow;
}

export function AgentDetail({ session }: AgentDetailProps) {
  return (
    <div data-agent-detail="" className="flex min-h-0 flex-1 flex-col">
      <LogViewer session={session} />
      <Composer session={session} />
    </div>
  );
}
