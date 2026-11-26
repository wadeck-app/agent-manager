import { useEffect, useRef } from 'react';
import type { RailTab } from './log/SubagentAside.js';

/**
 * The header asks the panel beside the log (which it does not own) to show a tab: the blocked chip opens the Permissions tab. A request is an event, not a state:
 * the panel that listens answers it once; with no panel mounted nobody answers and the request is lost (nothing to open).
 */
type Listener = (sessionId: string, tab: RailTab) => void;
const listeners = new Set<Listener>();

export function requestRailTab(sessionId: string, tab: RailTab): void {
  listeners.forEach((listener) => listener(sessionId.toLowerCase(), tab));
}

/** Calls `onRequest` for each request aimed at this session. */
export function useRailRequests(sessionId: string, onRequest: (tab: RailTab) => void): void {
  const latest = useRef(onRequest);
  latest.current = onRequest;
  useEffect(() => {
    const own = sessionId.toLowerCase();
    const listener: Listener = (target, tab) => {
      if (target === own) {
        latest.current(tab);
      }
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [sessionId]);
}
