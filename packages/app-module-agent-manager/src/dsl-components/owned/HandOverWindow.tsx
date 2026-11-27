import { BASE, WIDTH, type GlyphState, type GlyphTarget } from './handOverShapes.js';

const FRAME = 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6';

/** Look `window`: the window of the host the session GOES TO (a terminal prompt, or a browser bar) with a small arrow leaving through its corner; the arrow takes the state. */
export function HandOverWindow({ state, target }: { state: GlyphState; target: GlyphTarget }) {
  return (
    <>
      <g {...BASE} strokeWidth={WIDTH}>
        <path d={FRAME} />
        {target === 'hc' ? <path d="m6.5 12.5 2.5 2.5-2.5 2.5M11 18h2.5" strokeWidth="1.8" /> : <path d="M3 11h8" strokeWidth="1.8" />}
      </g>
      <g {...BASE} strokeWidth={WIDTH} className={state === 'busy' ? 'text-hue-orange' : ''} opacity={state === 'unknown' ? 0.7 : 1}>
        <path d="M15 3h6v6" fill={state === 'busy' ? 'currentColor' : 'none'} />
        <path d="M13 11 21 3" {...(state === 'unknown' ? { strokeDasharray: '0.1 3.4' } : {})} />
      </g>
    </>
  );
}
