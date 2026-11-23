import type { AgentRow } from '../data/types.js';
import { CardsDock } from './CardsDock.js';
import { Composer } from './composer/Composer.js';
import { HcPermissionCard } from '../owned/HcPermissionCard.js';
import { PermissionCard } from '../owned/PermissionCard.js';
import { LogViewer } from './log/LogViewer.js';
import type { LogViewerProps } from './log/LogViewer.js';

/**
 * What the detail pane shows under the header: the log of the session (scrolls inside, with the sub-agent panel beside it), the permission requests of a Web session
 * launched from agent-manager, and the reply box (fixed at the bottom).
 */
export interface AgentDetailProps {
  session: AgentRow;
  /** A thread was started from a message of the log: the page lists and selects it. */
  onThreadStarted?: LogViewerProps['onThreadStarted'];
  /** The uuid of the message the log must bring into view (the link back from a thread). */
  focusMessageId?: string;
}

export function AgentDetail({ session, onThreadStarted, focusMessageId }: AgentDetailProps) {
  return (
    <div data-agent-detail="" className="flex min-h-0 flex-1 flex-col">
      {/* The log keeps a usable minimum height (7rem) whatever the cards below take. */}
      <div data-detail-log="" className="flex min-h-[7rem] flex-1 flex-col">
        <LogViewer session={session} {...(onThreadStarted === undefined ? {} : { onThreadStarted })} {...(focusMessageId === undefined ? {} : { focusMessageId })} />
      </div>
      <CardsDock>
        <PermissionCard key={session.sessionId.toLowerCase()} session={session} />
        <HcPermissionCard key={`hc-${session.sessionId.toLowerCase()}`} session={session} />
      </CardsDock>
      <Composer session={session} />
    </div>
  );
}
