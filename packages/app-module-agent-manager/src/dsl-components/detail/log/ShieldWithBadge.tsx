import { ShieldCheck } from 'lucide-react';
import { CountBadge } from '../deps.js';

/** The shield with the number of active bypasses as a badge, nothing drawn for zero (the label says it). */
export function ShieldWithBadge({ count }: { count: number | undefined }) {
  return (
    <>
      <ShieldCheck aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
      {count !== undefined && count > 0 ? (
        <CountBadge data-permissions-badge="" aria-hidden="true" tone="primary" className="absolute right-0 -top-0.5">
          {count}
        </CountBadge>
      ) : null}
    </>
  );
}

