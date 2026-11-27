import { useSyncExternalStore } from 'react';
import { LOG_CATEGORIES, type Filtered } from './logFilters.js';

/** What the header needs of the filtering of the open log: the loaded entries of each family and what the filters hide. */
export type FilterSummary = Pick<Filtered, 'counts' | 'hidden' | 'hiddenTotal'>;

/**
 * The log viewer owns the entries, the header owns the button that filters them: the viewer publishes its summary here (like the status line data), the header
 * reads it. Nothing is published before the first answer of the log: the header then says it has nothing to count yet.
 */
const published = new Map<string, FilterSummary | undefined>();
const listeners = new Set<() => void>();

const key = (sessionId: string): string => sessionId.toLowerCase();

const same = (a: FilterSummary | undefined, b: FilterSummary | undefined): boolean =>
  a === b ||
  (a !== undefined && b !== undefined && a.hiddenTotal === b.hiddenTotal && LOG_CATEGORIES.every((category) => a.counts[category] === b.counts[category] && a.hidden[category] === b.hidden[category]));

/** Called by the log viewer after each filtering (and with undefined when it unmounts). A summary equal to the published one changes nothing. */
export function publishFilterSummary(sessionId: string, summary: FilterSummary | undefined): void {
  if (same(published.get(key(sessionId)), summary)) {
    return;
  }
  published.set(key(sessionId), summary);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The summary of the log of a session, undefined while its log is not loaded. */
export function useFilterSummary(sessionId: string): FilterSummary | undefined {
  return useSyncExternalStore(
    subscribe,
    () => published.get(key(sessionId)),
    () => undefined,
  );
}

/** Forgets everything published (tests). */
export function resetFilterSummaries(): void {
  published.clear();
  listeners.forEach((listener) => listener());
}
