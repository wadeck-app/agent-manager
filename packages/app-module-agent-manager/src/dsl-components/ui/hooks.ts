import { useCallback, useEffect, useLayoutEffect, useState, type KeyboardEvent, type RefObject } from 'react';
import { isTypingTarget, navTarget } from '../logic/nav.js';

/** The current time, refreshed every `everyMs` (the "3m" of a row ages without a poll). */
export function useNow(everyMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

/**
 * Makes the element as tall as what is left of the viewport below its top edge (no page scroll: the list and the log scroll inside it).
 * A style set through the DOM is allowed by the page's content-security policy, unlike a style attribute in markup.
 */
export function useFillViewport(ref: RefObject<HTMLElement | null>, minHeight: number, bottomGap = 16): void {
  useLayoutEffect(() => {
    const fit = (): void => {
      const element = ref.current;
      if (element === null) {
        return;
      }
      element.style.height = `${Math.max(minHeight, Math.floor(window.innerHeight - element.getBoundingClientRect().top - bottomGap))}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    // The content above (banners, the filter) can change height after the first paint.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(fit);
    if (ref.current?.parentElement) {
      observer?.observe(ref.current.parentElement);
    }
    return () => {
      window.removeEventListener('resize', fit);
      observer?.disconnect();
    };
  }, [ref, minHeight, bottomGap]);
}

/** Moves the focus to the message composer of the detail pane, if the next step has put one there (it marks itself with data-agent-composer). */
export function focusComposer(): boolean {
  const composer = document.querySelector<HTMLElement>('[data-agent-composer]');
  composer?.focus();
  return composer !== null;
}

/** Moves the focus to the search field of the list (the one that marks itself with data-agent-search), if the variant has one. */
export function focusSearch(): boolean {
  const search = document.querySelector<HTMLElement>('[data-agent-search]');
  search?.focus();
  return search !== null;
}

export interface ListKeysOptions {
  /** Called with the session id of the item the focus lands on (selection follows focus). */
  onSelect: (sessionId: string) => void;
}

/**
 * Keyboard of every list variant. The items are the elements marked `data-nav-item` in the container, in DOM order (so the order on screen is the
 * order of the keys, whatever the variant). Items that carry `data-session-id` are sessions: the focus landing on one selects it. j/k and the arrows
 * move, Home and End jump, Enter on a session moves the focus to the composer. Typing in an input is left alone.
 */
export function useListKeys({ onSelect }: ListKeysOptions): (event: KeyboardEvent<HTMLElement>) => void {
  return useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (isTypingTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-nav-item]'));
      const active = (event.target as HTMLElement).closest<HTMLElement>('[data-nav-item]');
      if (event.key === 'Enter' && active?.dataset['sessionId'] !== undefined) {
        event.preventDefault();
        onSelect(active.dataset['sessionId']);
        focusComposer();
        return;
      }
      const position = active === null ? undefined : String(items.indexOf(active));
      const target = navTarget(
        event.key,
        items.map((_, index) => String(index)),
        position,
      );
      if (target === undefined) {
        return;
      }
      event.preventDefault();
      const next = items[Number(target)];
      next?.focus();
      const sessionId = next?.dataset['sessionId'];
      if (sessionId !== undefined) {
        onSelect(sessionId);
      }
    },
    [onSelect],
  );
}

/** The id that holds the tab stop of a roving list: the selected one when it is listed, else the first (so the list is always reachable by Tab). */
export function tabbableId(ids: readonly string[], selectedId: string | undefined): string | undefined {
  return selectedId !== undefined && ids.includes(selectedId) ? selectedId : ids[0];
}
