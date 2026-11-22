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

export const HEADER_ACTIONS = ['line', 'line-menu', 'detailed'] as const;
export type HeaderActionsVariant = (typeof HEADER_ACTIONS)[number];

export const TREE_DENSITY = ['compact', 'herdr-line', 'herdr-tinted', 'herdr-name'] as const;
export type TreeDensityVariant = (typeof TREE_DENSITY)[number];

export const SWITCH_READINESS = ['badge', 'button', 'banner'] as const;
export type SwitchReadinessVariant = (typeof SWITCH_READINESS)[number];

export const GROUP_HEADER = ['bar', 'plain', 'pill'] as const;
export type GroupHeaderVariant = (typeof GROUP_HEADER)[number];

export const FONT = ['app', 'geist', 'geist-mono'] as const;
export type FontVariant = (typeof FONT)[number];

export const UI_QUESTIONS = {
  headerActions: {
    id: 'ui-header-actions',
    label: 'Header actions',
    initial: 'line',
    options: {
      line: { label: 'A One line', hint: 'Recommended. The whole header on ONE line: name, state, age, folder and branch, model, context, tokens, program, pid, and the actions (Fork, Pin, Mark as seen, Move, Stop) as icons at the far right. What does not fit goes into a +N chip. Shows on the header of the open agent (right of the list).' },
      'line-menu': { label: 'B One line, one menu', hint: 'Same single line, but only Fork stays an icon: Pin and Mark as seen are in one three-dot menu, the quietest line, one more click. Shows on the header of the open agent.' },
      detailed: { label: 'C Detailed', hint: 'The previous header on three rows (name and state, folder and branch, then the chips), kept to compare with the one-line header. Shows on the header of the open agent.' },
    },
  },
  treeDensity: {
    id: 'ui-tree-density',
    label: 'Tree rows',
    initial: 'compact',
    options: {
      compact: { label: 'A Compact', hint: 'Recommended. One line per agent: state icon, name, host icon, time. Shows on every agent row of the list (left).' },
      'herdr-line': { label: 'B Herdr line', hint: 'Like the Herdr panel: program icon, bold name, muted folder, age, and a state light on the right (blue dot = finished and unseen, spinner = working, red pill = needs you, grey ring = idle). Shows on every agent row of the list (left).' },
      'herdr-tinted': { label: 'C Herdr tinted', hint: 'Herdr line with a background tint by state: red when it needs you, blue when finished and unseen, and the open row in a gold outline. Shows on every agent row of the list (left).' },
      'herdr-name': { label: 'D Herdr name only', hint: 'Herdr line without the grey folder text: only the session name and the state light. The densest. Shows on every agent row of the list (left).' },
    },
  },
  switchReadiness: {
    id: 'ui-switch-readiness',
    label: 'Move readiness',
    initial: 'badge',
    options: {
      badge: { label: 'A Badge', hint: 'Recommended. A badge in the header of every agent says Free to move, Busy: N running or Unknown; the Move button stays neutral. Shows under the folder line of the open agent, whatever its host.' },
      button: { label: 'B Button', hint: 'The Move button itself turns amber and carries the count in its label; the badge only shows on agents that cannot move. Shows on the header of the open agent (the button needs a Web or Terminal agent started here).' },
      banner: { label: 'C Banner', hint: 'A neutral Move button and, under the actions, a warning line listing the first reason; the badge only shows on agents that cannot move. Shows on the header of the open agent.' },
    },
  },
  groupHeader: {
    id: 'ui-group-header',
    label: 'Group header',
    initial: 'bar',
    options: {
      bar: { label: 'A Bar', hint: 'Recommended. A tinted header bar with a coloured left edge and the count in a pill. Shows on the folder headers of the list (left) and on your custom groups.' },
      plain: { label: 'B Plain', hint: 'A plain header: the bold name and the count, no tint (the previous look). Shows on the folder headers of the list (left) and on your custom groups.' },
      pill: { label: 'C Pill', hint: 'The folder or group name in an outlined pill: loud, good for a few groups, tiring with ten. Shows on the folder headers of the list (left) and on your custom groups.' },
    },
  },
  font: {
    id: 'ui-font',
    label: 'Font',
    initial: 'app',
    options: {
      app: { label: 'A App font', hint: 'Recommended. The font of the app, as now. Applies to the whole Agents page, its dialogs and its tooltips.' },
      geist: { label: 'B Geist (as in Herdr)', hint: 'The text in Geist, the font of the Herdr agents panel, to feel at home. Code, ids and paths keep the app monospace font. Applies to the whole Agents page, its dialogs and its tooltips.' },
      'geist-mono': { label: 'C Geist + Geist Mono', hint: 'Geist for the text and Geist Mono (Herdr ships it too, JetBrains Mono is not embedded) for tool commands, session ids, pids and paths. Applies to the whole Agents page, its dialogs and its tooltips.' },
    },
  },
} as const satisfies Record<string, UiQuestion<string>>;

export type UiQuestionKey = keyof typeof UI_QUESTIONS;
export type UiVariantValues = {
  headerActions: HeaderActionsVariant;
  treeDensity: TreeDensityVariant;
  switchReadiness: SwitchReadinessVariant;
  groupHeader: GroupHeaderVariant;
  font: FontVariant;
};

/** What every question shows when no dock chose (and in a build without the dock). */
export const DEFAULT_UI_VARIANTS: UiVariantValues = {
  headerActions: UI_QUESTIONS.headerActions.initial,
  treeDensity: UI_QUESTIONS.treeDensity.initial,
  switchReadiness: UI_QUESTIONS.switchReadiness.initial,
  groupHeader: UI_QUESTIONS.groupHeader.initial,
  font: UI_QUESTIONS.font.initial,
};
