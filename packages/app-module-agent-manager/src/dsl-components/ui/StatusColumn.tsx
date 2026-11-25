import type { ReactNode } from 'react';

/**
 * The fixed column on the right of the Herdr rows and of every group header (the state light of a row, the settings or state icon of a header): 28 px wide (the size of a row icon button), the
 * icon centred in it, so all the icons of the list sit on ONE vertical axis (the 26 px customize button of the Herdr WAgents panel does the same with its
 * header icon, research/ui-audit.md). Classes written in full. A pill with words ("Needs you") is wider than the column: it takes the `pill` form, right aligned.
 */
export const STATUS_COLUMN = 'flex h-7 w-7 shrink-0 items-center justify-center';
export const STATUS_COLUMN_PILL = 'flex h-7 min-w-7 shrink-0 items-center justify-end pr-1';

export function StatusColumn({ children, pill = false, className = '' }: { children: ReactNode; pill?: boolean; className?: string }) {
  return (
    <span data-status-column={pill ? 'pill' : 'icon'} className={`${pill ? STATUS_COLUMN_PILL : STATUS_COLUMN}${className === '' ? '' : ` ${className}`}`}>
      {children}
    </span>
  );
}
