import { createContext, useContext, type ReactNode } from 'react';

/**
 * How many live threads a session has (the list of rows knows: a thread row says which session it branches from). The workspace provides it; the Thread dialog
 * reads it to show the cap before the daemon refuses. Without a provider nothing is known: 0.
 */
const LiveThreadsContext = createContext<(sessionId: string) => number>(() => 0);

export function LiveThreadsProvider({ count, children }: { count: (sessionId: string) => number; children: ReactNode }) {
  return <LiveThreadsContext.Provider value={count}>{children}</LiveThreadsContext.Provider>;
}

export function useLiveThreads(sessionId: string): number {
  return useContext(LiveThreadsContext)(sessionId);
}
