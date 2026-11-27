import { BASE, WIDTH, type GlyphState, type GlyphTarget } from './handOverShapes.js';

// A solid shape with a hole is an even-odd path, not a mask: a mask needs an id that is unique in the document, and the same icon is drawn several times.
// The drawing fills the grid like the lucide icons around it (outer box 1..23 on both axes, centred): two slots 9 x 13 at y 9..22 and the hop arc above them.
const HOP_SLOT_SOLID = 'M4.2 9h4.6A2.2 2.2 0 0 1 11 11.2v8.6A2.2 2.2 0 0 1 8.8 22H4.2A2.2 2.2 0 0 1 2 19.8v-8.6A2.2 2.2 0 0 1 4.2 9ZM4.3 15.5a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0Z';

/** Look `hop`: two host slots (Web on the left, Terminal on the right) and a dot, the session, with a small hop arc to the other slot. Free: the dot in an empty slot. Busy: the slot is solid with a hole. Unknown: a dotted ring in the slot. */
export function HandOverSlots({ state, target }: { state: GlyphState; target: GlyphTarget }) {
  return (
    <g transform={target === 'hc' ? undefined : 'matrix(-1 0 0 1 24 0)'}>
      {state === 'busy' ? <path d={HOP_SLOT_SOLID} fill="currentColor" fillRule="evenodd" /> : null}
      <g {...BASE} strokeWidth={WIDTH}>
        <rect x="2" y="9" width="9" height="13" rx="2.2" />
        <rect x="13" y="9" width="9" height="13" rx="2.2" />
        <path d="M6.5 6C8 0.7 16 0.7 17.5 6M15.2 5.1l2.3.9.9-2.4" strokeWidth="1.8" />
      </g>
      {state === 'free' ? <circle cx="6.5" cy="15.5" r="2.2" fill="currentColor" /> : null}
      {state === 'unknown' ? <circle cx="6.5" cy="15.5" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="1 2.2" /> : null}
    </g>
  );
}
