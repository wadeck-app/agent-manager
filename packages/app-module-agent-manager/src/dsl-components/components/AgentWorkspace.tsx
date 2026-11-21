import { Scope } from '../ui/Scope.js';
import { UiVariants } from '../ui/UiVariants.js';
import type { ApiError, CustomGroupDto, SessionRowDto } from '../shared.js';
import { Workspace } from '../workspace/Workspace.js';

export interface AgentWorkspaceProps {
  /** The rows of the page source (`$sources.sessions.sessions`): the page owns the one poll, this component never requests the list. Absent while loading. */
  sessions?: SessionRowDto[];
  /** `$sources.sessions.userStateError`: shown when the pins and seen markers could not be read. */
  userStateError?: string;
  /** `$sources.sessions.customGroups`: the user's groups of agents (the Tree lists them above the workspaces). Absent: none. */
  customGroups?: CustomGroupDto[];
  /** `$sources.sessions.hiddenDead`: ended sessions the filter hides. */
  hiddenDead?: number;
  /** `$sources.sessions.ownedError`: why the agent-manager daemon could not be asked (null when it answered). The New session dialog says it, with the fix. */
  ownedError?: ApiError | null;
  /** `$sources.sessions.ownedErrorText`: message and hint in one line, empty when there is none. */
  ownedErrorText?: string;
  /** `$sources.sessions.unreadableText`: the registry files that could not be read (their sessions are not shown), empty when none. */
  unreadableText?: string;
  /** `$sources.sessions.guardrailsErrorText`: the w-guardrails counters behind the blocked chip could not be read (details on the Guardrails page). */
  guardrailsErrorText?: string;
  /** `$sources.sessions.ownedDownText`: owned sessions are listed but the daemon is down (their actions are missing), with the fix; empty when none. */
  ownedDownText?: string;
  /** `$sources.sessions.ownedStateErrorText`: owned-sessions.json cannot be used while the daemon is down; empty when none. */
  ownedStateErrorText?: string;
}

/**
 * The Agents page body: a toggle between three ways to list the agents (Tree, Groups, Inbox; the URL parameter `mode`), a search box that works in every
 * mode, the agents in a left column and the selected one on the right (header, log, reply box). The selection is the URL parameter `session`, so a link or a
 * refresh keeps it. The rows come from the page (one request for the table page and the workspace).
 *
 * @registryCategory composite
 * @registryTags agents sessions master-detail
 */
export function AgentWorkspace({ sessions, userStateError, customGroups, hiddenDead, ownedError, ownedErrorText, unreadableText, guardrailsErrorText, ownedDownText, ownedStateErrorText }: AgentWorkspaceProps) {
  return (
    <Scope>
      {/* The design questions of the UI audit: one A/B dock for the whole page (see logic/uiVariants.ts). */}
      <UiVariants>
        <Workspace sessions={sessions} userStateError={userStateError ?? ''} customGroups={customGroups} hiddenDead={hiddenDead ?? 0} ownedError={ownedError ?? null} ownedErrorText={ownedErrorText ?? ''} unreadableText={unreadableText ?? ''} guardrailsErrorText={guardrailsErrorText ?? ''} ownedDownText={ownedDownText ?? ''} ownedStateErrorText={ownedStateErrorText ?? ''} />
      </UiVariants>
    </Scope>
  );
}
