import { ButtonAction } from '@wadeck-app/dsl-ui';

/** "Show 40 more" and "Show all (N left)" under a capped list. */
export function MoreButtons({ hidden, step, onMore, onAll }: { hidden: number; step: number; onMore: () => void; onAll: () => void }) {
  if (hidden === 0) {
    return null;
  }
  return (
    <li className="flex items-center gap-2 px-2 py-1.5">
      <ButtonAction variant="secondary" size="sm" onClick={onMore} label={`Show ${Math.min(step, hidden)} more`} />
      <ButtonAction variant="secondary" size="sm" onClick={onAll} label={`Show all (${hidden} left)`} />
    </li>
  );
}
