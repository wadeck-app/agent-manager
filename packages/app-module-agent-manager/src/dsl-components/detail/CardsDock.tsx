import type { ReactNode } from 'react';

/**
 * The permission cards between the log and the reply box. They hold at most half of the detail panel (a card that is taller scrolls inside, keeping its header and its buttons in view), and they shrink before the log does
 * (the log keeps its own minimum height), so a long request never pushes the log or the reply box out of the panel. Empty when no card shows.
 */
export function CardsDock({ children }: { children: ReactNode }) {
  return (
    <div data-cards-dock="" className="flex min-h-0 max-h-[50%] shrink flex-col overflow-y-auto">
      {children}
    </div>
  );
}
