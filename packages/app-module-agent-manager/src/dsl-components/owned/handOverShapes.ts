/*
 * The shapes of the hand-over icon (see HandOverIcon.tsx): the paths of the two opposite arrows on a 24 x 24 grid and the few numbers the five looks share.
 */

/** What the icon says about the session: nothing runs (free), something runs (busy: a hand-over interrupts it), agent-manager cannot tell (unknown). */
export type GlyphState = 'free' | 'busy' | 'unknown';

export const BASE = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
export const WIDTH = 2;
export const TOP_HEAD = 'm16 3 4 4-4 4';
export const BOTTOM_HEAD = 'm8 21-4-4 4-4';
export const TOP_LINE = 'M20 7H4';
export const BOTTOM_LINE = 'M4 17h16';
export const FADED = 0.35;
/** The base drawing shrunk toward the top left, to leave the bottom and right edge to a mark. */
export const SHRUNK = 'translate(1 .5) scale(.78)';
export const SHRUNK_STROKE = 2.5;
