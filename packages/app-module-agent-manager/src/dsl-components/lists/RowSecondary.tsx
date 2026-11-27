import type { ReactNode } from 'react';
import { SrComma } from './SrComma.js';

/**
 * What separates the name of a row from its secondary text (the folder or the agent type). Settled (user decision 2026-11-27, the look "A Colour and space" of
 * the former A/B question `ui-row-separator`): no glyph that stands for a separator (no dot, no bullet, no dash, no rule), the name in the content colour, then
 * the secondary text in the muted colour after a clear 8 px gap. The secondary text gives way first (it is cut, then dropped) so the name keeps its room.
 */

/**
 * The wrap box of an inline secondary text in a one-line row: the least room it needs to be worth drawing (when less is left next to the name, the box wraps
 * out of the clipped line and the name keeps everything).
 */
export const SECONDARY_BOX = 'min-w-[7ch] basis-[7ch]';

/** The inline secondary text, to put after the name in a flex line that has the 8 px gap. */
export function InlineSecondary({ textClass, children }: { textClass: string; children: ReactNode }) {
  return (
    <>
      <SrComma />
      <span className={`min-w-0 truncate text-muted-tint ${textClass}`}>{children}</span>
    </>
  );
}
