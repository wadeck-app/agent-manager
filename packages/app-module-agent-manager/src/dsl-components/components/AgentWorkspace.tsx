import { Banner } from '../ui/Banner.js';
import { checkVariant } from '../shared.js';
import type { LogStyle, SessionRowDto } from '../shared.js';
import { Workspace } from '../workspace/Workspace.js';

export interface AgentWorkspaceProps {
  /** Which list variant fills the left column. */
  list: 'groups' | 'inbox' | 'tree' | 'tabs-cards' | 'palette';
  /**
   * The sub-variant of the list. Named `variant`, not `style`: the entry generator never passes a prop called `style` (it is a reserved React prop).
   * groups: comfortable, compact, preview; inbox: tabs, segmented, autonext; tree: expanded, attention, rollup; tabs-cards: cards, rail, harness;
   * palette: search, facets, minimal.
   */
  variant: string;
  /** The rows of the page source (`$sources.sessions.sessions`): the page owns the one poll, this component never requests the list. Absent while loading. */
  sessions?: SessionRowDto[];
  /** `$sources.sessions.userStateError`: shown when the pins and seen markers could not be read. */
  userStateError?: string;
  /** `$sources.sessions.hiddenDead`: ended sessions the filter hides. */
  hiddenDead?: number;
  /** Forces the style of the log (chat, timeline, compact) instead of the `detail-log-style` A/B test. */
  logStyle?: LogStyle;
}

/**
 * The Agents page body: the sessions in a left column (one of five list variants), the selected session on the right (header, log, reply box). The
 * selection is the URL parameter `session`, so a link or a refresh keeps it. The rows come from the page (one request for the table and the workspace).
 *
 * @registryCategory composite
 * @registryTags agents sessions master-detail
 */
export function AgentWorkspace({ list, variant, sessions, userStateError, hiddenDead, logStyle }: AgentWorkspaceProps) {
  const checked = checkVariant(list, variant);
  if (!checked.ok) {
    return <Banner tone="error">{checked.text}</Banner>;
  }
  return <Workspace list={checked.list} style={checked.style} sessions={sessions} userStateError={userStateError ?? ''} hiddenDead={hiddenDead ?? 0} logStyle={logStyle} />;
}
