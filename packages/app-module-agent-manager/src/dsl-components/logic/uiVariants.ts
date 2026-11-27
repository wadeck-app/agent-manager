/**
 * The design questions of the page that have no obvious best answer (UI audit, research/ui-audit.md): each is an A/B test of the dock (localStorage
 * `ab.<id>`), shown on the real page. The first option of every question is the recommended one and the default.
 */
export interface UiVariantOption {
  label: string;
  hint: string;
}

export interface UiQuestion<T extends string> {
  id: string;
  label: string;
  initial: T;
  options: Record<T, UiVariantOption>;
}

/**
 * The Tree rows and the group headers are settled (user decision 2026-11-26): the Herdr look, with no dock question. The two types stay because the lists still
 * branch on them (their dead branches go with the next pass of the lists, which another change owns); every value but the default is dead code.
 */
export const TREE_DENSITY = ['herdr-tinted', 'compact', 'herdr-name'] as const;
export type TreeDensityVariant = (typeof TREE_DENSITY)[number];

export const SWITCH_READINESS = ['hop', 'window', 'wheel', 'plug', 'pill'] as const;
export type SwitchReadinessVariant = (typeof SWITCH_READINESS)[number];

export const READINESS_PREVIEW = ['real', 'free', 'busy', 'unknown'] as const;
export type ReadinessPreviewValue = (typeof READINESS_PREVIEW)[number];

export const GROUP_HEADER = ['herdr', 'bar', 'pill'] as const;
export type GroupHeaderVariant = (typeof GROUP_HEADER)[number];

export const UI_QUESTIONS = {
  switchReadiness: {
    id: 'ui-switch-readiness',
    label: 'Hand-over icon',
    initial: 'hop',
    options: {
      hop: { label: 'E Two slots (default)', hint: 'Two host slots (Web on the left, Terminal on the right) and a dot, the session, with a small hop arc to the other slot. Free: the dot in an empty slot. Busy: the slot is solid with a hole. Unknown: a dotted ring in the slot. No text, no extra row, no banner; the tooltip lists what a hand-over interrupts. HOW TO SEE IT: select any agent in the list, then pick Free, Busy or Unknown in "Preview hand-over" (next row of this dock); it also works on an agent that is not started here.' },
      window: { label: 'A Destination window', hint: 'The window of the host the session goes TO (a terminal prompt when it goes to the Terminal, a browser bar when it goes to the Web), with a small arrow leaving through its corner. Free: the arrow alone. Busy: the arrow is filled and takes an amber tone. Unknown: the arrow is dotted and paler. No text, no extra row, no banner; the tooltip lists what a hand-over interrupts. HOW TO SEE IT: select any agent in the list, then pick Free, Busy or Unknown in "Preview hand-over" (next row of this dock); it also works on an agent that is not started here.' },
      wheel: { label: 'B Steering wheel', hint: 'A steering wheel, the known picture of taking over the controls: the other host takes the wheel. Free: an empty wheel. Busy: a solid wheel. Unknown: the rim is dotted. No text, no extra row, no banner; the tooltip lists what a hand-over interrupts. HOW TO SEE IT: select any agent in the list, then pick Free, Busy or Unknown in "Preview hand-over" (next row of this dock); it also works on an agent that is not started here.' },
      plug: { label: 'C Plug', hint: 'A plug: the session plugs into the other host. Free: a hollow plug. Busy: the plug body is solid. Unknown: the plug body is dotted. No text, no extra row, no banner; the tooltip lists what a hand-over interrupts. HOW TO SEE IT: select any agent in the list, then pick Free, Busy or Unknown in "Preview hand-over" (next row of this dock); it also works on an agent that is not started here.' },
      pill: { label: 'D Two hosts', hint: 'A split pill with the two hosts (Web on the left, Terminal on the right): the host the session is in is solid, the other is outlined with a chevron. Free: a solid half. Busy: the solid half has a big hole. Unknown: the half is dotted instead of solid. No text, no extra row, no banner; the tooltip lists what a hand-over interrupts. HOW TO SEE IT: select any agent in the list, then pick Free, Busy or Unknown in "Preview hand-over" (next row of this dock); it also works on an agent that is not started here.' },
    },
  },
  readinessPreview: {
    id: 'ui-readiness-preview',
    label: 'Preview hand-over',
    initial: 'real',
    options: {
      real: { label: 'Real', hint: 'No preview: the header shows the real state of the agent, and the hand-over icon above only shows for an agent started here (Web or Terminal) in the state it really has.' },
      free: { label: 'Free', hint: 'Test helper of this dock. Select ANY agent in the list, then pick this: its header behaves as if the agent were free to hand over (nothing runs), in the look chosen above in Hand-over icon. The hand-over icon of an agent that is not started here is a preview: clicking it hands nothing over.' },
      busy: { label: 'Busy: 2 running', hint: 'Test helper of this dock. Select ANY agent in the list, then pick this: its header behaves as if two items were running (a turn and a tool), in the look chosen above in Hand-over icon. Nothing is handed over by clicking.' },
      unknown: { label: 'Unknown', hint: 'Test helper of this dock. Select ANY agent in the list, then pick this: its header behaves as if agent-manager could not tell what runs, in the look chosen above in Hand-over icon. Nothing is handed over by clicking.' },
    },
  },
} as const satisfies Record<string, UiQuestion<string>>;

export type UiQuestionKey = keyof typeof UI_QUESTIONS;
export type UiVariantValues = {
  /** Settled, not a dock question (see TREE_DENSITY). */
  treeDensity: TreeDensityVariant;
  switchReadiness: SwitchReadinessVariant;
  /** Settled, not a dock question (see TREE_DENSITY). */
  groupHeader: GroupHeaderVariant;
  readinessPreview: ReadinessPreviewValue;
};

/** What every question shows when no dock chose (and in a build without the dock). */
export const DEFAULT_UI_VARIANTS: UiVariantValues = {
  treeDensity: 'herdr-tinted',
  switchReadiness: UI_QUESTIONS.switchReadiness.initial,
  groupHeader: 'herdr',
  readinessPreview: UI_QUESTIONS.readinessPreview.initial,
};
