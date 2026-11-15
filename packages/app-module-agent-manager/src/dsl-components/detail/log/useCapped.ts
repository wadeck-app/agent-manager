import { useState } from 'react';
import { PAGE_SIZE } from './subagentModel.js';

/** The first `size` of a long list, and buttons to show more: 70 rows are a wall, and 500 would be a slow one. */
export function useCapped<T>(items: readonly T[], size = PAGE_SIZE): { shown: T[]; hidden: number; more: () => void; all: () => void } {
  const [limit, setLimit] = useState(size);
  return { shown: items.slice(0, limit), hidden: Math.max(0, items.length - limit), more: () => setLimit((current) => current + size), all: () => setLimit(Number.MAX_SAFE_INTEGER) };
}
