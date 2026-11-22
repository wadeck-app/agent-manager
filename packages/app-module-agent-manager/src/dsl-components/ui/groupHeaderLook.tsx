import type { GroupHeaderVariant } from '../logic/uiVariants.js';
import type { GroupId } from '../logic/states.js';

/**
 * The three looks of the A/B question `ui-group-header`, shared by every group header of the page: the folders of the Tree, the state groups of the Groups mode
 * and the custom groups. Classes are written in full: a class built at run time generates no CSS rule.
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

/** The classes of the header bar in the `bar` look (a tinted bar with a coloured left edge), nothing in the others. */
export function groupHeaderBar(variant: GroupHeaderVariant, edge: string): string {
  return variant === 'bar' ? `border-l-4 ${edge} bg-muted-bg pl-1` : '';
}

/** The count of a header: a small pill in the `bar` look. */
export function groupHeaderCount(variant: GroupHeaderVariant): string {
  return variant === 'bar' ? 'rounded-full bg-surface px-1.5 py-0.5' : '';
}

/** The name of a group: bold text, or an outlined pill in the `pill` look (in the colour of `textClass`). */
export function GroupHeaderName({ variant, text, textClass, title }: { variant: GroupHeaderVariant; text: string; textClass: string; title?: string }) {
  return variant === 'pill' ? (
    <span className={`truncate rounded-full border border-current px-2 py-0.5 text-xs font-semibold ${textClass}`} title={title ?? text}>
      {text}
    </span>
  ) : (
    <span className="truncate font-semibold text-content" title={title ?? text}>
      {text}
    </span>
  );
}
