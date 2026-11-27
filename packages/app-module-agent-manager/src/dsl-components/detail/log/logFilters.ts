import { useCallback, useEffect, useState } from 'react';
import type { LogEntry } from '../deps.js';

/**
 * The three families of the log the person can hide. An entry in none of them (what the person and Claude say, the notices) is always shown.
 * - hooks: `hook` entries and the Stop hook summary notice.
 * - agents: messages between agents: SendMessage and Agent/Task calls (the prompt of a sub-agent and its result), prompts that come from another session
 *   (source peer) or from a finished background task or sub-agent (task-notification: the origin does not say which of the two), and the queue lines of those.
 *   A message the person sent from here (webReply) is the person's, not an agent's.
 * - tools: every other tool call.
 * - thinking: the collapsed "Thinking" blocks of Claude (kind `thinking`).
 * - queue: the harness queue lines (enqueue, dequeue, remove...) that are not messages between agents (those are in "agents").
 */
export type LogCategory = 'hooks' | 'tools' | 'agents' | 'thinking' | 'queue';
export const LOG_CATEGORIES: readonly LogCategory[] = ['hooks', 'tools', 'agents', 'thinking', 'queue'];

const zeroCounts = (): Record<LogCategory, number> => ({ hooks: 0, tools: 0, agents: 0, thinking: 0, queue: 0 });

const AGENT_TOOLS: ReadonlySet<string> = new Set(['SendMessage', 'Agent', 'Task']);

export function categoryOf(entry: LogEntry): LogCategory | undefined {
  switch (entry.kind) {
    case 'hook':
      return 'hooks';
    case 'system-notice':
      return entry.noticeKind === 'stop-hook' ? 'hooks' : undefined;
    case 'tool-call':
      return AGENT_TOOLS.has(entry.name) ? 'agents' : 'tools';
    case 'user-prompt':
      return entry.webReply === undefined && (entry.source === 'peer' || entry.source === 'task-notification') ? 'agents' : undefined;
    case 'thinking':
      return 'thinking';
    case 'queue-operation':
      return entry.contentKind === 'cross-session-message' || entry.contentKind === 'task-notification' ? 'agents' : 'queue';
  }
  // Every other kind (what the person and Claude say, the notices, the model rows): never filtered.
  return undefined;
}

export type FilterPrefs = Record<LogCategory, boolean>;

/** Hooks are noise for most readings (two per tool call): off. Thinking and queue lines are shown, as before the filters existed for them. */
export const DEFAULT_FILTERS: FilterPrefs = { hooks: false, tools: true, agents: true, thinking: true, queue: true };

export interface Filtered {
  entries: LogEntry[];
  /** Entries of each family among those given (shown or not). */
  counts: Record<LogCategory, number>;
  /** Entries of each family left out. */
  hidden: Record<LogCategory, number>;
  hiddenTotal: number;
}

/** `keep`: an entry the page needs on screen (the call of the selected sub-agent) stays whatever the filter says. */
export function applyFilters(entries: readonly LogEntry[], prefs: FilterPrefs, keep?: (entry: LogEntry) => boolean): Filtered {
  const counts = zeroCounts();
  const hidden = zeroCounts();
  const shown: LogEntry[] = [];
  for (const entry of entries) {
    const category = categoryOf(entry);
    if (category === undefined) {
      shown.push(entry);
      continue;
    }
    counts[category] += 1;
    if (prefs[category] || keep?.(entry) === true) {
      shown.push(entry);
    } else {
      hidden[category] += 1;
    }
  }
  return { entries: shown, counts, hidden, hiddenTotal: LOG_CATEGORIES.reduce((total, category) => total + hidden[category], 0) };
}

export const FILTER_PREFS_KEY = 'agent-manager.log-filters.v1';
export const FILTER_READ_PROBLEM = 'Your log filters could not be read: the defaults are used.';
export const FILTER_WRITE_PROBLEM = 'Your log filters could not be saved: they hold until the page is reloaded.';

const warned = new Set<string>();
/** One console.warn per kind of problem and page load: the sentence in the page is for the user, this one is for whoever debugs. */
function warnOnce(problem: string, detail: unknown): void {
  if (!warned.has(problem)) {
    warned.add(problem);
    console.warn(`[agent-manager] ${problem}`, detail);
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined;
}

/** The field of the stored object that says whether the full filter bar is shown above the log (hidden by default: the header popup holds the same options). */
const BAR_FIELD = 'bar';

/** The field of the stored object that says whether consecutive tool calls are folded into one row (true, the default) or each call has its own row. */
const GROUP_FIELD = 'group';

/** Whether the saved choice groups consecutive tool calls. Anything unreadable is "grouped" (the default): readFilterPrefs already said so. */
export function readGroupPref(): boolean {
  try {
    const raw = window.localStorage.getItem(FILTER_PREFS_KEY);
    return raw === null || asObject(JSON.parse(raw))?.[GROUP_FIELD] !== false;
  } catch {
    return true;
  }
}

/** Whether the saved choice shows the filter bar. Anything unreadable is "hidden": readFilterPrefs already said so. */
export function readBarPref(): boolean {
  try {
    const raw = window.localStorage.getItem(FILTER_PREFS_KEY);
    return raw !== null && asObject(JSON.parse(raw))?.[BAR_FIELD] === true;
  } catch {
    return false;
  }
}

export interface ReadFilters {
  prefs: FilterPrefs;
  problem: string;
}

/** The saved choices. Nothing saved is not a problem; a storage that throws, text that is not JSON or a value that is not a boolean is: the defaults show and `problem` says so. */
export function readFilterPrefs(): ReadFilters {
  const fail = (detail: unknown): ReadFilters => {
    warnOnce(FILTER_READ_PROBLEM, detail);
    return { prefs: DEFAULT_FILTERS, problem: FILTER_READ_PROBLEM };
  };
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(FILTER_PREFS_KEY);
  } catch (error) {
    return fail(error);
  }
  if (raw === null) {
    return { prefs: DEFAULT_FILTERS, problem: '' };
  }
  let stored: Record<string, unknown> | undefined;
  try {
    stored = asObject(JSON.parse(raw));
  } catch (error) {
    return fail(error);
  }
  if (stored === undefined || LOG_CATEGORIES.some((category) => stored[category] !== undefined && typeof stored[category] !== 'boolean') || (stored[BAR_FIELD] !== undefined && typeof stored[BAR_FIELD] !== 'boolean') || (stored[GROUP_FIELD] !== undefined && typeof stored[GROUP_FIELD] !== 'boolean')) {
    return fail(raw);
  }
  const value = (category: LogCategory): boolean => (typeof stored[category] === 'boolean' ? stored[category] : DEFAULT_FILTERS[category]);
  return { prefs: { hooks: value('hooks'), tools: value('tools'), agents: value('agents'), thinking: value('thinking'), queue: value('queue') }, problem: '' };
}

/** Writes ONLY the changed fields (merged with what is stored now, so another tab's choice for another field is kept). A sentence when the storage refused. */
function writeMerged(patch: Partial<FilterPrefs> & { bar?: boolean; group?: boolean }): string {
  try {
    const raw = window.localStorage.getItem(FILTER_PREFS_KEY);
    let stored: Record<string, unknown> = {};
    if (raw !== null) {
      try {
        stored = asObject(JSON.parse(raw)) ?? {};
      } catch {
        // Unreadable text is replaced by the new choice (the read side already said so).
      }
    }
    window.localStorage.setItem(FILTER_PREFS_KEY, JSON.stringify({ ...stored, ...patch }));
    return '';
  } catch (error) {
    warnOnce(FILTER_WRITE_PROBLEM, error);
    return FILTER_WRITE_PROBLEM;
  }
}

export interface LogFiltersFeed {
  prefs: FilterPrefs;
  /** A sentence to show (dismissible) when the choices could not be read or saved; empty otherwise. */
  problem: string;
  change: (patch: Partial<FilterPrefs>) => void;
  dismissProblem: () => void;
  /** The full filter bar is shown above the log (off by default: the popup of the header holds the same options). */
  showBar: boolean;
  setShowBar: (show: boolean) => void;
  /** Consecutive tool calls (and agent calls) are one grouped row (true, the default) or one row per call (false). A display option, not a filter: nothing is hidden either way. */
  grouped: boolean;
  setGrouped: (grouped: boolean) => void;
  /** Back to the defaults (hooks hidden, everything else shown). The "show the bar" and "group tool calls" choices are display options, not filters: kept. */
  reset: () => void;
  /** The toggles are at their defaults. */
  isDefault: boolean;
}

interface FeedState extends ReadFilters {
  bar: boolean;
  grouped: boolean;
}

type Change = Partial<FilterPrefs> & { bar?: boolean; group?: boolean };

/** Every hook instance of this page (the log and the popup of the header): a change made in one reaches the others at once (the storage event only reaches other tabs). */
const peers = new Set<(patch: Change, problem: string) => void>();

const applyChange = (current: FeedState, patch: Change, problem: string): FeedState => {
  const { bar, group, ...categories } = patch;
  return { prefs: { ...current.prefs, ...categories }, bar: bar ?? current.bar, grouped: group ?? current.grouped, problem: problem !== '' ? problem : current.problem };
};

/** The choices of the filter bar, a setter that remembers them (localStorage), and the follow-up of the other tabs and of the other users of this hook in the page. */
export function useLogFilters(): LogFiltersFeed {
  const [state, setState] = useState<FeedState>(() => ({ ...readFilterPrefs(), bar: readBarPref(), grouped: readGroupPref() }));
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === null || event.key === FILTER_PREFS_KEY) {
        setState({ ...readFilterPrefs(), bar: readBarPref(), grouped: readGroupPref() });
      }
    };
    const onPeer = (patch: Change, problem: string): void => setState((current) => applyChange(current, patch, problem));
    window.addEventListener('storage', onStorage);
    peers.add(onPeer);
    return () => {
      window.removeEventListener('storage', onStorage);
      peers.delete(onPeer);
    };
  }, []);
  const apply = useCallback((patch: Change) => {
    // The write happens here, in the event handler: a state updater must stay free of side effects (React may run it twice).
    const problem = writeMerged(patch);
    // This instance is one of the peers: it receives the change like the others.
    peers.forEach((peer) => peer(patch, problem));
  }, []);
  const change = useCallback((patch: Partial<FilterPrefs>) => apply(patch), [apply]);
  const setShowBar = useCallback((show: boolean) => apply({ bar: show }), [apply]);
  const setGrouped = useCallback((grouped: boolean) => apply({ group: grouped }), [apply]);
  const reset = useCallback(() => apply({ ...DEFAULT_FILTERS }), [apply]);
  const dismissProblem = useCallback(() => setState((current) => ({ ...current, problem: '' })), []);
  const isDefault = LOG_CATEGORIES.every((category) => state.prefs[category] === DEFAULT_FILTERS[category]);
  return { prefs: state.prefs, problem: state.problem, change, dismissProblem, showBar: state.bar, setShowBar, grouped: state.grouped, setGrouped, reset, isDefault };
}
