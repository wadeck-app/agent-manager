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

export const SWITCH_READINESS = ['badge', 'button', 'banner'] as const;
export type SwitchReadinessVariant = (typeof SWITCH_READINESS)[number];

export const READINESS_PREVIEW = ['real', 'free', 'busy', 'unknown'] as const;
export type ReadinessPreviewValue = (typeof READINESS_PREVIEW)[number];

export const GROUP_HEADER = ['herdr', 'bar', 'pill'] as const;
export type GroupHeaderVariant = (typeof GROUP_HEADER)[number];

export const UI_QUESTIONS = {
  switchReadiness: {
    id: 'ui-switch-readiness',
    label: 'Move readiness',
    initial: 'badge',
    options: {
      badge: { label: 'A Badge in the line', hint: 'Recommended. A coloured badge in the header line says "Free to move", "Busy: N running" or "Unknown" (when the line has room), and the Move icon is tinted green (free) or amber (busy, unknown) with a 10 px dot on its corner. No text on the button, no extra row. Shows on the header of the open agent. HOW TO SEE IT: select any agent in the list, then pick Free, Busy or Unknown in "Preview Move readiness" (next row of this dock); it also works on an agent that is not started here.' },
      button: { label: 'B Coloured button', hint: 'No badge in the line: the Move button itself is a coloured pill with words, green "Move: free", amber "Move: N running" or "Move: unknown". Shows on the header of the open agent. HOW TO SEE IT: select any agent in the list, then pick Free, Busy or Unknown in "Preview Move readiness" (next row of this dock); it also works on an agent that is not started here.' },
      banner: { label: 'C Banner row', hint: 'No badge, a plain grey Move icon, and a full-width coloured row under the header says in a sentence what moving does (green: nothing runs; amber: what would be interrupted). Shows on the header of the open agent. HOW TO SEE IT: select any agent in the list, then pick Free, Busy or Unknown in "Preview Move readiness" (next row of this dock); it also works on an agent that is not started here.' },
    },
  },
  readinessPreview: {
    id: 'ui-readiness-preview',
    label: 'Preview Move readiness',
    initial: 'real',
    options: {
      real: { label: 'Real', hint: 'No preview: the header shows the real state of the agent, and the Move readiness looks above only show for an agent started here (Web or Terminal) in the state it really has.' },
      free: { label: 'Free', hint: 'Test helper of this dock. Select ANY agent in the list, then pick this: its header behaves as if the agent were free to move (nothing runs), in the look chosen above in Move readiness. The Move button of an agent that is not started here is a preview: clicking it moves nothing.' },
      busy: { label: 'Busy: 2 running', hint: 'Test helper of this dock. Select ANY agent in the list, then pick this: its header behaves as if two items were running (a turn and a tool), in the look chosen above in Move readiness. Nothing is moved by clicking.' },
      unknown: { label: 'Unknown', hint: 'Test helper of this dock. Select ANY agent in the list, then pick this: its header behaves as if agent-manager could not tell what runs, in the look chosen above in Move readiness. Nothing is moved by clicking.' },
    },
  },
  selectionEntry: {
    id: 'ui-selection-entry',
    label: 'Selection mode entry',
    initial: 'checkbox',
    options: {
      checkbox: { label: 'A Checkbox by the title', hint: 'A checkbox-style toggle right after the "Agents" title turns the selection mode on (checkboxes appear at the left of every row and group header, and a Select all box appears next to it). Click it again, press Escape or clear to leave. Shows in the toolbar above the list.' },
      button: { label: 'B Select button', hint: 'A "Select" button with an icon and a label in the toolbar, before New session, toggles the selection mode (pressed while it is on); Select all appears next to it. Shows in the toolbar above the list.' },
      icon: { label: 'C Icon toggle', hint: 'An icon-only toggle button (a list with checks) in the toolbar icons, with a tooltip, toggles the selection mode; Select all appears next to it. The quietest entry. Shows in the toolbar above the list.' },
    },
  },
  rowSeparator: {
    id: 'ui-row-separator',
    label: 'Name and folder in a row',
    initial: 'space',
    options: {
      space: { label: 'A Colour and space', hint: 'Recommended. No glyph at all: the name in the content colour, then the folder in the muted colour after a clear 8 px gap. The folder gives way first (it is cut, then dropped) so the name keeps its room. Shows in every row of Tree, Custom, Groups, Inbox and in the sub-agent rows.' },
      rule: { label: 'B Thin rule', hint: 'A 1 px vertical rule, 12 px tall, between the name and the folder with the same 8 px gap on each side. Shows in every row of Tree, Custom, Groups, Inbox and in the sub-agent rows.' },
      chip: { label: 'C Mini chip', hint: 'The folder in a tiny neutral outlined chip (16 px high, the module Chip at size xs) after the name. Shows in every row of Tree, Custom, Groups, Inbox and in the sub-agent rows.' },
      folder: { label: 'D Folder icon', hint: 'A small muted folder icon (12 px) followed by the muted folder text, after the name. Shows in every row of Tree, Custom, Groups, Inbox and in the sub-agent rows.' },
      stacked: { label: 'E Stacked', hint: 'Two lines in the row: the name above, the folder below in smaller muted text. The Tree and Custom rows grow from 30 to 44 px; the age, the menu button and the state light stay centred on the same vertical axes. Groups and Inbox rows stack as well.' },
    },
  },
} as const satisfies Record<string, UiQuestion<string>>;

export const ROW_SEPARATOR = ['space', 'rule', 'chip', 'folder', 'stacked'] as const;
export type RowSeparatorVariant = (typeof ROW_SEPARATOR)[number];

export const SELECTION_ENTRY = ['checkbox', 'button', 'icon'] as const;
export type SelectionEntryVariant = (typeof SELECTION_ENTRY)[number];

export type UiQuestionKey = keyof typeof UI_QUESTIONS;
export type UiVariantValues = {
  /** Settled, not a dock question (see TREE_DENSITY). */
  treeDensity: TreeDensityVariant;
  switchReadiness: SwitchReadinessVariant;
  /** Settled, not a dock question (see TREE_DENSITY). */
  groupHeader: GroupHeaderVariant;
  readinessPreview: ReadinessPreviewValue;
  selectionEntry: SelectionEntryVariant;
  rowSeparator: RowSeparatorVariant;
};

/** What every question shows when no dock chose (and in a build without the dock). */
export const DEFAULT_UI_VARIANTS: UiVariantValues = {
  treeDensity: 'herdr-tinted',
  switchReadiness: UI_QUESTIONS.switchReadiness.initial,
  groupHeader: 'herdr',
  readinessPreview: UI_QUESTIONS.readinessPreview.initial,
  selectionEntry: UI_QUESTIONS.selectionEntry.initial,
  rowSeparator: UI_QUESTIONS.rowSeparator.initial,
};
