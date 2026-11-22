import type { Session, StatusGroup } from '@wadeck-app/agent-manager-core';

/** What the views read for one session: the core Session plus the texts the DSL cannot compute. Dates stay numbers (the shell formats them). */
export interface SessionRow extends Session {
  /** The registry name, else the folder. */
  displayName: string;
  /** "busy", or "waiting: permission prompt": the raw registry status, with what it waits for when known. */
  statusDetail: string;
  /** "alive" or "dead" (pid-only check). */
  aliveText: 'alive' | 'dead';
  /** The harness with its version, as shown in the Harness column: "Claude Code 2.1.325" ("Claude Code" when the registry has no version). */
  harness: string;
  /** Badge variant of the harness: success for the most recent version seen on this machine, warning for an older one, default when the version is unknown. */
  harnessVariant: HarnessVariant;
}

export type HarnessVariant = 'success' | 'warning' | 'default';

/** Dotted numeric comparison ("2.1.325" > "2.1.322"); a part that is not a number is compared as text. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.');
  const right = b.split('.');
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const l = left[index] ?? '0';
    const r = right[index] ?? '0';
    const ln = Number(l);
    const rn = Number(r);
    const diff = Number.isNaN(ln) || Number.isNaN(rn) ? l.localeCompare(r) : ln - rn;
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** The most recent Claude Code version among the sessions (alive or not: hiding the dead ones must not move the baseline), undefined when none has one. */
export function latestVersion(sessions: readonly Session[]): string | undefined {
  let latest: string | undefined;
  for (const session of sessions) {
    if (session.version !== undefined && (latest === undefined || compareVersions(session.version, latest) > 0)) {
      latest = session.version;
    }
  }
  return latest;
}

export function presentSession(session: Session, latest?: string): SessionRow {
  const known = session.version !== undefined;
  return {
    ...session,
    displayName: session.name ?? session.folder,
    statusDetail: session.waitingFor === undefined ? session.status : `${session.status}: ${session.waitingFor}`,
    aliveText: session.alive ? 'alive' : 'dead',
    harness: known ? `Claude Code ${session.version}` : 'Claude Code',
    harnessVariant: !known ? 'default' : session.version === latest ? 'success' : 'warning',
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
  return `${plural(unreadable.length, 'registry file', 'registry files')} could not be read, the sessions in them are not shown: ${list}. Open the file in the Claude Code sessions folder (~/.claude/sessions unless AGENT_MANAGER_SESSIONS_DIR says otherwise); if its session is gone, delete it.`;
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
