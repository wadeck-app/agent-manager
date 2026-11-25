import type { GroupHeaderVariant } from '../logic/uiVariants.js';
import type { GroupId } from '../logic/states.js';

/**
 * The three looks of the A/B question `ui-group-header`, shared by every group header of the page: the folders and custom groups of the Tree, the state groups of the Groups mode
 * and the groups of the Custom mode. Classes are written in full: a class built at run time generates no CSS rule.
 */

/** The border colour of the left edge of a state group (the Groups mode), the colour of its heading. */
export const GROUP_STATE_EDGE: Record<GroupId, string> = {
  pinned: 'border-muted',
  'needs-you': 'border-hue-red',
  done: 'border-hue-blue',
  working: 'border-hue-yellow',
  idle: 'border-muted',
  other: 'border-hue-orange',
  ended: 'border-muted',
};

/**
 * The box of a header (every list): `herdr` is the Herdr panel header (a gap of 8 px above, 26 px high, 16 px from the left edge and 10 px from the right, so
 * its right column lines up with the state column of the rows); `bar` is a tinted bar with a 4 px coloured left edge; `pill` is as the Herdr box with a
 * taller line for the pill.
 */
export function groupHeaderBox(variant: GroupHeaderVariant, edge: string): string {
  switch (variant) {
    case 'herdr':
      return 'mt-2 min-h-[26px] pl-4 pr-2.5';
    case 'bar':
      return `mt-2 min-h-[34px] border-l-4 ${edge} bg-muted-bg pl-3 pr-2.5`;
    case 'pill':
      return 'mt-2 min-h-[34px] pl-4 pr-2.5';
    default:
      throw new Error(`groupHeaderBox: unhandled variant ${String(variant)}`);
  }
}

/** The count of a header, written after its name: 11 px grey (Herdr), a grey pill (bar), 12 px grey (pill). */
export function groupHeaderCount(variant: GroupHeaderVariant): string {
  switch (variant) {
    case 'herdr':
      return 'text-[11px] tabular-nums text-muted-tint';
    case 'bar':
      return 'rounded-full bg-surface px-1.5 py-0.5 text-xs tabular-nums text-muted-tint';
    case 'pill':
      return 'text-xs tabular-nums text-muted-tint';
    default:
      throw new Error(`groupHeaderCount: unhandled variant ${String(variant)}`);
  }
}

/** The name of a group: 11 px medium in the colour of `textClass` (herdr), 14 px bold in the content colour (bar), or an outlined pill in the colour of `textClass` (pill). */
export function GroupHeaderName({ variant, text, textClass, title }: { variant: GroupHeaderVariant; text: string; textClass: string; title?: string }) {
  if (variant === 'pill') {
    return (
      <span className={`truncate rounded-full border border-current px-2 py-0.5 text-xs font-semibold ${textClass}`} title={title ?? text}>
        {text}
      </span>
    );
  }
  return variant === 'bar' ? (
    <span className="truncate text-sm font-semibold text-content" title={title ?? text}>
      {text}
    </span>
  ) : (
    <span className={`truncate text-[11px] font-medium ${textClass}`} title={title ?? text}>
      {text}
    </span>
  );
}
