import { act, fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';

/**
 * The tooltip that is open: the card of the dsl-ui Tooltip (portaled to the body, shown on hover or keyboard focus, one at a time). The text for assistive
 * technology is another, always present, screen reader only copy (`role="tooltip"`, hidden from the eye), so the card is found by its test id.
 */
export function liveTooltip(): HTMLElement {
  const found = screen.queryAllByTestId('tooltip-card');
  if (found.length !== 1) {
    throw new Error(`expected one open tooltip card, found ${found.length}`);
  }
  return found[0]!;
}

/**
 * Gives the keyboard focus to an element the way a keyboard user does. The dsl-ui Tooltip opens at once on keyboard focus only (`:focus-visible`): a
 * synthetic `fireEvent.focus` is not one, and a click focuses without opening it. jsdom answers `:focus-visible` from a modality it guesses (it depends on the
 * key handlers of the page), so the question is answered here, for this element: it is "focus visible" while it has the focus.
 */
export function focusByKeyboard(element: HTMLElement): void {
  const matches = element.matches.bind(element);
  vi.spyOn(element, 'matches').mockImplementation((selector: string) => (selector === ':focus-visible' ? element === document.activeElement : matches(selector)));
  act(() => {
    element.focus();
  });
}

/**
 * Hovers the trigger of a Tooltip the way a pointer does and waits for the delay of the card (the wrapper span of the Tooltip is the parent of the trigger).
 * The timers are faked only for the delay, so a test with real timers is not changed.
 */
export function hoverTip(trigger: HTMLElement): void {
  vi.useFakeTimers();
  try {
    fireEvent.pointerEnter(trigger.parentElement as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(400);
    });
  } finally {
    vi.useRealTimers();
  }
}

/** The text that describes an element for assistive technology (the always present copy of its Tooltip, found through aria-describedby). */
export function descriptionOf(element: HTMLElement): string {
  const ids = (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
}
