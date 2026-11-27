import { useCallback, useEffect, useState } from 'react';
import type { SubagentsMode, TimelineOrder } from './subagentTypes.js';

export const SUBAGENT_PREFS_KEY = 'agent-manager.subagents.v1';

/** Window width (px) under which the panel starts collapsed (until the user opens it once): the log keeps its room on a small window. */
export const PANEL_OPEN_MIN_PX = 1500;

/** Window width (px) under which the panel is collapsed even when the user left it open on a wider window. */
export const PANEL_COLLAPSE_BELOW_PX = 900;

/** What the user chose for the sub-agent panel. Absent field: nothing chosen, the default applies. */
export interface SubagentPrefs {
  /** Undefined: collapsed under PANEL_OPEN_MIN_PX, open above. */
  collapsed?: boolean;
  mode: SubagentsMode;
  order: TimelineOrder;
}

export const DEFAULT_PREFS: SubagentPrefs = { mode: 'summary', order: 'recent' };

export const READ_PROBLEM = 'Your sub-agent panel settings could not be read: the defaults are used.';
export const WRITE_PROBLEM = 'Your sub-agent panel settings could not be saved: they hold until the page is reloaded.';

/** What was read: the choices, and a sentence when the stored value was unreadable or held something unknown (never silent). */
export interface ReadPrefs {
  prefs: SubagentPrefs;
  problem: string;
}

const warned = new Set<string>();
/** One console.warn per kind of problem and page load: the note in the panel is the user-facing message, this one is for whoever debugs. */
function warnOnce(problem: string, detail: unknown): void {
  if (!warned.has(problem)) {
    warned.add(problem);
    console.warn(`[agent-manager] ${problem}`, detail);
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined;
}

/** The saved choices. Nothing saved is not a problem; a storage that throws, text that is not JSON, or an unknown value is: the defaults show and `problem` says so. */
export function readPrefs(): ReadPrefs {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SUBAGENT_PREFS_KEY);
  } catch (error) {
    warnOnce(READ_PROBLEM, error);
    return { prefs: DEFAULT_PREFS, problem: READ_PROBLEM };
  }
  if (raw === null) {
    return { prefs: DEFAULT_PREFS, problem: '' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    warnOnce(READ_PROBLEM, error);
    return { prefs: DEFAULT_PREFS, problem: READ_PROBLEM };
  }
  const stored = asObject(parsed);
  if (stored === undefined) {
    warnOnce(READ_PROBLEM, raw);
    return { prefs: DEFAULT_PREFS, problem: READ_PROBLEM };
  }
  const { collapsed, mode, order } = stored;
  const known = (collapsed === undefined || typeof collapsed === 'boolean') && (mode === undefined || mode === 'summary' || mode === 'timeline') && (order === undefined || order === 'recent' || order === 'oldest');
  if (!known) {
    warnOnce(READ_PROBLEM, raw);
  }
  return {
    prefs: {
      ...(typeof collapsed === 'boolean' ? { collapsed } : {}),
      mode: mode === 'timeline' ? 'timeline' : 'summary',
      order: order === 'oldest' ? 'oldest' : 'recent',
    },
    problem: known ? '' : READ_PROBLEM,
  };
}

/**
 * Writes ONLY the changed fields: the stored object is read again at write time and merged, so another tab's choice for a field this one did not touch is
 * kept. Returns a sentence when the storage refused (the choice then holds until the page is reloaded).
 */
function writeMerged(patch: Partial<SubagentPrefs>): string {
  try {
    const raw = window.localStorage.getItem(SUBAGENT_PREFS_KEY);
    let stored: Record<string, unknown> = {};
    if (raw !== null) {
      try {
        stored = asObject(JSON.parse(raw)) ?? {};
      } catch {
        // Unreadable text is replaced by the new choice (the read side already said so).
      }
    }
    window.localStorage.setItem(SUBAGENT_PREFS_KEY, JSON.stringify({ ...stored, ...patch }));
    return '';
  } catch (error) {
    warnOnce(WRITE_PROBLEM, error);
    return WRITE_PROBLEM;
  }
}

export interface SubagentPrefsFeed {
  prefs: SubagentPrefs;
  /** A sentence to show (dismissible) when the settings could not be read or saved; empty otherwise. */
  problem: string;
  change: (patch: Partial<SubagentPrefs>) => void;
  dismissProblem: () => void;
}

/** The choices of the panel, a setter that remembers them (localStorage, per field), and the follow-up of the other tabs (the `storage` event). */
export function useSubagentPrefs(): SubagentPrefsFeed {
  const [state, setState] = useState<ReadPrefs>(readPrefs);
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === null || event.key === SUBAGENT_PREFS_KEY) {
        setState(readPrefs());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const change = useCallback((patch: Partial<SubagentPrefs>) => {
    // The write happens here, in the event handler: a state updater must stay free of side effects (React may run it twice).
    const problem = writeMerged(patch);
    setState((current) => ({ prefs: { ...current.prefs, ...patch }, problem: problem !== '' ? problem : current.problem }));
  }, []);
  const dismissProblem = useCallback(() => setState((current) => ({ ...current, problem: '' })), []);
  return { prefs: state.prefs, problem: state.problem, change, dismissProblem };
}
