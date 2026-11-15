import { ATTENTION } from './states.js';
import type { AgentRow } from '../data/types.js';

export interface HarnessGroup {
  /** "Claude Code 2.1.325", or "Claude Code (version unknown)" when the registry gives none. */
  label: string;
  version: string | undefined;
  sessions: AgentRow[];
}

/** Dotted numeric comparison ("2.1.325" is newer than "2.1.322"); a part that is not a number is compared as text. */
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

/** Sessions grouped by Claude Code version, newest version first, unknown last; inside a group the most urgent first (then the oldest status change). */
export function groupByHarness(sessions: readonly AgentRow[]): HarnessGroup[] {
  const byVersion = new Map<string | undefined, AgentRow[]>();
  for (const session of sessions) {
    const list = byVersion.get(session.version);
    if (list === undefined) {
      byVersion.set(session.version, [session]);
    } else {
      list.push(session);
    }
  }
  return [...byVersion.entries()]
    .map(([version, list]) => ({
      label: version === undefined ? 'Claude Code (version unknown)' : `Claude Code ${version}`,
      version,
      sessions: [...list].sort((a, b) => ATTENTION[b.state] - ATTENTION[a.state] || (a.statusUpdatedAt ?? Number.POSITIVE_INFINITY) - (b.statusUpdatedAt ?? Number.POSITIVE_INFINITY) || a.pid - b.pid),
    }))
    .sort((a, b) => (a.version === undefined ? 1 : b.version === undefined ? -1 : compareVersions(b.version, a.version)));
}
