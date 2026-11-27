import { getErrorMessage } from './errorText.js';

/*
 * The look of the state of a row of the agents list (the Herdr "colors" menu, the keys keep the names of the Herdr WAgents mod): the background of the rows that
 * need you, are flagged or have the blue dot; how the open row stands out; a bold open name and a dimmed idle name. One look for every list mode. The defaults are
 * the look the page had before these settings existed. Saved in this browser (localStorage), like the other view options (logic/viewOptions.ts), but a stored
 * value that is not valid is NEVER replaced silently: the field takes its default and the page says so (`problems`).
 */

/** The hues a state background can take (the theme's hue tokens, readable in light and dark), plus the theme accent. */
export const STATE_HUES = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'accent'] as const;
export type StateHue = (typeof STATE_HUES)[number];
/** A state background: a hue, or off (no background; the flag icon and the light stay). */
export type StateTint = StateHue | 'off';

/** The colors of the open row (the outline, the bar, the fill and the gradient): the old gold, the theme accent or a hue. */
export const HIGHLIGHT_COLORS = ['gold', 'accent', 'red', 'orange', 'green', 'cyan', 'blue', 'purple'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

/** The background of the open row: none, a flat fill, a gradient strong on the left or strong on the right. */
export const ACTIVE_BACKGROUNDS = ['none', 'fill', 'gradient', 'gradient-rtl'] as const;
export type ActiveBackground = (typeof ACTIVE_BACKGROUNDS)[number];

export interface RowLook {
  /** Background of a row that needs you. */
  needs: StateTint;
  /** Background of a flagged row. */
  flag: StateTint;
  /** Background of a row with the blue dot (finished and unseen, or marked unread). */
  unread: StateTint;
  /** The open row: its background. */
  focusBg: ActiveBackground;
  /** The open row: a bar on its left edge (combines with any background). */
  focusBar: boolean;
  /** The open row: an outline (combines with any background). */
  focusOutline: boolean;
  /** The color of the bar, the outline and the fill. */
  focusColor: HighlightColor;
  /** The color of the gradient. */
  gradientColor: HighlightColor;
  /** The name of the open row is bold (off: same weight as the others). */
  boldActive: boolean;
  /** The name of an idle agent (not open, not unread) is dimmed (off: same color as the others). */
  dimIdle: boolean;
}

/** The look of the page before the settings existed: red, orange and blue backgrounds, a gold outline and a gold gradient strong on the left, a plain name. */
export const DEFAULT_ROW_LOOK: RowLook = {
  needs: 'red',
  flag: 'orange',
  unread: 'accent',
  focusBg: 'gradient',
  focusBar: false,
  focusOutline: true,
  focusColor: 'gold',
  gradientColor: 'gold',
  boldActive: false,
  dimIdle: false,
};

export const ROW_LOOK_STORAGE_KEY = 'agent-manager.rowLook';

export const HUE_LABEL: Record<StateHue | HighlightColor, string> = {
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  cyan: 'Cyan',
  blue: 'Blue',
  purple: 'Purple',
  accent: 'Theme accent',
  gold: 'Gold',
};

export const ACTIVE_BACKGROUND_LABEL: Record<ActiveBackground, string> = {
  none: 'No background',
  fill: 'Fill',
  gradient: 'Gradient, strong on the left',
  'gradient-rtl': 'Gradient, strong on the right',
};

// The CSS color of a state background, from the theme tokens (a pale pastel in light, a translucent hue in dark). Red and accent keep the mixes of the page before the
// settings (a mix of the readable text hue over the surface), so the default looks are unchanged.
const TINT_CSS: Record<StateHue, string> = {
  red: 'color-mix(in srgb, var(--color-hue-red-text, #b91c1c) 20%, transparent)',
  orange: 'var(--color-hue-orange-bg)',
  yellow: 'var(--color-hue-yellow-bg)',
  green: 'var(--color-hue-green-bg)',
  cyan: 'var(--color-hue-cyan-bg)',
  blue: 'var(--color-hue-blue-bg)',
  purple: 'var(--color-hue-purple-bg)',
  accent: 'color-mix(in srgb, var(--color-primary, #2563eb) 12%, transparent)',
};

// The solid color of a hue: the outline of a row that sits on the colored body of a custom group, the highlight of the open row.
const SOLID_CSS: Record<HighlightColor, string> = {
  gold: '#d4a017',
  accent: 'var(--color-primary, #2563eb)',
  red: 'var(--color-hue-red-text)',
  orange: 'var(--color-hue-orange-text)',
  green: 'var(--color-hue-green-text)',
  cyan: 'var(--color-hue-cyan-text)',
  blue: 'var(--color-hue-blue-text)',
  purple: 'var(--color-hue-purple-text)',
};

/** The solid CSS color of a state hue (swatches of the menu and the group rings). */
export function hueSolid(hue: StateHue | HighlightColor): string {
  if (hue === 'yellow') {
    return 'var(--color-hue-yellow-text)';
  }
  return SOLID_CSS[hue];
}

/** The CSS of a state background swatch of the menu (the same color the row gets). */
export function tintCss(hue: StateHue): string {
  return TINT_CSS[hue];
}

const mix = (color: string, percent: number): string => `color-mix(in srgb, ${color} ${percent}%, transparent)`;

/** The background image of the open row: the bar (a hard stop gradient, so it needs no size or position) over the fill or the gradient. */
export function activeImage(look: RowLook): string {
  const layers: string[] = [];
  if (look.focusBar) {
    const bar = hueSolid(look.focusColor);
    layers.push(`linear-gradient(90deg, ${bar} 0, ${bar} 3px, transparent 3px)`);
  }
  const color = hueSolid(look.gradientColor);
  if (look.focusBg === 'gradient') {
    layers.push(`linear-gradient(90deg, ${mix(color, 30)}, ${mix(color, 2)})`);
  } else if (look.focusBg === 'gradient-rtl') {
    layers.push(`linear-gradient(270deg, ${mix(color, 30)}, ${mix(color, 2)})`);
  } else if (look.focusBg === 'fill') {
    const fill = mix(hueSolid(look.focusColor), 24);
    layers.push(`linear-gradient(${fill}, ${fill})`);
  }
  return layers.length === 0 ? 'none' : layers.join(', ');
}

/** The CSS custom properties the list reads (the classes of logic/herdrRow.ts point at them): set once on a wrapper of the list. */
export function rowLookVars(look: RowLook): Record<string, string> {
  const vars: Record<string, string> = {
    '--am-herdr-active-edge': look.focusOutline ? hueSolid(look.focusColor) : 'transparent',
    '--am-herdr-active-bg': activeImage(look),
  };
  const set = (name: string, tint: StateTint): void => {
    if (tint !== 'off') {
      vars[`--am-herdr-${name}-bg`] = TINT_CSS[tint];
      vars[`--am-herdr-${name}-ring`] = hueSolid(tint);
    }
  };
  set('needs', look.needs);
  set('flag', look.flag);
  set('unseen', look.unread);
  return vars;
}

/** A quiet agent: idle, not the open row, not marked unread. Its name is the one `dimIdle` dims. */
export function isQuietRow(session: { state: string; unread: boolean }, selected: boolean): boolean {
  return session.state === 'idle' && !selected && !session.unread;
}

/**
 * The weight and the color classes of the name of a row, by the row look, the same in every list. `base` is the weight every name has: `regular` (the one-line rows,
 * `font-normal`) or `strong` (the folder of the two-part labels of Groups, Inbox and the flat Tree, `font-semibold`). `boldActive` raises the open row one step
 * (`font-semibold`, `font-bold`); `dimIdle` greys a quiet agent (`text-muted-tint`, a mix of the muted and content tokens that keeps 4.5:1 on the surface).
 * Classes written in full.
 */
export function nameClasses(look: RowLook, selected: boolean, quiet: boolean, base: 'regular' | 'strong'): string {
  const bold = selected && look.boldActive;
  const weight = base === 'regular' ? (bold ? 'font-semibold' : 'font-normal') : bold ? 'font-bold' : 'font-semibold';
  return `${weight} ${quiet && look.dimIdle ? 'text-muted-tint' : 'text-content'}`;
}

function pickOf<T extends string>(key: string, value: unknown, allowed: readonly T[], fallback: T, problems: string[]): T {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  problems.push(`"${key}" is ${JSON.stringify(value)}, expected one of ${allowed.join(', ')}`);
  return fallback;
}

function flagOf(key: string, value: unknown, fallback: boolean, problems: string[]): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  problems.push(`"${key}" is ${JSON.stringify(value)}, expected true or false`);
  return fallback;
}

export interface ParsedRowLook {
  look: RowLook;
  /** What was not valid in the stored text (one sentence per field); empty when everything was valid or nothing was stored. */
  problems: string[];
}

/** Reads the look from the stored JSON text (null: nothing stored, the defaults). A field that is not valid takes its default AND is listed in `problems`. */
export function parseRowLook(text: string | null): ParsedRowLook {
  if (text === null) {
    return { look: DEFAULT_ROW_LOOK, problems: [] };
  }
  let stored: unknown;
  try {
    stored = JSON.parse(text);
  } catch (error) {
    return { look: DEFAULT_ROW_LOOK, problems: [`the stored text is not JSON (${getErrorMessage(error)})`] };
  }
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
    return { look: DEFAULT_ROW_LOOK, problems: ['the stored value is not an object'] };
  }
  const data = Object.fromEntries(Object.entries(stored));
  const problems: string[] = [];
  const tints: readonly StateTint[] = [...STATE_HUES, 'off'];
  const look: RowLook = {
    needs: pickOf('needs', data['needs'], tints, DEFAULT_ROW_LOOK.needs, problems),
    flag: pickOf('flag', data['flag'], tints, DEFAULT_ROW_LOOK.flag, problems),
    unread: pickOf('unread', data['unread'], tints, DEFAULT_ROW_LOOK.unread, problems),
    focusBg: pickOf('focusBg', data['focusBg'], ACTIVE_BACKGROUNDS, DEFAULT_ROW_LOOK.focusBg, problems),
    focusBar: flagOf('focusBar', data['focusBar'], DEFAULT_ROW_LOOK.focusBar, problems),
    focusOutline: flagOf('focusOutline', data['focusOutline'], DEFAULT_ROW_LOOK.focusOutline, problems),
    focusColor: pickOf('focusColor', data['focusColor'], HIGHLIGHT_COLORS, DEFAULT_ROW_LOOK.focusColor, problems),
    gradientColor: pickOf('gradientColor', data['gradientColor'], HIGHLIGHT_COLORS, DEFAULT_ROW_LOOK.gradientColor, problems),
    boldActive: flagOf('boldActive', data['boldActive'], DEFAULT_ROW_LOOK.boldActive, problems),
    dimIdle: flagOf('dimIdle', data['dimIdle'], DEFAULT_ROW_LOOK.dimIdle, problems),
  };
  for (const key of Object.keys(data)) {
    if (!(key in DEFAULT_ROW_LOOK)) {
      problems.push(`"${key}" is not a row look setting`);
    }
  }
  return { look, problems };
}

/** The saved look and what was wrong in it. A storage that throws (private mode) is a problem too, never "nothing saved" without a word. */
export function readRowLook(): ParsedRowLook {
  try {
    return parseRowLook(window.localStorage.getItem(ROW_LOOK_STORAGE_KEY));
  } catch (error) {
    return { look: DEFAULT_ROW_LOOK, problems: [`the browser storage cannot be read (${getErrorMessage(error)})`] };
  }
}

/** The sentence of the notice for the problems of a stored look. */
export function rowLookProblemText(problems: readonly string[]): string {
  return `The saved row look (key ${ROW_LOOK_STORAGE_KEY} of this browser) has invalid values: ${problems.join('; ')}. The default was used for them. Change any setting in the list menu (Rows section) to save a valid look over it, or use Reset there.`;
}

/** Stores the look. Returns undefined when saved, else the sentence to show: the choice applies until the page reloads. */
export function saveRowLook(look: RowLook): string | undefined {
  try {
    window.localStorage.setItem(ROW_LOOK_STORAGE_KEY, JSON.stringify(look));
    return undefined;
  } catch (error) {
    return `The row look could not be saved (${getErrorMessage(error)}). It applies until you reload the page, then it goes back to the defaults. Allow site data for this page in the browser, or free its storage, then change the setting again.`;
  }
}
