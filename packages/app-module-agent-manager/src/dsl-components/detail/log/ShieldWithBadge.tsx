import { ShieldCheck } from 'lucide-react';

/** The shield with the number of active bypasses as a badge, nothing drawn for zero (the label says it). */
export function ShieldWithBadge({ count }: { count: number | undefined }) {
  return (
    <>
      <ShieldCheck aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
      {count !== undefined && count > 0 ? (
        <span data-permissions-badge="" aria-hidden="true" className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-medium leading-4 text-white tabular-nums">
          {count}
        </span>
      ) : null}
    </>
  );
}

