import { useLayoutEffect, type RefObject } from 'react';

/** The most a page may stretch past its own box on one side: the shell frame (16 px) plus the page frame (16 px), with room to spare, never more. */
export const MAX_BLEED_PX = 48;

export interface Bleed {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Clamps one side: a padding we cannot read (NaN, negative) counts as none, an absurd one stops at the limit. */
export function clampBleed(value: number): number {
  return Number.isFinite(value) ? Math.min(MAX_BLEED_PX, Math.max(0, Math.round(value))) : 0;
}

/** A computed length in pixels; a value the environment does not give (jsdom leaves a border width empty) counts as none. */
function px(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * How far `element` has to stretch to reach the edges of `boundary`: the sum of the padding (and border) every ancestor between them puts around it.
 * Measured from the computed styles, so it follows whatever frame the shell and the page put there; each side is clamped (MAX_BLEED_PX).
 */
export function measureBleed(element: HTMLElement, boundary: HTMLElement): Bleed {
  const sum = { top: 0, right: 0, bottom: 0, left: 0 };
  // Content above the element (an error badge of the page) must not be covered: from the first level that has a previous sibling, the top is not stretched.
  let topFree = element.previousElementSibling === null;
  for (let node = element.parentElement; node !== null && node !== boundary; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (topFree) {
      sum.top += px(style.paddingTop) + px(style.borderTopWidth);
    }
    if (node.previousElementSibling !== null && node.parentElement !== boundary) {
      topFree = false;
    }
    sum.right += px(style.paddingRight) + px(style.borderRightWidth);
    sum.bottom += px(style.paddingBottom) + px(style.borderBottomWidth);
    sum.left += px(style.paddingLeft) + px(style.borderLeftWidth);
  }
  return { top: clampBleed(sum.top), right: clampBleed(sum.right), bottom: clampBleed(sum.bottom), left: clampBleed(sum.left) };
}

/**
 * The height that fills the viewport below an element. `rectTop` is viewport-relative (getBoundingClientRect), so a page scrolled by `scrolled` px would
 * show an element that sits `scrolled` px higher than where it is when the page is at the top: the scroll is added back, or the height would be too large
 * by exactly that much and the page could never come back to "no scroll".
 */
export function fillHeight(rectTop: number, scrolled: number, viewportHeight: number, minHeight: number): number {
  return Math.max(minHeight, Math.floor(viewportHeight - (rectTop + scrolled)));
}

/** How far the page is scrolled: the window, and `main` when the shell makes it the scroll container. */
function scrolledBy(main: HTMLElement | null): number {
  return window.scrollY + (main?.scrollTop ?? 0);
}

/**
 * Makes the element use the whole content area of the shell: it stretches over the padding the shell and the page frame put around it (negative margins,
 * bounded by MAX_BLEED_PX and measured, see measureBleed), and it is as tall as what is left of the viewport below its top edge, so there is no page scroll
 * and no dead margin: the list and the log scroll inside it. The app-core shell offers no fill or full-bleed page mode (frontend-shell ModulePage.tsx wraps
 * every page in PageContent), hence this. A style set through the DOM is allowed by the page's content-security policy, unlike a style attribute in markup.
 *
 * Without a `<main>` ancestor (a test, a standalone render) there is no frame to stretch over: the element only takes the height.
 *
 * The first fit is synchronous (before the first paint). Later ones (resize, the shell menu dragged, a banner above) are batched in one animation frame, and a
 * style is only written when its value changed: writing the height resizes the parent, which the ResizeObserver reports, which fits again: without that check
 * the loop would never settle.
 */
export function useFillContentArea(ref: RefObject<HTMLElement | null>, minHeight: number): void {
  useLayoutEffect(() => {
    const applied = new Map<'marginTop' | 'marginRight' | 'marginBottom' | 'marginLeft' | 'height', string>();
    const apply = (element: HTMLElement, name: 'marginTop' | 'marginRight' | 'marginBottom' | 'marginLeft' | 'height', value: string): void => {
      if (applied.get(name) !== value) {
        applied.set(name, value);
        element.style[name] = value;
      }
    };
    const fit = (): void => {
      const element = ref.current;
      if (element === null) {
        return;
      }
      const main = element.closest('main');
      const bleed = main === null ? { top: 0, right: 0, bottom: 0, left: 0 } : measureBleed(element, main);
      apply(element, 'marginTop', `-${bleed.top}px`);
      apply(element, 'marginRight', `-${bleed.right}px`);
      apply(element, 'marginBottom', `-${bleed.bottom}px`);
      apply(element, 'marginLeft', `-${bleed.left}px`);
      apply(element, 'height', `${fillHeight(element.getBoundingClientRect().top, scrolledBy(main), window.innerHeight, minHeight)}px`);
    };
    let frame: number | undefined;
    const schedule = (): void => {
      if (frame === undefined) {
        frame = window.requestAnimationFrame(() => {
          frame = undefined;
          fit();
        });
      }
    };
    fit();
    window.addEventListener('resize', schedule);
    // The shell menu is resizable and the content above (breadcrumb, banners) can change height after the first paint.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    const main = ref.current?.closest('main');
    if (main) {
      observer?.observe(main);
    }
    if (ref.current?.parentElement) {
      observer?.observe(ref.current.parentElement);
    }
    return () => {
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [ref, minHeight]);
}
