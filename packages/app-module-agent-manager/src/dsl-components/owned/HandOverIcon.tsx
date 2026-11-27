import type { SwitchReadinessVariant } from '../logic/uiVariants.js';
import { HandOverDrawing } from './HandOverDrawing.js';
import type { GlyphState, GlyphTarget } from './handOverShapes.js';

export type { GlyphState, GlyphTarget };

export interface HandOverIconProps {
  variant: SwitchReadinessVariant;
  state: GlyphState;
  /** The host the session goes to. */
  target: GlyphTarget;
  className?: string;
}

/*
 * The icon of the hand-over button, on a 24 x 24 grid in the current colour. It is not a pair of arrows (the user found they make no sense): it draws the hosts
 * themselves (a window, two slots, a split pill), a plug or a baton. The state is said by a PART of the glyph only (filled, dotted, a small tone), never by a pill
 * or a word (a hand-over is a possible action, not an alert; the words are the tooltip and the accessible name): five looks of the A/B question ui-switch-readiness.
 */

/** The icon of the hand-over button, 16 px by default. Decorative: the button carries the name. */
export function HandOverIcon({ variant, state, target, className = 'h-4 w-4' }: HandOverIconProps) {
  return (
    // The dedicated svg component of the hand-over icon (the parts it draws are in HandOverDrawing).
    // violations-suppress: react/no-inline-svg this file IS the extracted svg component, the rule has nothing to extract it to
    <svg data-handover-glyph={variant} data-handover-state={state} data-handover-target={target} aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <HandOverDrawing variant={variant} state={state} target={target} />
    </svg>
  );
}
