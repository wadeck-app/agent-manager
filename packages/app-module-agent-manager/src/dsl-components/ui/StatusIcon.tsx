import { STATE_LOOK } from './stateLook.js';
import type { AgentState } from '../logic/states.js';

export interface StatusIconProps {
  state: AgentState;
  /** Tailwind size classes, one source for every icon of a list. */
  sizeClass?: string;
  /** When the icon is the only text of the state (no label next to it) it needs a name for screen readers. */
  labelled?: boolean;
}

/** The icon of a state (lucide, never a text glyph). Decorative unless `labelled`; the state text lives in the row label or the tooltip. */
export function StatusIcon({ state, sizeClass = 'h-4 w-4', labelled = true }: StatusIconProps) {
  const look = STATE_LOOK[state];
  const Icon = look.icon;
  return labelled ? (
    <Icon role="img" aria-label={look.label} className={`shrink-0 ${sizeClass} ${look.text} ${look.iconClass}`} />
  ) : (
    <Icon aria-hidden="true" className={`shrink-0 ${sizeClass} ${look.text} ${look.iconClass}`} />
  );
}
