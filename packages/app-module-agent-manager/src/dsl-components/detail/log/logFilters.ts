import { useCallback, useEffect, useState } from 'react';
import type { LogEntry } from '../deps.js';

/**
 * The three families of the log the person can hide. An entry in none of them (what the person and Claude say, the notices) is always shown.
 * - hooks: `hook` entries and the Stop hook summary notice.
 * - agents: messages between agents: SendMessage and Agent/Task calls (the prompt of a sub-agent and its result), prompts that come from another session
 *   (source peer) or from a finished background task or sub-agent (task-notification: the origin does not say which of the two), and the queue lines of those.
 *   A message the person sent from here (webReply) is the person's, not an agent's.
 * - tools: every other tool call.
 */
export type LogCategory = 'hooks' | 'tools' | 'agents';
export const LOG_CATEGORIES: readonly LogCategory[] = ['hooks', 'tools', 'agents'];

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
    case 'queue-operation':
      return entry.contentKind === 'cross-session-message' || entry.contentKind === 'task-notification' ? 'agents' : undefined;
  }
  // Every other kind (what the person and Claude say, the notices, the model rows): never filtered.
  return undefined;
}

export type FilterPrefs = Record<LogCategory, boolean>;

/** Hooks are noise for most readings (two per tool call): off. */
export const DEFAULT_FILTERS: FilterPrefs = { hooks: false, tools: true, agents: true };

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
  const counts: Record<LogCategory, number> = { hooks: 0, tools: 0, agents: 0 };
  const hidden: Record<LogCategory, number> = { hooks: 0, tools: 0, agents: 0 };
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
  return { entries: shown, counts, hidden, hiddenTotal: hidden.hooks + hidden.tools + hidden.agents };
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
  if (stored === undefined || LOG_CATEGORIES.some((category) => stored[category] !== undefined && typeof stored[category] !== 'boolean') || (stored[BAR_FIELD] !== undefined && typeof stored[BAR_FIELD] !== 'boolean')) {
    return fail(raw);
  }
  const value = (category: LogCategory): boolean => (typeof stored[category] === 'boolean' ? stored[category] : DEFAULT_FILTERS[category]);
  return { prefs: { hooks: value('hooks'), tools: value('tools'), agents: value('agents') }, problem: '' };
}

/** Writes ONLY the changed fields (merged with what is stored now, so another tab's choice for another field is kept). A sentence when the storage refused. */
function writeMerged(patch: Partial<FilterPrefs> & { bar?: boolean }): string {
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
  /** Back to the defaults (hooks hidden, tool calls and agent messages shown). The "show the bar" choice is a display option, not a filter: kept. */
  reset: () => void;
  /** The three toggles are at their defaults. */
  isDefault: boolean;
}

interface FeedState extends ReadFilters {
  bar: boolean;
}

type Change = Partial<FilterPrefs> & { bar?: boolean };

/** Every hook instance of this page (the log and the popup of the header): a change made in one reaches the others at once (the storage event only reaches other tabs). */
const peers = new Set<(patch: Change, problem: string) => void>();

const applyChange = (current: FeedState, patch: Change, problem: string): FeedState => {
  const { bar, ...categories } = patch;
  return { prefs: { ...current.prefs, ...categories }, bar: bar ?? current.bar, problem: problem !== '' ? problem : current.problem };
};

/** The choices of the filter bar, a setter that remembers them (localStorage), and the follow-up of the other tabs and of the other users of this hook in the page. */
export function useLogFilters(): LogFiltersFeed {
  const [state, setState] = useState<FeedState>(() => ({ ...readFilterPrefs(), bar: readBarPref() }));
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === null || event.key === FILTER_PREFS_KEY) {
        setState({ ...readFilterPrefs(), bar: readBarPref() });
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
  const reset = useCallback(() => apply({ ...DEFAULT_FILTERS }), [apply]);
  const dismissProblem = useCallback(() => setState((current) => ({ ...current, problem: '' })), []);
  const isDefault = LOG_CATEGORIES.every((category) => state.prefs[category] === DEFAULT_FILTERS[category]);
  return { prefs: state.prefs, problem: state.problem, change, dismissProblem, showBar: state.bar, setShowBar, reset, isDefault };
}
