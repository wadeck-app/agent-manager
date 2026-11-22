import { useEffect, useRef } from 'react';
import { useSelection } from '../lists/selection.js';
import { isTypingTarget } from '../logic/nav.js';

/**
 * Escape clears the selection, but only when nothing else owns the key: not in a text field and not while a dialog is open (Escape closes the dialog and
 * the selection stays). Registered before the page shortcuts (a child effect runs first) so that the Escape that clears does not also close the open agent.
 */
export function SelectionKeys(): null {
  const selection = useSelection();
  const latest = useRef(selection);
  latest.current = selection;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || isTypingTarget(event.target) || document.querySelector('[role="dialog"]') !== null) {
        return;
      }
      const current = latest.current;
      if (current !== null && current.count > 0) {
        event.preventDefault();
        current.clear();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return null;
}

