/*
 * The shared numbers of the hand-over icon (see HandOverIcon.tsx): a 24 x 24 grid, a 2 px round stroke in the current colour.
 */

/** What the icon says about the session: nothing runs (free), something runs (busy: a hand-over interrupts it), agent-manager cannot tell (unknown). */
export type GlyphState = 'free' | 'busy' | 'unknown';

/** The host the session goes TO: the Terminal (an hc herdr-core terminal) or the Web (a child owned by the daemon, `stream-json`). */
export type GlyphTarget = 'hc' | 'stream-json';

export const BASE = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
export const WIDTH = 2;
/** The dash of an "unknown" outline: short and round, so that it reads as dotted at 16 px. */
export const UNKNOWN_DASH = '1.6 3';
