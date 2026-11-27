import { useLayoutEffect, type RefObject } from 'react';

/** The shell's own marker of the header actions slot (HeaderActionsSlot of dsl-ui). */
const SLOT_SELECTOR = '[data-testid="header-actions-slot"]';

/**
 * The shell puts the header actions slot at the end of its trail row with `shrink-0`: a content that is wider than the row would push the page sideways instead of wrapping.
 * This caps `element` (a child of the slot) to what the row has left for it: the row content width minus its other fixed items (the menu toggle), the crumb (it grows and shrinks) not counted. The row is observed, so the cap follows the window and the side menu.
 * Without a slot (the actions are not rendered then) or without ResizeObserver (a test engine) nothing is capped: the window resize is the only trigger there.
 */
export function useTrailWidth(element: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const target = element.current;
    const slot = target?.closest<HTMLElement>(SLOT_SELECTOR) ?? null;
    const row = slot?.parentElement ?? null;
    if (target === null || slot === null || row === null) {
      return undefined;
    }
    const apply = () => {
      const style = window.getComputedStyle(row);
      const gap = Number.parseFloat(style.columnGap) || 0;
      // One gap already sits between the growing crumb and the slot.
      let room = row.clientWidth - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0) - gap;
      for (const sibling of Array.from(row.children)) {
        if (sibling !== slot && Number.parseFloat(window.getComputedStyle(sibling).flexGrow) === 0) {
          room -= sibling.getBoundingClientRect().width + gap;
        }
      }
      target.style.maxWidth = room > 0 ? `${Math.floor(room)}px` : '';
    };
    apply();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : undefined;
    observer?.observe(row);
    window.addEventListener('resize', apply);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', apply);
      target.style.maxWidth = '';
    };
  }, [element]);
}
