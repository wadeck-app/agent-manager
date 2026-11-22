import { STATE_LABEL, type AgentState } from './states.js';
import type { TreeDensityVariant } from './uiVariants.js';

/*
 * The rows of the Herdr variants of the A/B question `ui-tree-density`, close to the agents panel of Herdr (research/ui-audit.md): a light on the right that says
 * the state (shape and words, never the colour alone), and an optional tint of the whole row. Only data the page has: the state, the time in state, the folder,
 * the program.
 */

export type HerdrDensity = Extract<TreeDensityVariant, 'herdr-line' | 'herdr-tinted' | 'herdr-name'>;

export function isHerdrDensity(density: TreeDensityVariant): density is HerdrDensity {
  return density === 'herdr-line' || density === 'herdr-tinted' || density === 'herdr-name';
}

export interface HerdrLight {
  /** dot: a filled dot. spinner: a turning arc. pill: a coloured pill with words. ring: an empty ring. icon: the page's own icon (a state Herdr has no light for). */
  kind: 'dot' | 'spinner' | 'pill' | 'ring' | 'icon';
  /** The words of the light, for a screen reader and the pill. */
  label: string;
}

export function herdrLight(state: AgentState): HerdrLight {
  switch (state) {
    case 'done':
      return { kind: 'dot', label: 'Finished, not seen yet' };
    case 'working':
      return { kind: 'spinner', label: STATE_LABEL.working };
    case 'needs-you':
      return { kind: 'pill', label: STATE_LABEL['needs-you'] };
    case 'idle':
      return { kind: 'ring', label: STATE_LABEL.idle };
    case 'other':
      return { kind: 'icon', label: STATE_LABEL.other };
    case 'ended':
      return { kind: 'icon', label: STATE_LABEL.ended };
    default:
      throw new Error(`herdrLight: unhandled state ${String(state)}`);
  }
}

/**
 * The tint classes of a row in the tinted variant (undefined: no tint). The colours are the CSS variables of styles/agents.css (`--am-herdr-*`), so they are
 * changed in one place. Classes are written in full: a class built at run time generates no CSS rule.
 */
export function herdrTint(density: TreeDensityVariant, state: AgentState, selected: boolean): string | undefined {
  if (density !== 'herdr-tinted') {
    return undefined;
  }
  if (selected) {
    return 'ring-1 ring-inset ring-[color:var(--am-herdr-active-edge)] bg-[image:var(--am-herdr-active-bg)]';
  }
  if (state === 'needs-you') {
    return 'bg-[color:var(--am-herdr-needs-bg)]';
  }
  if (state === 'done') {
    return 'bg-[color:var(--am-herdr-unseen-bg)]';
  }
  return undefined;
}

/** What the row writes besides the name: the grey folder text, except in the name-only variant. */
export function herdrRowShape(density: HerdrDensity): { folder: boolean } {
  return { folder: density !== 'herdr-name' };
}
