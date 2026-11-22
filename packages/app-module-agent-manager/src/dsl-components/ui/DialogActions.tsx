import { DialogFooter } from '@wadeck-app/dsl-ui';
import type { ReactNode } from 'react';

/** The button row of a dialog (the base DialogFooter): it sticks to the bottom of the scrolling body, so the buttons never fall below the fold (audit D10). */
export function DialogActions({ children }: { children: ReactNode }) {
  return <DialogFooter className="sticky bottom-0 z-10 -mx-4 -mb-4 bg-surface px-4 pb-3">{children}</DialogFooter>;
}
