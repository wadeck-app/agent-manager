import { useEffect, useRef } from 'react';
import { useSelection } from '../lists/selection.js';
import { isTypingTarget } from '../logic/nav.js';

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'range', 'color', 'file']);

/** A field that takes typed text (an input of a text kind, a text area, a select, an editable box). A checkbox or a button input is NOT one. */
function ownsEscape(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement && NON_TEXT_INPUTS.has(target.type)) {
    return false;
  }
  return isTypingTarget(target);
}

/**
 * Escape leaves the selection mode and clears the selection, but only when nothing else owns the key: not in a text field (a checkbox just clicked is not one) and not while a dialog or a
 * menu is open (Escape closes it and the selection stays). Registered before the page shortcuts (a child effect runs first) so that the Escape that clears
 * does not also close the open agent.
 */
export function SelectionKeys(): null {
  const selection = useSelection();
  const latest = useRef(selection);
  latest.current = selection;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || ownsEscape(event.target) || document.querySelector('[role="dialog"], [role="menu"]') !== null) {
        return;
      }
      const current = latest.current;
      // Escape leaves the selection mode (and clears what is selected), also when nothing is ticked yet.
      if (current !== null && (current.mode || current.count > 0)) {
        event.preventDefault();
        current.clear();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return null;
}

