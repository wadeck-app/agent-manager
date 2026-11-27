import type { SwitchReadinessVariant } from '../logic/uiVariants.js';
import { HandOverArrows } from './HandOverArrows.js';
import { BASE, BOTTOM_HEAD, FADED, SHRUNK, SHRUNK_STROKE, WIDTH, type GlyphState } from './handOverShapes.js';

/** What is drawn inside the hand-over icon for one look and one readiness state: the part of the glyph that changes with the state. */
export function HandOverDrawing({ variant, state }: { variant: SwitchReadinessVariant; state: GlyphState }) {
  switch (variant) {
    case 'corner':
      // A small mark on the free corner: nothing when free, a filled dot when something runs, a ring when it cannot be told.
      return (
        <>
          <g transform={SHRUNK}>
            <HandOverArrows width={SHRUNK_STROKE} />
          </g>
          {state === 'busy' ? <circle cx="19" cy="19" r="3.2" fill="currentColor" /> : null}
          {state === 'unknown' ? <circle cx="19" cy="19" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.8" /> : null}
        </>
      );
    case 'dashed':
      // The return arrow becomes dashed when something runs, both arrows when it cannot be told.
      return <HandOverArrows {...(state === 'free' ? {} : { bottomDash: '2.4 3' })} {...(state === 'unknown' ? { topDash: '2.4 3' } : {})} />;
    case 'faded':
      // The return arrow is drawn lighter when something runs, both when it cannot be told.
      return <HandOverArrows bottomOpacity={state === 'free' ? 1 : FADED} topOpacity={state === 'unknown' ? FADED : 1} />;
    case 'filled':
      // The arrowheads: open (the plain icon) when free, both solid when something runs, only the upper one solid when it cannot be told.
      if (state === 'free') {
        return <HandOverArrows />;
      }
      return (
        <>
          <HandOverArrows topHead="" bottomHead={state === 'busy' ? '' : BOTTOM_HEAD} />
          <polygon points="15,2.5 21.5,7 15,11.5" {...BASE} strokeWidth={WIDTH} fill="currentColor" />
          {state === 'busy' ? <polygon points="9,12.5 2.5,17 9,21.5" {...BASE} strokeWidth={WIDTH} fill="currentColor" /> : null}
        </>
      );
    case 'bar':
      // A line under the arrows: none when free, solid when something runs, dotted when it cannot be told.
      return (
        <>
          <g transform={SHRUNK}>
            <HandOverArrows width={SHRUNK_STROKE} />
          </g>
          {state === 'busy' ? <path d="M3 21.5h18" {...BASE} strokeWidth="2.4" /> : null}
          {state === 'unknown' ? <path d="M3 21.5h18" {...BASE} strokeWidth="2.6" strokeDasharray="0.1 4.2" /> : null}
        </>
      );
  }
}
