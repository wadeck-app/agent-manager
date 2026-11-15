import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
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

/** Width (px) from which the log gets a third zone (the sub-agent panel beside it). */
export const WIDE_SCREEN_PX = 1920;

/**
 * Whether the window is at least `px` wide, following resizes. Used to render ONE of two arrangements of the same data (a CSS-hidden twin would stay in the
 * DOM, and in the accessibility tree of a test). False where `matchMedia` does not exist (a test environment).
 */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const [matches, setMatches] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return;
    }
    const list = window.matchMedia(query);
    const update = (): void => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}
