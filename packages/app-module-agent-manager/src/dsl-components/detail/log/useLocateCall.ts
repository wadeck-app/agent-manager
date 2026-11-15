import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../deps.js';
import { requestJson } from '../deps.js';
import type { LocateResponse, SubagentDto } from '../deps.js';
import { LOCATE_MAX_PAGES } from './sizes.js';
import type { SubagentItem } from './subagentModel.js';
import type { OlderSearch, OlderSearchOptions } from './useLog.js';

/** The coarse state the rows and the announcements need. */
export type LocatePhase = 'idle' | 'searching' | 'found' | 'missing' | 'error';

export type MissingReason =
  /** The sub-agent has no recorded originating call (a named agent). */
  | 'no-call'
  /** The call was written by another sub-agent, whose own transcript is not served. */
  | 'nested'
  /** No line of the transcript of the session has the call. */
  | 'not-in-transcript'
  /** The search stopped at its page bound before reaching the call. */
  | 'bound'
  /** The user cancelled. */
  | 'cancelled'
  /** The start of the transcript was reached without the call (it moved while searching). */
  | 'start'
  /** The line was reached but the log shows no tool call for it. */
  | 'unseen';

export type LocateState =
  | { phase: 'idle' }
  | { phase: 'searching'; agentId: string; label: string; page: number; progress: number }
  | { phase: 'verifying'; agentId: string; label: string }
  | { phase: 'found'; agentId: string; label: string }
  | { phase: 'missing'; agentId: string; label: string; reason: MissingReason; message: string; toolUseId?: string; canSearchAgain: boolean }
  | { phase: 'error'; agentId: string; label: string; message: string; hint: string };

export interface LocateInput {
  sessionId: string;
  entries: readonly LogEntry[];
  items: readonly SubagentItem[];
  loadOlderUntil: (offset: number, options: OlderSearchOptions) => Promise<OlderSearch>;
}

export interface LocateFeed {
  selectedId: string | undefined;
  state: LocateState;
  phase: LocatePhase;
  /** Goes up each time the call is shown: the log scrolls to it and pulses it again. */
  pulse: number;
  /** Selects a sub-agent and brings its call into view; the same one again shows the call again. */
  select: (agentId: string) => void;
  /** Stops a search in progress (the selection stays). */
  cancel: () => void;
  /** Runs the search again for the selected sub-agent. */
  retry: () => void;
  /** Forgets the selection and hides every message. */
  clear: () => void;
}

/** True when `entries` hold the tool call that started the sub-agent (matched by the call id, or by the agent id the call's result gave). */
export function callIsLoaded(entries: readonly LogEntry[], dto: SubagentDto): boolean {
  return entries.some((entry) => entry.kind === 'tool-call' && ((dto.toolUseId !== undefined && entry.id === dto.toolUseId) || entry.subagentId === dto.agentId));
}

function phaseOf(state: LocateState): LocatePhase {
  switch (state.phase) {
    case 'idle':
      return 'idle';
    case 'searching':
    case 'verifying':
      return 'searching';
    case 'found':
    case 'missing':
    case 'error':
      return state.phase;
  }
}

/**
 * What happens when a sub-agent is clicked: show the call that started it. In the loaded entries: at once. Further back: ask the route where the line is (one
 * byte search), load older pages until it is held (bounded, cancellable, with progress), then show it. Not in the transcript, or not reachable: a state that
 * says why, never a silent no-op. A newer click or a clear ends the previous search.
 */
export function useLocateCall({ sessionId, entries, items, loadOlderUntil }: LocateInput): LocateFeed {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [state, setState] = useState<LocateState>({ phase: 'idle' });
  const [pulse, setPulse] = useState(0);
  const entriesRef = useRef(entries);
  const itemsRef = useRef(items);
  const abortRef = useRef<AbortController | null>(null);
  // Each run takes a number: an answer that arrives for an older run (another click, a clear) is dropped.
  const runRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  entriesRef.current = entries;
  itemsRef.current = items;

  useEffect(() => () => abortRef.current?.abort(), []);

  const show = useCallback((item: SubagentItem) => {
    setState({ phase: 'found', agentId: item.dto.agentId, label: item.title });
    setPulse((current) => current + 1);
  }, []);

  const run = useCallback(
    async (agentId: string): Promise<void> => {
      abortRef.current?.abort();
      const myRun = ++runRef.current;
      const stale = (): boolean => runRef.current !== myRun;
      const item = itemsRef.current.find((candidate) => candidate.dto.agentId === agentId);
      if (item === undefined) {
        setState({ phase: 'idle' });
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      const { dto } = item;
      const label = item.title;
      if (dto.toolUseId === undefined) {
        setState({ phase: 'missing', agentId, label, reason: 'no-call', message: `"${label}" has no recorded originating call: a sub-agent started by name has none, so there is no entry of the log to show.`, canSearchAgain: false });
        return;
      }
      if (callIsLoaded(entriesRef.current, dto)) {
        show(item);
        return;
      }
      // Visible at once: the answer of the route can take a moment on a large transcript.
      setState({ phase: 'searching', agentId, label, page: 0, progress: 0 });
      const located = await requestJson<LocateResponse>(`/sessions/${encodeURIComponent(sessionId)}/log/locate?toolUseId=${encodeURIComponent(dto.toolUseId)}`, { signal: controller.signal });
      if (stale()) {
        return;
      }
      // An aborted request resolves with an EMPTY text; any other failure keeps its text and is shown, even when the user also cancelled meanwhile.
      if (controller.signal.aborted && (located.ok || located.text === '')) {
        setState({ phase: 'missing', agentId, label, reason: 'cancelled', toolUseId: dto.toolUseId, canSearchAgain: true, message: `The search for the call that started "${label}" was cancelled before it reached it.` });
        return;
      }
      if (!located.ok) {
        setState({ phase: 'error', agentId, label, message: located.text, hint: 'Looking for the call failed; try again.' });
        return;
      }
      if (!located.value.ok) {
        const failure = located.value.error;
        setState({ phase: 'error', agentId, label, message: failure.message, hint: failure.hint });
        return;
      }
      if (!located.value.found || located.value.offset === undefined) {
        const nested = dto.parentAgentId !== undefined;
        setState({
          phase: 'missing',
          agentId,
          label,
          reason: nested ? 'nested' : 'not-in-transcript',
          toolUseId: dto.toolUseId,
          canSearchAgain: false,
          message: nested
            ? `The call that started "${label}" was written by another sub-agent. The transcript of a sub-agent is not served by this page, so the call cannot be shown here.`
            : `No line of this session's transcript holds the call that started "${label}". The transcript may have been rewritten, or the call belongs to a sub-agent whose own transcript is not served by this page.`,
        });
        return;
      }
      const target = located.value.offset;
      const first = entriesRef.current[0]?.offset;
      if (first !== undefined && first > target) {
        const span = Math.max(1, first - target);
        const outcome = await loadOlderUntil(target, {
          signal: controller.signal,
          maxPages: LOCATE_MAX_PAGES,
          onPage: (page, oldest) => setState({ phase: 'searching', agentId, label, page, progress: oldest === undefined ? 0 : Math.min(1, Math.max(0, (first - oldest) / span)) }),
        });
        if (stale()) {
          return;
        }
        if (outcome.status === 'cancelled') {
          setState({ phase: 'missing', agentId, label, reason: 'cancelled', toolUseId: dto.toolUseId, canSearchAgain: true, message: `The search for the call that started "${label}" was cancelled before it reached it.` });
          return;
        }
        if (outcome.status === 'error') {
          setState({ phase: 'error', agentId, label, message: outcome.message, hint: outcome.hint });
          return;
        }
        if (outcome.status === 'bound') {
          setState({ phase: 'missing', agentId, label, reason: 'bound', toolUseId: dto.toolUseId, canSearchAgain: true, message: `The call that started "${label}" is further back than ${outcome.pages} pages of the log. The search stopped there; it can go on from where it is.` });
          return;
        }
        if (outcome.status === 'start') {
          setState({ phase: 'missing', agentId, label, reason: 'start', toolUseId: dto.toolUseId, canSearchAgain: outcome.pages !== 0, message: outcome.pages === 0
            ? `The call that started "${label}" is not in the loaded range although the whole transcript is loaded: reload the log, it may have been rewritten.`
            : `The start of the transcript was reached without finding the call that started "${label}": the transcript changed while searching.` });
          return;
        }
      }
      // The entries are in; the effect below checks the log really shows the call, then shows it.
      setState({ phase: 'verifying', agentId, label });
    },
    [loadOlderUntil, sessionId, show],
  );

  // After the older pages are in: the call must be among the entries, else say so (never a silent success).
  useEffect(() => {
    if (state.phase !== 'verifying') {
      return;
    }
    const item = itemsRef.current.find((candidate) => candidate.dto.agentId === state.agentId);
    if (item === undefined) {
      setState({ phase: 'idle' });
    } else if (callIsLoaded(entries, item.dto)) {
      show(item);
    } else {
      setState({ phase: 'missing', agentId: state.agentId, label: state.label, reason: 'unseen', toolUseId: item.dto.toolUseId, canSearchAgain: true, message: `The transcript has a line for the call that started "${state.label}", but the log shows no tool call for it (the line may be unreadable).` });
    }
  }, [state, entries, show]);

  const select = useCallback(
    (agentId: string) => {
      setSelectedId(agentId);
      void run(agentId);
    },
    [run],
  );
  // Cancel works in every phase: the request and the page loads stop through the signal; the verifying phase has nothing to abort, so it ends here.
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    const current = stateRef.current;
    if (current.phase === 'verifying') {
      runRef.current += 1;
      const toolUseId = itemsRef.current.find((candidate) => candidate.dto.agentId === current.agentId)?.dto.toolUseId;
      setState({ phase: 'missing', agentId: current.agentId, label: current.label, reason: 'cancelled', toolUseId, canSearchAgain: true, message: `The search for the call that started "${current.label}" was cancelled before it was shown.` });
    }
  }, []);
  const retry = useCallback(() => {
    if (selectedId !== undefined) {
      void run(selectedId);
    }
  }, [run, selectedId]);
  const clear = useCallback(() => {
    abortRef.current?.abort();
    runRef.current += 1;
    setSelectedId(undefined);
    setState({ phase: 'idle' });
  }, []);

  return { selectedId, state, phase: phaseOf(state), pulse, select, cancel, retry, clear };
}
