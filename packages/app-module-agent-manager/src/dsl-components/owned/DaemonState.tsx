import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/**
 * Whether the daemon is known to be down (`ownedError.code === 'daemon-not-running'` of GET /sessions). The workspace provides it; every action that needs the
 * daemon (Fork, Thread, Move) reads it, so none of them offers a click that cannot work. Without a provider (a bare component) nothing is known: not down.
 */
const DaemonDownContext = createContext(false);

export function DaemonStateProvider({ down, children }: { down: boolean; children: ReactNode }) {
  return <DaemonDownContext.Provider value={down}>{children}</DaemonDownContext.Provider>;
}

export function useDaemonDown(): boolean {
  return useContext(DaemonDownContext);
}
