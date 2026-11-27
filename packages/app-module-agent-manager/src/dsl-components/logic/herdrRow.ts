import { STATE_LABEL, type AgentState } from './states.js';
import { DEFAULT_ROW_LOOK, type RowLook } from './rowLook.js';
import type { TreeDensityVariant } from './uiVariants.js';

/*
 * The rows of the Herdr variants of the A/B question `ui-tree-density`, close to the agents panel of Herdr (research/ui-audit.md): a light on the right that says
 * the state (shape and words, never the colour alone), and an optional tint of the whole row. Only data the page has: the state, the time in state, the folder,
 * the program.
 */

export type HerdrDensity = Extract<TreeDensityVariant, 'herdr-tinted' | 'herdr-name'>;

export function isHerdrDensity(density: TreeDensityVariant): density is HerdrDensity {
  return density === 'herdr-tinted' || density === 'herdr-name';
}

/** The classes of every Herdr row box (research/ui-audit.md, "Herdr values"): 30 px, 8 px rounded, the list's 8 px side padding as a margin, 8 px inside on the left and 2 px on the right (the state column is 26 px wide). */
export const HERDR_ROW_BOX = 'mx-2 h-[30px] rounded-lg py-0 pl-2 pr-0.5';

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
 * The background of a row by its state, the same in every list mode (Tree, Groups, Inbox, Custom): when it needs you, when the user flagged it, when it finished and
 * is unseen or is marked unread (undefined: no tint). The first that applies AND whose color is not "off" wins (needs you, flagged, unseen: the order of the Herdr
 * WAgents mod). The colors are the user's row look (logic/rowLook.ts: the CSS variables `--am-herdr-*-bg` set by lists/RowLookContext.tsx; the defaults are in
 * styles/agents.css). Classes are written in full: a class built at run time generates no CSS rule.
 */
export function stateTint(state: AgentState, flagged: boolean, unread = false, look: RowLook = DEFAULT_ROW_LOOK): string | undefined {
  if (state === 'needs-you' && look.needs !== 'off') {
    return 'bg-[color:var(--am-herdr-needs-bg)]';
  }
  // The order of the Herdr WAgents mod: needs you, then flagged, then the blue dot.
  if (flagged && look.flag !== 'off') {
    return 'bg-[color:var(--am-herdr-flag-bg)]';
  }
  // An idle agent the user marked unread counts as finished and unseen, as in the Custom mode (logic/customMode.ts).
  return (state === 'done' || (unread && state === 'idle')) && look.unread !== 'off' ? 'bg-[color:var(--am-herdr-unseen-bg)]' : undefined;
}

/**
 * The background classes of a row of the Herdr rows (undefined: none): the open row of a Herdr density has the open look of the row look (default: a gold outline and a
 * gold gradient, strong on the left and fading to the right; the state tint stays visible under it), any other row has the tint of its state (every density: the
 * row shape does not decide whether an agent that needs you shows it). The compact row gives the open row its own look.
 */
export function herdrTint(density: TreeDensityVariant, state: AgentState, selected: boolean, flagged = false, unread = false, look: RowLook = DEFAULT_ROW_LOOK): string | undefined {
  const tint = stateTint(state, flagged, unread, look);
  if (selected) {
    return isHerdrDensity(density) ? `${tint ?? ''} ring-1 ring-inset ring-[color:var(--am-herdr-active-edge)] bg-[image:var(--am-herdr-active-bg)]`.trim() : undefined;
  }
  return tint;
}

/** What the row writes besides the name: the grey folder text, except in the name-only variant. */
export function herdrRowShape(density: HerdrDensity): { folder: boolean } {
  return { folder: density !== 'herdr-name' };
}

/**
 * The open and idle looks of a row of the multi-line lists (Groups, Inbox): the very look of the Tree rows (an inset rounded box, the gold outline when open, the
 * tint of the state otherwise), so that the three lists are one family of rows (QA finding Q7).
 */
export function herdrLook(state: AgentState, flagged: boolean, unread: boolean, look: RowLook = DEFAULT_ROW_LOOK): { selected: string; idle: string } {
  const idle = herdrTint('herdr-tinted', state, false, flagged, unread, look);
  return { selected: herdrTint('herdr-tinted', state, true, flagged, unread, look) ?? '', idle: idle === undefined ? 'hover:bg-muted-bg' : `${idle} hover:brightness-95` };
}

/** The inset rounded box of a multi-line row (Groups, Inbox): the margin and radius of the Tree rows, the height grows with the lines. */
export const HERDR_ROW_BOX_MULTILINE = 'mx-2 rounded-lg px-2';

/**
 * The surface color under a row with a state tint that sits on the colored body of a custom group. The state tints are translucent (a mix of a hue and
 * transparent): over a cyan body, red turns to a muddy grey. The underlay is a pseudo element behind the row (the group body is an isolated stacking context), so
 * the tint is drawn over the plain surface, as in the other lists, and the row stands out of the body like a card. Classes written in full (QA3 R11).
 */
export const STATE_TINT_UNDERLAY = "before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:rounded-lg before:bg-surface before:content-['']";

/**
 * A 1 px outline in the hue of the state tint, for a row that sits on the colored body of a custom group: the group color (cyan) and the unseen tint (blue) are two
 * soft backgrounds that look alike, the outline tells them apart (QA finding Q36). Classes written in full; undefined when the row has no state tint.
 */
export function stateRing(state: AgentState, flagged: boolean, unread = false, look: RowLook = DEFAULT_ROW_LOOK): string | undefined {
  if (state === 'needs-you' && look.needs !== 'off') {
    return 'ring-1 ring-inset ring-[color:var(--am-herdr-needs-ring)]';
  }
  if (flagged && look.flag !== 'off') {
    return 'ring-1 ring-inset ring-[color:var(--am-herdr-flag-ring)]';
  }
  return (state === 'done' || (unread && state === 'idle')) && look.unread !== 'off' ? 'ring-1 ring-inset ring-[color:var(--am-herdr-unseen-ring)]' : undefined;
}
