import { BASE, WIDTH, type GlyphState, type GlyphTarget } from './handOverShapes.js';

// A solid shape with a hole is an even-odd path, not a mask: a mask needs an id that is unique in the document, and the same icon is drawn several times.
const PILL_HALF_SOLID = 'M7 7h5v10H7a5 5 0 0 1 0-10ZM4.9 12a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0Z';

/** Look `pill`: the two hosts as a split pill (Web on the left, Terminal on the right): the host the session is in is solid, the other is outlined with a chevron. Free: a solid half. Busy: the solid half has a big hole. Unknown: the half is dotted instead of solid. */
export function HandOverPill({ state, target }: { state: GlyphState; target: GlyphTarget }) {
  return (
    <g transform={target === 'hc' ? undefined : 'matrix(-1 0 0 1 24 0)'}>
      {state === 'unknown' ? null : <path d={state === 'busy' ? PILL_HALF_SOLID : 'M7 7h5v10H7a5 5 0 0 1 0-10Z'} fill="currentColor" fillRule="evenodd" />}
      <g {...BASE} strokeWidth={WIDTH}>
        <rect x="2" y="7" width="20" height="10" rx="5" />
        <path d="M12 7v10" />
        <path d="m15.5 10.2 2 1.8-2 1.8" strokeWidth="1.8" />
        {state === 'unknown' ? <path d="M7 10.2v3.6" strokeDasharray="0.1 2.4" strokeWidth="2.6" /> : null}
      </g>
    </g>
  );
}
