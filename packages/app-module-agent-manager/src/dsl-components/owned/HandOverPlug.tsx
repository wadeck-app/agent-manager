import { BASE, UNKNOWN_DASH, WIDTH, type GlyphState } from './handOverShapes.js';

/** Look `plug`: a plug (the session plugs into the other host): hollow when free, solid body when busy (it carries current), dotted body when unknown. */
export function HandOverPlug({ state }: { state: GlyphState }) {
  return (
    <g {...BASE} strokeWidth={WIDTH}>
      <path d="M8.5 2v5M15.5 2v5M12 19v3" />
      <path d="M4 7h16v4a8 8 0 0 1-16 0Z" fill={state === 'busy' ? 'currentColor' : 'none'} {...(state === 'unknown' ? { strokeDasharray: UNKNOWN_DASH } : {})} />
    </g>
  );
}
