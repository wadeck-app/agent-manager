import type { ReactNode } from 'react';

/** A table that scrolls sideways inside its section instead of stretching the page. */
export function TableBox({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table aria-label={label} className="w-full border-collapse">
        {children}
      </table>
    </div>
  );
}
