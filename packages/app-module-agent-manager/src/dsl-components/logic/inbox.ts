import { sortForState } from './grouping.js';
import type { AgentState, SessionRowDto } from './states.js';

export type InboxTab = 'needs-you' | 'done' | 'working' | 'all';

export const INBOX_TABS: readonly { id: InboxTab; label: string }[] = [
  { id: 'needs-you', label: 'Needs you' },
  { id: 'done', label: 'Done' },
  { id: 'working', label: 'Working' },
  { id: 'all', label: 'All' },
];

export function parseTab(value: string | null): InboxTab | undefined {
  return INBOX_TABS.find((tab) => tab.id === value)?.id;
}

export function tabCounts(sessions: readonly SessionRowDto[]): Record<InboxTab, number> {
  const counts: Record<InboxTab, number> = { 'needs-you': 0, done: 0, working: 0, all: sessions.length };
  for (const session of sessions) {
    if (session.state === 'needs-you' || session.state === 'done' || session.state === 'working') {
      counts[session.state] += 1;
    }
  }
  return counts;
}

/** The sessions of a tab, in the order the tab shows them (decision 46 inside one state; All: the states that want you first). */
export function tabSessions(sessions: readonly SessionRowDto[], tab: InboxTab): SessionRowDto[] {
  if (tab !== 'all') {
    return sessions.filter((session) => session.state === tab).sort(sortForState(tab));
  }
  const rank: Record<AgentState, number> = { 'needs-you': 0, done: 1, other: 2, working: 3, idle: 4, ended: 5 };
  return [...sessions].sort((a, b) => rank[a.state] - rank[b.state] || sortForState(a.state)(a, b));
}

/** The first tab with something in it, in tab order; All when the other three are empty. */
export function firstNonEmptyTab(counts: Record<InboxTab, number>): InboxTab {
  return INBOX_TABS.find((tab) => tab.id !== 'all' && counts[tab.id] > 0)?.id ?? 'all';
}

/**
 * After a reply: the row to open next. The next row needing you in the order of `ordered`, starting after the replied one and wrapping around; the
 * replied session itself is never returned. Undefined when nobody else needs you (the caller keeps the selection and says so).
 */
export function nextNeedingYou(ordered: readonly SessionRowDto[], repliedId: string): SessionRowDto | undefined {
  const isOther = (session: SessionRowDto): boolean => session.state === 'needs-you' && session.sessionId.toLowerCase() !== repliedId;
  const position = ordered.findIndex((session) => session.sessionId.toLowerCase() === repliedId);
  return ordered.slice(position + 1).find(isOther) ?? ordered.find(isOther);
}
