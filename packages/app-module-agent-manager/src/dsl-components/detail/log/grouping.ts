import type { LogEntry } from '../deps.js';
import { toolLabel } from './toolChips.js';

export type ToolCall = Extract<LogEntry, { kind: 'tool-call' }>;

/** What the one-line system row condenses (see mergeSystemRows). */
export type SystemEntry = Extract<LogEntry, { kind: 'hook' | 'system-notice' }>;

export type Row =
  | { type: 'entry'; key: string; entry: LogEntry }
  | { type: 'group'; key: string; calls: ToolCall[] }
  /** Consecutive hook and turn rows condensed into one line (built by mergeSystemRows, never by buildRows). */
  | { type: 'system'; key: string; entries: SystemEntry[] };

/**
 * Consecutive tool calls (two or more) become one collapsed group "N tool calls". The group key is the key of its first call: stable while calls are added.
 * `grouped: false` (the view option "Group consecutive calls" off): every call is its own row, in the order of the transcript.
 */
export function buildRows(entries: readonly LogEntry[], grouped = true): Row[] {
  if (!grouped) {
    return entries.map((entry) => ({ type: 'entry', key: entry.key, entry }));
  }
  const rows: Row[] = [];
  let run: ToolCall[] = [];
  // Hook entries met inside a run (a hook is written between a call and its result): they do not split the group, they follow it.
  let held: LogEntry[] = [];
  const flush = (): void => {
    if (run.length === 1) {
      rows.push({ type: 'entry', key: run[0]!.key, entry: run[0]! });
    } else if (run.length > 1) {
      rows.push({ type: 'group', key: `group:${run[0]!.key}`, calls: run });
    }
    for (const entry of held) {
      rows.push({ type: 'entry', key: entry.key, entry });
    }
    run = [];
    held = [];
  };
  for (const entry of entries) {
    if (entry.kind === 'tool-call') {
      run.push(entry);
    } else if (entry.kind === 'hook' && run.length > 0) {
      held.push(entry);
    } else {
      flush();
      rows.push({ type: 'entry', key: entry.key, entry });
    }
  }
  flush();
  return rows;
}

export interface GroupSummary {
  total: number;
  running: number;
  errors: number;
  /** "Bash 3, Read 2" */
  names: string;
}

export function summariseGroup(calls: readonly ToolCall[]): GroupSummary {
  const counts = new Map<string, number>();
  let running = 0;
  let errors = 0;
  for (const call of calls) {
    counts.set(toolLabel(call), (counts.get(toolLabel(call)) ?? 0) + 1);
    running += call.status === 'running' ? 1 : 0;
    errors += call.status === 'error' ? 1 : 0;
  }
  const names = [...counts].map(([name, count]) => (count > 1 ? `${name} ${count}` : name)).join(', ');
  return { total: calls.length, running, errors, names };
}

/** The set of open rows after a click on `key` (a new set: React state). */
export function toggleOpen(open: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(open);
  if (!next.delete(key)) {
    next.add(key);
  }
  return next;
}

/** The entries the one-line system row condenses: the hooks of Claude Code, the Stop hook summary and the turn duration. Other notices (commands, compaction) keep their rows. */
export function isSystemEntry(entry: LogEntry): entry is SystemEntry {
  return entry.kind === 'hook' || (entry.kind === 'system-notice' && (entry.noticeKind === 'stop-hook' || entry.noticeKind === 'turn-duration'));
}

/**
 * Condenses every run of consecutive hook / stop-hook / turn-duration rows into ONE row (rows of the other kinds in between end the run, so a run never
 * crosses a message). The key is the key of the first entry: stable while entries are added after it.
 */
export function mergeSystemRows(rows: readonly Row[]): Row[] {
  const out: Row[] = [];
  let run: SystemEntry[] = [];
  const flush = (): void => {
    if (run.length > 0) {
      out.push({ type: 'system', key: `system:${run[0]!.key}`, entries: run });
      run = [];
    }
  };
  for (const row of rows) {
    if (row.type === 'entry' && isSystemEntry(row.entry)) {
      run.push(row.entry);
    } else {
      flush();
      out.push(row);
    }
  }
  flush();
  return out;
}
