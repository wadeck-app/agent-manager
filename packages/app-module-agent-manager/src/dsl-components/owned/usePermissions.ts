import { useCallback, useEffect, useRef, useState } from 'react';
import { failureText, requestJson } from '../data/http.js';
import type { OwnedPermissionDto, OwnedPermissionsResponse } from '../shared.js';

/** The poll while a request waits (the user is expected to answer), and the slower one that notices a request arriving on a session that looked quiet. */
export const FAST_POLL_MS = 2000;
export const SLOW_POLL_MS = 5000;

export interface PermissionsState {
  /** Oldest first: the order the agent asked in. */
  permissions: OwnedPermissionDto[];
  /** Why the list could not be read, with what to do; empty when fine. The last good list is kept (a request that waits must not vanish on one failed poll). */
  error: string;
  /** True until the first answer. */
  loading: boolean;
  refresh: () => void;
}

/**
 * GET /owned/:id/permissions, every 2 s while a request waits (`fast`: the owned state is requires_action or the row counts pending requests), every 5 s
 * otherwise, and not at all when `enabled` is false (a session that is not a live stream-json one). A hidden tab skips the request. The next request starts
 * when the previous answer arrived.
 */
export function usePermissions(sessionId: string, enabled: boolean, fast: boolean): PermissionsState {
  const [state, setState] = useState<Omit<PermissionsState, 'refresh'>>({ permissions: [], error: '', loading: true });
  const [tick, setTick] = useState(0);
  const fastRef = useRef(fast);
  fastRef.current = fast;
  const waitingCount = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setState({ permissions: [], error: '', loading: false });
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async (): Promise<void> => {
      if (document.visibilityState !== 'hidden') {
        const result = await requestJson<OwnedPermissionsResponse>(`/owned/${encodeURIComponent(sessionId)}/permissions`, { signal: controller.signal });
        if (controller.signal.aborted) {
          return;
        }
        if (!result.ok) {
          setState((previous) => ({ ...previous, loading: false, error: result.text }));
        } else if (!result.value.ok) {
          setState((previous) => ({ ...previous, loading: false, error: failureText(result.value, 200) }));
        } else {
          const permissions = [...result.value.permissions].sort((a, b) => a.receivedAt - b.receivedAt);
          waitingCount.current = permissions.length;
          setState({ permissions, error: '', loading: false });
        }
      }
      // A request that waits keeps the fast poll even if the row has not caught up (the page polls every 5 s).
      timer = setTimeout(() => void run(), fastRef.current || waitingCount.current > 0 ? FAST_POLL_MS : SLOW_POLL_MS);
    };
    void run();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [sessionId, enabled, tick]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);
  return { ...state, refresh };
}
