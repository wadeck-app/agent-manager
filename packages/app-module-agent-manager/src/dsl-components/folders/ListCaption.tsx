import type { ReactNode } from 'react';

/** Small text above a list: where it comes from. */
export function ListCaption({ children }: { children: ReactNode }) {
  return <p className="px-2 pb-0.5 pt-1.5 text-xs font-medium text-muted">{children}</p>;
}
