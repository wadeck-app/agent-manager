import type { ReactNode } from 'react';

/**
 * The permission cards between the log and the reply box. They hold at most 35 percent of the detail panel and scroll inside beyond, and they shrink before the log does
 * (the log keeps its own minimum height), so a long request never pushes the log or the reply box out of the panel. Empty when no card shows.
 */
export function CardsDock({ children }: { children: ReactNode }) {
  return (
    <div data-cards-dock="" className="flex min-h-0 max-h-[35%] shrink flex-col overflow-y-auto">
      {children}
    </div>
  );
}
