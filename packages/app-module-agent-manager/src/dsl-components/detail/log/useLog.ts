import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { LogOk, LogResponse } from '../deps.js';
import { requestJson } from '../deps.js';
import { initialLogState, logReducer, type LogState } from './logReducer.js';
import { PAGE_LIMIT, POLL_MS } from './sizes.js';

/** What went wrong, with what to do. The entries already shown stay on screen. */
export interface LogProblem {
  /** Machine code of the API ('transcript-unreadable', ...), absent for a network failure. */
  code?: string;
  message: string;
  hint: string;
  /** 'older': loading older entries failed; 'poll': the live refresh failed. */
  source: 'poll' | 'older';
}

export interface LogFeed {
  state: LogState;
  problem: LogProblem | undefined;
  loadingOlder: boolean;
  /** Ask the server again now (the Retry button). */
  retry: () => void;
  loadOlder: () => void;
}

function problemOf(source: LogProblem['source'], answer: Exclude<LogResponse, LogOk>): LogProblem {
  const { code, message, hint } = answer.error;
  return { code, message, hint, source };
}

/**
 * The log of one session: the newest entries first, then `after=<cursor>` every POLL_MS while the tab is visible (paused when hidden, an immediate refresh
 * when it shows again). A stale cursor reloads the tail once by itself; a second one, or an unreadable transcript, is a problem the viewer shows next to the
 * entries it already has. Keyed by session id: another session starts from scratch and an answer for the previous one is dropped.
 */
export function useLog(sessionId: string): LogFeed {
  const [state, dispatch] = useReducer(logReducer, initialLogState);
  const [problem, setProblem] = useState<LogProblem | undefined>(undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const olderCursor = useRef<string | null>(null);
  const olderBusy = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const pollNow = useRef<() => void>(() => undefined);
  olderCursor.current = state.olderCursor;

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    const base = `/sessions/${encodeURIComponent(sessionId)}/log`;
    let cursor: string | null = null;
    let staleRetried = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    dispatch({ type: 'reset' });
    setProblem(undefined);
    olderBusy.current = false;
    setLoadingOlder(false);

    const schedule = (ms: number): void => {
      clearTimeout(timer);
      timer = setTimeout(() => void run(), ms);
    };

    const run = async (): Promise<void> => {
      if (running || controller.signal.aborted) {
        return;
      }
      if (document.hidden) {
        // Paused: the visibility listener refreshes at once when the tab shows again.
        return;
      }
      running = true;
      const first = cursor === null;
      const query = first ? `limit=${PAGE_LIMIT}` : `limit=${PAGE_LIMIT}&after=${encodeURIComponent(cursor ?? '')}`;
      const result = await requestJson<LogResponse>(`${base}?${query}`, { signal: controller.signal });
      running = false;
      if (controller.signal.aborted) {
        return;
      }
      let next = POLL_MS;
      if (!result.ok) {
        setProblem({ message: result.text, hint: 'The log refreshes by itself every few seconds; use Retry to ask now.', source: 'poll' });
      } else if (!result.value.ok) {
        const answer = result.value;
        if (answer.error.code === 'cursor-stale' && !staleRetried) {
          // The transcript was replaced: read the newest entries again, once, without bothering the user.
          staleRetried = true;
          cursor = null;
          next = 0;
        } else {
          setProblem(problemOf('poll', answer));
        }
      } else {
        const answer = result.value;
        dispatch({ type: first ? 'tail' : 'after', answer });
        const advanced = answer.cursor !== null && answer.cursor !== cursor;
        cursor = answer.cursor ?? cursor;
        setProblem(undefined);
        if (!first) {
          staleRetried = false;
        }
        if (answer.more && !first && !advanced) {
          // The server says there is more but the cursor did not move: never re-ask at once, back off to the normal pace and say so.
          setProblem({ message: 'The log reader did not advance (the cursor stayed the same while more was announced).', hint: 'It retries at the normal pace; report it if it persists.', source: 'poll' });
          next = POLL_MS;
        } else {
          next = answer.more ? 0 : POLL_MS;
        }
      }
      schedule(next);
    };

    const onVisibility = (): void => {
      if (!document.hidden) {
        clearTimeout(timer);
        void run();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    pollNow.current = () => {
      clearTimeout(timer);
      void run();
    };
    void run();
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sessionId]);

  const retry = useCallback(() => pollNow.current(), []);

  const loadOlder = useCallback(() => {
    const before = olderCursor.current;
    const controller = controllerRef.current;
    if (before === null || olderBusy.current || controller === null) {
      return;
    }
    olderBusy.current = true;
    setLoadingOlder(true);
    void requestJson<LogResponse>(`/sessions/${encodeURIComponent(sessionId)}/log?limit=${PAGE_LIMIT}&before=${encodeURIComponent(before)}`, { signal: controller.signal }).then((result) => {
      olderBusy.current = false;
      if (controller.signal.aborted) {
        return;
      }
      setLoadingOlder(false);
      if (!result.ok) {
        setProblem({ message: result.text, hint: 'Older entries could not be loaded; use Retry.', source: 'older' });
      } else if (!result.value.ok) {
        setProblem(problemOf('older', result.value));
      } else {
        dispatch({ type: 'older', answer: result.value });
        setProblem((previous) => (previous?.source === 'older' ? undefined : previous));
      }
    });
  }, [sessionId]);

  const retryAll = useCallback(() => {
    if (problem?.source === 'older') {
      loadOlder();
    } else {
      retry();
    }
  }, [problem, loadOlder, retry]);

  return { state, problem, loadingOlder, retry: retryAll, loadOlder };
}
