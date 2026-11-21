import type { AgentRow } from '../data/types.js';
import { Composer } from './composer/Composer.js';
import { HcPermissionCard } from '../owned/HcPermissionCard.js';
import { PermissionCard } from '../owned/PermissionCard.js';
import { LogViewer } from './log/LogViewer.js';

/**
 * What the detail pane shows under the header: the log of the session (scrolls inside, with the sub-agent panel beside it), the permission requests of a Web session
 * launched from agent-manager, and the reply box (fixed at the bottom).
 */
export interface AgentDetailProps {
  session: AgentRow;
}

export function AgentDetail({ session }: AgentDetailProps) {
  return (
    <div data-agent-detail="" className="flex min-h-0 flex-1 flex-col">
      <LogViewer session={session} />
      <PermissionCard key={session.sessionId.toLowerCase()} session={session} />
      <HcPermissionCard key={`hc-${session.sessionId.toLowerCase()}`} session={session} />
      <Composer session={session} />
    </div>
  );
}
