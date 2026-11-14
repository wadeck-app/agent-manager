import type { Session, StatusGroup } from '@wadeck-app/agent-manager-core';

/** What the views read for one session: the core Session plus the texts the DSL cannot compute. Dates stay numbers (the shell formats them). */
export interface SessionRow extends Session {
  /** The registry name, else the folder. */
  displayName: string;
  /** "busy", or "waiting: permission prompt": the raw registry status, with what it waits for when known. */
  statusDetail: string;
  /** "alive" or "dead" (pid-only check). */
  aliveText: 'alive' | 'dead';
}

export function presentSession(session: Session): SessionRow {
  return {
    ...session,
    displayName: session.name ?? session.folder,
    statusDetail: session.waitingFor === undefined ? session.status : `${session.status}: ${session.waitingFor}`,
    aliveText: session.alive ? 'alive' : 'dead',
  };
}

export interface Summary {
  busy: number;
  idle: number;
  other: number;
  /** Alive sessions: busy + idle + other. */
  alive: number;
  /** Sessions whose process is gone but whose registry file is still there. */
  dead: number;
}

/** Counts by status group among the alive sessions; the dead ones are counted apart. */
export function summarize(sessions: readonly Session[]): Summary {
  const counts: Record<StatusGroup, number> = { busy: 0, idle: 0, other: 0 };
  let dead = 0;
  for (const session of sessions) {
    if (session.alive) {
      counts[session.statusGroup] += 1;
    } else {
      dead += 1;
    }
  }
  return { ...counts, alive: counts.busy + counts.idle + counts.other, dead };
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** One line for a view: the files of the registry that could not be read, each with the reason. Empty when there is none. */
export function unreadableText(unreadable: readonly { file: string; reason: string }[]): string {
  if (unreadable.length === 0) {
    return '';
  }
  const list = unreadable.map((entry) => `${entry.file} (${entry.reason})`).join('; ');
  return `${plural(unreadable.length, 'registry file', 'registry files')} could not be read, the sessions in them are not shown: ${list}`;
}

export function hiddenDeadText(hidden: number): string {
  return hidden === 0 ? '' : `${plural(hidden, 'dead session is', 'dead sessions are')} hidden (its process is gone but Claude Code left its registry file); show them with the filter.`;
}

export function emptyText(shown: number, hiddenDead: number): string {
  if (shown > 0) {
    return '';
  }
  return hiddenDead > 0 ? 'No session is alive.' : 'No Claude Code session is registered. Start one in a terminal; it appears here within a few seconds.';
}
