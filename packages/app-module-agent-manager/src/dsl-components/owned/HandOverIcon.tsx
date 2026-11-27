import type { SwitchReadinessVariant } from '../logic/uiVariants.js';
import { HandOverDrawing } from './HandOverDrawing.js';
import type { GlyphState } from './handOverShapes.js';

export type { GlyphState };

export interface HandOverIconProps {
  variant: SwitchReadinessVariant;
  state: GlyphState;
  className?: string;
}

/*
 * The icon of the hand-over button: two opposite arrows (the session goes from one host to the other) drawn on a 24 x 24 grid in the current colour. The state is
 * said by a PART of the glyph only, never by a colour, a pill or a word (a hand-over is a possible action, not an alert; the words are the tooltip and the accessible
 * name): five looks of the A/B question ui-switch-readiness (HandOverDrawing). Every stroke is `currentColor`, so the muted colour of the button and both themes apply.
 */

/** The icon of the hand-over button, 16 px by default. Decorative: the button carries the name. */
export function HandOverIcon({ variant, state, className = 'h-4 w-4' }: HandOverIconProps) {
  return (
    // The dedicated svg component of the hand-over icon (the parts it draws are HandOverDrawing and HandOverArrows).
    // violations-suppress: react/no-inline-svg this file IS the extracted svg component, the rule has nothing to extract it to
    <svg data-handover-glyph={variant} data-handover-state={state} aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <HandOverDrawing variant={variant} state={state} />
    </svg>
  );
}
