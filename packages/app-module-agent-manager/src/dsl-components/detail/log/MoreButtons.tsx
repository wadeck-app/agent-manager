import { FOCUS_RING } from '../deps.js';

/** "Show 40 more" and "Show all (N left)" under a capped list. */
export function MoreButtons({ hidden, step, onMore, onAll }: { hidden: number; step: number; onMore: () => void; onAll: () => void }) {
  if (hidden === 0) {
    return null;
  }
  const button = `rounded border border-border px-2 py-1 text-xs text-content hover:bg-muted-bg ${FOCUS_RING}`;
  return (
    <li className="flex items-center gap-2 px-2 py-1.5">
      <button type="button" onClick={onMore} className={button}>
        Show {Math.min(step, hidden)} more
      </button>
      <button type="button" onClick={onAll} className={button}>
        Show all ({hidden} left)
      </button>
    </li>
  );
}
