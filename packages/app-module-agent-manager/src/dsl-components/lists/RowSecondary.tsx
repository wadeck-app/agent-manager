import { Folder } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RowSeparatorVariant } from '../logic/uiVariants.js';
import { Chip } from '../ui/Chip.js';
import { SrComma } from './SrComma.js';

/**
 * What separates the name of a row from its secondary text (the folder or the agent type), the A/B question `ui-row-separator`. No variant draws a glyph that
 * stands for a separator (no dot, no bullet, no dash): the colour and a gap, a thin rule, a chip, an icon, or a second line.
 */

/** Variant `stacked`: the secondary text is a second line under the name, not an inline piece. */
export function isStacked(variant: RowSeparatorVariant): variant is 'stacked' {
  return variant === 'stacked';
}

/**
 * The wrap box of an inline secondary text in a one-line row: the least room it needs to be worth drawing (when less is left next to the name, the box wraps
 * out of the clipped line and the name keeps everything). Written in full: a class built at run time generates no CSS rule.
 */
export function secondaryBox(variant: RowSeparatorVariant): string {
  switch (variant) {
    case 'rule':
      return 'min-w-[9ch] basis-[9ch] gap-2';
    case 'chip':
      return 'min-w-[9ch] basis-[9ch]';
    case 'folder':
      return 'min-w-[9ch] basis-[9ch] gap-1';
    case 'space':
    case 'stacked':
      return 'min-w-[7ch] basis-[7ch]';
    default:
      throw new Error(`secondaryBox: unhandled variant ${String(variant)}`);
  }
}

/**
 * The inline secondary text of variants A to D, to put after the name in a flex line that has the 8 px gap. Variant E is drawn by the caller (a second line),
 * and a caller that cannot stack asks for `space`.
 */
export function InlineSecondary({ variant, textClass, children }: { variant: Exclude<RowSeparatorVariant, 'stacked'>; textClass: string; children: ReactNode }) {
  switch (variant) {
    case 'space':
      return (
        <>
          <SrComma />
          <span className={`min-w-0 truncate text-muted-tint ${textClass}`}>{children}</span>
        </>
      );
    case 'rule':
      return (
        <>
          <SrComma />
          <span aria-hidden="true" data-row-rule="" className="h-3 w-px shrink-0 bg-muted-tint opacity-60" />
          <span className={`min-w-0 truncate text-muted-tint ${textClass}`}>{children}</span>
        </>
      );
    case 'chip':
      return (
        <>
          <SrComma />
          <Chip size="xs" data-row-chip="">
            <span className="truncate">{children}</span>
          </Chip>
        </>
      );
    case 'folder':
      return (
        <>
          <SrComma />
          <Folder aria-hidden="true" data-row-folder-icon="" className="h-3 w-3 shrink-0 text-muted-tint" />
          <span className={`min-w-0 truncate text-muted-tint ${textClass}`}>{children}</span>
        </>
      );
    default:
      throw new Error(`InlineSecondary: unhandled variant ${String(variant)}`);
  }
}
