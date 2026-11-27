import { BASE, UNKNOWN_DASH, WIDTH, type GlyphState } from './handOverShapes.js';

/** Look `plug`: a plug (the session plugs into the other host): hollow when free, solid body when busy (it carries current), dotted body when unknown. */
export function HandOverPlug({ state }: { state: GlyphState }) {
  return (
    <g {...BASE} strokeWidth={WIDTH}>
      <path d="M9 2.5v4.5M15 2.5v4.5M12 17v4.5" />
      <path d="M6 7h12v4a6 6 0 0 1-12 0Z" fill={state === 'busy' ? 'currentColor' : 'none'} {...(state === 'unknown' ? { strokeDasharray: UNKNOWN_DASH } : {})} />
    </g>
  );
}
