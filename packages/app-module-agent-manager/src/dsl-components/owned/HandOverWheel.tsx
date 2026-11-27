import { BASE, UNKNOWN_DASH, WIDTH, type GlyphState } from './handOverShapes.js';

// A solid shape with a hole is an even-odd path, not a mask: a mask needs an id that is unique in the document, and the same icon is drawn several times.
const WHEEL_SOLID = 'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0ZM9.4 12a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0ZM3 11h6.4v2H3ZM14.6 11H21v2h-6.4ZM11 14.6h2V21h-2Z';

/** Look `wheel`: a steering wheel, the known picture of "taking over the controls" (the other host takes the wheel). Free: an empty wheel. Busy: a solid wheel. Unknown: a dotted rim. */
export function HandOverWheel({ state }: { state: GlyphState }) {
  return (
    <g>
      {state === 'busy' ? <path d={WHEEL_SOLID} fill="currentColor" fillRule="evenodd" /> : null}
      <g {...BASE} strokeWidth={WIDTH}>
        <circle cx="12" cy="12" r="9" {...(state === 'unknown' ? { strokeDasharray: UNKNOWN_DASH } : {})} />
        {state === 'busy' ? null : <path d="M3 12h6.5M14.5 12H21M12 14.5V21" />}
        {state === 'busy' ? null : <circle cx="12" cy="12" r="2.5" />}
      </g>
    </g>
  );
}
