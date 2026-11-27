import { BASE, WIDTH, type GlyphState, type GlyphTarget } from './handOverShapes.js';

// A solid shape with a hole is an even-odd path, not a mask: a mask needs an id that is unique in the document, and the same icon is drawn several times.
const HOP_SLOT_SOLID = 'M4.2 8h4.6A2.2 2.2 0 0 1 11 10.2v6.6A2.2 2.2 0 0 1 8.8 19H4.2A2.2 2.2 0 0 1 2 16.8v-6.6A2.2 2.2 0 0 1 4.2 8ZM4.3 13.5a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0Z';

/** Look `hop`: two host slots (Web on the left, Terminal on the right) and a dot, the session, with a small hop arc to the other slot. Free: the dot in an empty slot. Busy: the slot is solid with a hole. Unknown: a dotted ring in the slot. */
export function HandOverSlots({ state, target }: { state: GlyphState; target: GlyphTarget }) {
  return (
    <g transform={target === 'hc' ? undefined : 'matrix(-1 0 0 1 24 0)'}>
      {state === 'busy' ? <path d={HOP_SLOT_SOLID} fill="currentColor" fillRule="evenodd" /> : null}
      <g {...BASE} strokeWidth={WIDTH}>
        <rect x="2" y="8" width="9" height="11" rx="2.2" />
        <rect x="13" y="8" width="9" height="11" rx="2.2" />
        <path d="M6.5 5.5C8 1.8 16 1.8 17.5 5.5M15.2 4.6l2.3 1 .9-2.4" strokeWidth="1.8" />
      </g>
      {state === 'free' ? <circle cx="6.5" cy="13.5" r="1.9" fill="currentColor" /> : null}
      {state === 'unknown' ? <circle cx="6.5" cy="13.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="1 2" /> : null}
    </g>
  );
}
