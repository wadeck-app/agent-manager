import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJson } from '../deps.js';
import type { ReplyStatusOk, ReplyStatusResponse } from '../deps.js';

export const STATUS_POLL_MS = 2000;

export interface ReplyStatusState {
  /** No answer yet. */
  loading: boolean;
  /** The last good answer. Kept when a later poll fails (then `error` is set too). */
  status?: ReplyStatusOk;
  /** Why the status could not be read, with what to do. */
  error?: string;
  refresh: () => void;
}

/**
 * GET /sessions/:id/reply/status: once on mount, again on `refresh()` (which also restarts the loop), then every STATUS_POLL_MS as long as `follow` says
 * the last answer holds something not final yet (`probeAll` asks the server to probe every transport, not only the selected one: the transport menu is open) and the tab is visible (a hidden tab skips the request). The next request starts when the previous answer arrived.
 */
export function useReplyStatus(sessionId: string, follow: (status: ReplyStatusOk | undefined) => boolean, probeAll = false): ReplyStatusState {
  const followRef = useRef(follow);
  followRef.current = follow;
  const last = useRef<ReplyStatusOk | undefined>(undefined);
  const [state, setState] = useState<Omit<ReplyStatusState, 'refresh'>>({ loading: true });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async (): Promise<void> => {
      if (document.visibilityState !== 'hidden') {
        const result = await requestJson<ReplyStatusResponse>(`/sessions/${encodeURIComponent(sessionId)}/reply/status${probeAll ? '?probe=all' : ''}`, { signal: controller.signal });
        if (controller.signal.aborted) {
          return;
        }
        if (!result.ok) {
          setState((previous) => ({ ...previous, loading: false, error: result.text }));
        } else if (!result.value.ok) {
          const { message, hint } = result.value.error;
          setState((previous) => ({ ...previous, loading: false, error: `${message.replace(/\.$/, '')}. ${hint}` }));
        } else {
          last.current = result.value;
          setState({ loading: false, status: result.value });
        }
      }
      if (followRef.current(last.current)) {
        timer = setTimeout(() => void run(), STATUS_POLL_MS);
      }
    };
    void run();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [sessionId, tick, probeAll]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);
  return { ...state, refresh };
}
