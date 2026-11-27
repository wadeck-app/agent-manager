import type { SwitchReadinessVariant } from '../logic/uiVariants.js';
import { HandOverPill } from './HandOverPill.js';
import { HandOverPlug } from './HandOverPlug.js';
import { HandOverSlots } from './HandOverSlots.js';
import { HandOverWheel } from './HandOverWheel.js';
import { HandOverWindow } from './HandOverWindow.js';
import type { GlyphState, GlyphTarget } from './handOverShapes.js';

export interface HandOverDrawingProps {
  variant: SwitchReadinessVariant;
  state: GlyphState;
  target: GlyphTarget;
}

/*
 * The five looks of the A/B question ui-switch-readiness. None is a pair of arrows. All draw the same three states with one idea: free = the drawing is
 * empty (outline only), busy = it holds something (a part is filled or tinted), unknown = the part is dotted. Everything is `currentColor` (the muted colour of the
 * button, both themes) except the parts that take a tone (`text-hue-orange`, a small part only).
 */

/** What is drawn inside the hand-over icon for one look, one readiness state and one destination host. */
export function HandOverDrawing({ variant, state, target }: HandOverDrawingProps) {
  switch (variant) {
    case 'window':
      return <HandOverWindow state={state} target={target} />;
    case 'wheel':
      return <HandOverWheel state={state} />;
    case 'plug':
      return <HandOverPlug state={state} />;
    case 'pill':
      return <HandOverPill state={state} target={target} />;
    case 'hop':
      return <HandOverSlots state={state} target={target} />;
  }
}
