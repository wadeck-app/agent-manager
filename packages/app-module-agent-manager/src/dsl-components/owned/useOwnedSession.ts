import { useCallback, useEffect, useState } from 'react';
import { failureText, requestJson } from '../data/http.js';
import type { OwnedListResponse, OwnedSessionDto } from '../shared.js';

export interface OwnedSessionState {
  /** The daemon's record of the session (resumable, permission mode, exit, leftover process...); undefined until the first answer for THIS session. */
  dto?: OwnedSessionDto;
  /** Why the record could not be read, with what to do; empty when fine. */
  error: string;
  refresh: () => void;
}

interface Held {
  /** The session the answer is about: an answer of another session is never shown (a resume could otherwise carry its leftover pid). */
  sessionId: string;
  dto?: OwnedSessionDto;
  error: string;
}

/**
 * The daemon's record of one owned session (GET /owned, the daemon caches it for 1.5 s): asked on selection, when the owned state of the row changes, and on
 * `refresh()`. The row of the list already says the state; this is what the header needs on top (can it be resumed, which mode it runs in, why it exited).
 * What is held belongs to one session id: for another id the hook answers empty until its own answer arrives.
 */
export function useOwnedSession(sessionId: string, ownedState: string | undefined, enabled: boolean): OwnedSessionState {
  const [held, setHeld] = useState<Held>({ sessionId, error: '' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      const result = await requestJson<OwnedListResponse>('/owned', { signal: controller.signal });
      if (controller.signal.aborted) {
        return;
      }
      if (!result.ok) {
        setHeld((previous) => ({ sessionId, error: result.text, ...(previous.sessionId === sessionId && previous.dto !== undefined ? { dto: previous.dto } : {}) }));
        return;
      }
      if (!result.value.ok) {
        const text = failureText(result.value, 200);
        setHeld((previous) => ({ sessionId, error: text, ...(previous.sessionId === sessionId && previous.dto !== undefined ? { dto: previous.dto } : {}) }));
        return;
      }
      const dto = result.value.sessions.find((candidate) => candidate.id.toLowerCase() === sessionId.toLowerCase());
      setHeld(dto === undefined ? { sessionId, error: `The daemon does not know the session ${sessionId}: it may have been forgotten. Reload the page.` } : { sessionId, dto, error: '' });
    })();
    return () => controller.abort();
  }, [sessionId, ownedState, enabled, tick]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);
  if (held.sessionId !== sessionId) {
    return { error: '', refresh };
  }
  return { ...(held.dto === undefined ? {} : { dto: held.dto }), error: held.error, refresh };
}
