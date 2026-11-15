import { useEffect, useRef } from 'react';
import { isTypingTarget, navTarget } from '../logic/nav.js';
import { focusComposer, focusSearch } from '../ui/hooks.js';

export interface PageShortcutActions {
  selectedId: string | undefined;
  select: (sessionId: string) => void;
  togglePin: () => void;
  close: () => void;
  toggleHelp: () => void;
}

/** The ids of the sessions the list shows, in the order of the screen. */
export function visibleSessionIds(root: ParentNode = document): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-pane="list"] [data-session-id]')).map((element) => element.dataset['sessionId'] ?? '');
}

/**
 * The shortcuts of SHORTCUTS (logic/shortcuts.ts), on the whole page, only while no text field has the focus. A key the list already handled
 * (its handler calls preventDefault) or any key with Ctrl, Alt or Meta is left alone. Enter only acts when nothing has the focus: on a button
 * or a row it keeps its own meaning.
 */
export function usePageShortcuts(actions: PageShortcutActions): void {
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) {
        return;
      }
      const { selectedId, select, togglePin, close, toggleHelp } = latest.current;
      const bare = event.target === document.body || event.target === document.documentElement;
      switch (event.key) {
        case 'j':
        case 'k': {
          const ids = visibleSessionIds();
          const target = navTarget(event.key, ids, selectedId);
          if (target !== undefined) {
            event.preventDefault();
            select(target);
            const element = document.querySelector<HTMLElement>(`[data-pane="list"] [data-session-id="${CSS.escape(target)}"]`);
            element?.focus();
            element?.scrollIntoView?.({ block: 'nearest' });
          }
          return;
        }
        case 'r':
          if (selectedId !== undefined && focusComposer()) {
            event.preventDefault();
          }
          return;
        case 'Enter':
          if (bare && selectedId !== undefined && focusComposer()) {
            event.preventDefault();
          }
          return;
        case '/':
          if (focusSearch()) {
            event.preventDefault();
          }
          return;
        case 'p':
          if (selectedId !== undefined) {
            event.preventDefault();
            togglePin();
          }
          return;
        case 'Escape':
          if (bare && selectedId !== undefined) {
            event.preventDefault();
            close();
          }
          return;
        case '?':
          event.preventDefault();
          toggleHelp();
          return;
        default:
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
