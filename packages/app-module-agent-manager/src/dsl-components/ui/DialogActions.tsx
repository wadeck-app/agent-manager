import { DialogFooter } from '@wadeck-app/dsl-ui';
import type { ReactNode } from 'react';

/** The button row of a dialog (the base DialogFooter): it sticks to the bottom of the scrolling body, so the buttons never fall below the fold (audit D10). */
export function DialogActions({ children }: { children: ReactNode }) {
  // -bottom-4, not bottom-0: the sticky offset counts from the content box of the body (which has 16 px of padding), so bottom-0 pulled the row 16 px up over the last line of a dialog that does not scroll (seen on the Thread dialog's folder line).
  return <DialogFooter className="sticky -bottom-4 z-10 -mx-4 -mb-4 bg-surface px-4 pb-3">{children}</DialogFooter>;
}
