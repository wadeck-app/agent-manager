import { Scope } from '../ui/Scope.js';
import type { SessionRowDto } from '../shared.js';
import { Workspace } from '../workspace/Workspace.js';

export interface AgentWorkspaceProps {
  /** The rows of the page source (`$sources.sessions.sessions`): the page owns the one poll, this component never requests the list. Absent while loading. */
  sessions?: SessionRowDto[];
  /** `$sources.sessions.userStateError`: shown when the pins and seen markers could not be read. */
  userStateError?: string;
  /** `$sources.sessions.hiddenDead`: ended sessions the filter hides. */
  hiddenDead?: number;
}

/**
 * The Agents page body: a toggle between three ways to list the agents (Tree, Groups, Inbox; the URL parameter `mode`), a search box that works in every
 * mode, the agents in a left column and the selected one on the right (header, log, reply box). The selection is the URL parameter `session`, so a link or a
 * refresh keeps it. The rows come from the page (one request for the table page and the workspace).
 *
 * @registryCategory composite
 * @registryTags agents sessions master-detail
 */
export function AgentWorkspace({ sessions, userStateError, hiddenDead }: AgentWorkspaceProps) {
  return (
    <Scope>
      <Workspace sessions={sessions} userStateError={userStateError ?? ''} hiddenDead={hiddenDead ?? 0} />
    </Scope>
  );
}
