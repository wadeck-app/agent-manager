import type { LogEntry, LogLimits, LogOk, LogTruncation, SubagentDto } from '../deps.js';

/** What the viewer shows of one session. Pure state: every transition is a function of the previous state and one answer of GET /log. */
export interface LogState {
  /** The first answer arrived (an empty transcript is loaded too). */
  loaded: boolean;
  /** Entries in file order, oldest first, one per key. */
  entries: LogEntry[];
  /** Pass as `after` to poll; null before the first answer. */
  cursor: string | null;
  /** Pass as `before` to load older entries; null when the start of the transcript is reached. */
  olderCursor: string | null;
  /** Count of entries that appeared at the end since the tail was loaded (only NEW keys; an updated running call does not count). */
  appended: number;
  subagents: SubagentDto[];
  subagentsNote: string;
  /** "No transcript yet" and the like, from the server. */
  note: string;
  truncated?: LogTruncation;
  limits?: LogLimits;
}

export const initialLogState: LogState = { loaded: false, entries: [], cursor: null, olderCursor: null, appended: 0, subagents: [], subagentsNote: '', note: '' };

export type LogAction = { type: 'reset' } | { type: 'tail'; answer: LogOk } | { type: 'after'; answer: LogOk } | { type: 'older'; answer: LogOk };

/** Keeps one copy per key: the LAST one wins, at the position of the FIRST (a running call replaced by its complete version keeps its place). */
export function dedupeLast(entries: readonly LogEntry[]): LogEntry[] {
  const position = new Map<string, number>();
  const out: LogEntry[] = [];
  for (const entry of entries) {
    const at = position.get(entry.key);
    if (at === undefined) {
      position.set(entry.key, out.length);
      out.push(entry);
    } else {
      out[at] = entry;
    }
  }
  return out;
}

/** An `after` answer: an entry with a known key REPLACES the old one in place (the running call that got its result), a new key goes to the end. */
export function mergeAfter(entries: readonly LogEntry[], incoming: readonly LogEntry[]): { entries: LogEntry[]; added: number } {
  const next = entries.slice();
  const position = new Map<string, number>();
  next.forEach((entry, index) => position.set(entry.key, index));
  let added = 0;
  for (const entry of dedupeLast(incoming)) {
    const at = position.get(entry.key);
    if (at === undefined) {
      position.set(entry.key, next.length);
      next.push(entry);
      added += 1;
    } else {
      next[at] = entry;
    }
  }
  return { entries: next, added };
}

/** A `before` page goes in front. A key present in both keeps the OLDER page's copy (it is complete), at its place in the page. */
export function prependOlder(entries: readonly LogEntry[], older: readonly LogEntry[]): LogEntry[] {
  const page = dedupeLast(older);
  const pageKeys = new Set(page.map((entry) => entry.key));
  return [...page, ...entries.filter((entry) => !pageKeys.has(entry.key))];
}

function details(state: LogState, answer: LogOk): Pick<LogState, 'subagents' | 'subagentsNote' | 'note' | 'truncated' | 'limits'> {
  return { subagents: answer.subagents, subagentsNote: answer.subagentsNote, note: answer.note, truncated: answer.truncated, limits: answer.limits ?? state.limits };
}

export function logReducer(state: LogState, action: LogAction): LogState {
  switch (action.type) {
    case 'reset':
      return initialLogState;
    case 'tail':
      // The newest window replaces everything (first load, or the reload after a stale cursor).
      return { ...state, ...details(state, action.answer), loaded: true, entries: dedupeLast(action.answer.entries), cursor: action.answer.cursor, olderCursor: action.answer.olderCursor, appended: 0 };
    case 'after': {
      const merged = mergeAfter(state.entries, action.answer.entries);
      return { ...state, ...details(state, action.answer), entries: merged.entries, cursor: action.answer.cursor ?? state.cursor, appended: state.appended + merged.added };
    }
    case 'older':
      // The activity, sub-agents and notes of a `before` answer describe the older window: ignored.
      return { ...state, entries: prependOlder(state.entries, action.answer.entries), olderCursor: action.answer.olderCursor };
  }
}
