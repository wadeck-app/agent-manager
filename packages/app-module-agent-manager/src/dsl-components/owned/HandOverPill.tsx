import { BASE, WIDTH, type GlyphState, type GlyphTarget } from './handOverShapes.js';

// A solid shape with a hole is an even-odd path, not a mask: a mask needs an id that is unique in the document, and the same icon is drawn several times.
// The pill is 20 x 14 (outer box 1..23 by 4..20): wide like the two-host picture it is, but tall enough to read next to the 16 px icons around it.
const PILL_HALF_SOLID = 'M9 5h3v14H9a7 7 0 0 1 0-14ZM5.4 12a3.1 3.1 0 1 0 6.2 0a3.1 3.1 0 1 0-6.2 0Z';

/** Look `pill`: the two hosts as a split pill (Web on the left, Terminal on the right): the host the session is in is solid, the other is outlined with a chevron. Free: a solid half. Busy: the solid half has a big hole. Unknown: the half is dotted instead of solid. */
export function HandOverPill({ state, target }: { state: GlyphState; target: GlyphTarget }) {
  return (
    <g transform={target === 'hc' ? undefined : 'matrix(-1 0 0 1 24 0)'}>
      {state === 'unknown' ? null : <path d={state === 'busy' ? PILL_HALF_SOLID : 'M9 5h3v14H9a7 7 0 0 1 0-14Z'} fill="currentColor" fillRule="evenodd" />}
      <g {...BASE} strokeWidth={WIDTH}>
        <rect x="2" y="5" width="20" height="14" rx="7" />
        <path d="M12 5v14" />
        <path d="m15.5 9.6 2.6 2.4-2.6 2.4" strokeWidth="1.8" />
        {state === 'unknown' ? <path d="M7.5 9v6" strokeDasharray="0.1 2.9" strokeWidth="2.8" /> : null}
      </g>
    </g>
  );
}
