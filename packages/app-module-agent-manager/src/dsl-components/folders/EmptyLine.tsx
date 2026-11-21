import type { ReactNode } from 'react';

/** "Nothing here", said, with the next step when there is one. */
export function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="px-2 py-1.5 text-sm text-muted">
      {children}
    </p>
  );
}
