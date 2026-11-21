import { useCallback, useEffect, useState } from 'react';
import { failureText, requestJson } from '../data/http.js';
import type { HcPermissionOk, HcPermissionResponse } from '../shared.js';

/** The poll while the session waits for a permission (the user is expected to answer). */
export const HC_POLL_MS = 2000;
/** The poll after a refusal that does not change by itself (no herdr-core terminal, hc missing): slower, it only notices a fix. */
export const HC_SLOW_POLL_MS = 10_000;

/** Codes of a refusal that stays until the user fixes the setup. */
const STATIC_CODES = ['no-terminal', 'ambiguous-terminal', 'hc-missing', 'hc-cannot-start'];

export interface HcPermissionState {
  /** The last good answer; undefined until the first one, kept when a later poll fails (a dialog that waits must not vanish on one failed poll). */
  answer: HcPermissionOk | undefined;
  /** Why the session cannot be asked (a refusal with its fix, or the transport), empty when fine. */
  error: string;
  /** The code of the refusal, '' when none. */
  errorCode: string;
  refresh: () => void;
}

/**
 * GET /sessions/:id/hc-permission every 2 s while `enabled` (the session waits for something), 10 s after a refusal that only a change of setup removes.
 * A hidden tab skips the request. The next request starts when the previous answer arrived.
 */
export function useHcPermission(sessionId: string, enabled: boolean): HcPermissionState {
  const [state, setState] = useState<Omit<HcPermissionState, 'refresh'>>({ answer: undefined, error: '', errorCode: '' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setState({ answer: undefined, error: '', errorCode: '' });
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async (): Promise<void> => {
      let next = HC_POLL_MS;
      if (document.visibilityState !== 'hidden') {
        const result = await requestJson<HcPermissionResponse>(`/sessions/${encodeURIComponent(sessionId)}/hc-permission`, { signal: controller.signal });
        if (controller.signal.aborted) {
          return;
        }
        if (!result.ok) {
          setState((previous) => ({ ...previous, error: result.text, errorCode: 'request-failed' }));
        } else if (!result.value.ok) {
          const { code } = result.value.error;
          next = STATIC_CODES.includes(code) ? HC_SLOW_POLL_MS : HC_POLL_MS;
          setState({ answer: undefined, error: failureText(result.value, 200), errorCode: code });
        } else {
          setState({ answer: result.value, error: '', errorCode: '' });
        }
      }
      timer = setTimeout(() => void run(), next);
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
