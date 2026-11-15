import { flatten, groupSessions } from './grouping.js';
import { firstNonEmptyTab, parseTab, tabCounts, tabSessions } from './inbox.js';
import { agentId } from './states.js';
import type { SessionRowDto } from './states.js';
import { buildTree, flatByUrgency } from './tree.js';
import type { ModeId } from '../shared.js';
import type { ViewOptions } from './viewOptions.js';

/**
 * The ids of the sessions in the order the CURRENT mode lists them, from the data the list is drawn from (never from the DOM: a collapsed folder or group hides
 * rows from the DOM, not from the search). The search box walks this order; choosing a row in a collapsed folder opens it (the list opens the folder of the
 * selected agent) and a search opens every folder and group.
 *
 * `tabParam` is the `?tab=` of the Inbox (an unknown one gives the first tab that holds something, as the Inbox does).
 */
export function orderedSessionIds(mode: ModeId, sessions: readonly SessionRowDto[], options: ViewOptions, tabParam: string | null): string[] {
  switch (mode) {
    case 'tree':
      return options.tree.grouping === 'none' ? flatByUrgency(sessions).map(agentId) : buildTree(sessions).flatMap((node) => node.sessions.map(agentId));
    case 'groups':
      return flatten(groupSessions(sessions)).map(agentId);
    case 'inbox':
      return tabSessions(sessions, parseTab(tabParam) ?? firstNonEmptyTab(tabCounts(sessions))).map(agentId);
  }
}
