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

export const TREE_DENSITY = ['herdr-tinted', 'compact', 'herdr-name'] as const;
export type TreeDensityVariant = (typeof TREE_DENSITY)[number];

export const SWITCH_READINESS = ['badge', 'button', 'banner'] as const;
export type SwitchReadinessVariant = (typeof SWITCH_READINESS)[number];

export const GROUP_HEADER = ['herdr', 'bar', 'pill'] as const;
export type GroupHeaderVariant = (typeof GROUP_HEADER)[number];

export const UI_QUESTIONS = {
  headerActions: {
    id: 'ui-header-actions',
    label: 'Header actions',
    initial: 'line',
    options: {
      line: { label: 'A One line', hint: 'Recommended. The whole header on ONE line: name, state, age, folder and branch, model, context, tokens, program, pid, and the actions (Fork, Pin, Mark as seen, Move, Stop) as icons at the far right. What does not fit goes into a +N chip. Shows on the header of the open agent (right of the list).' },
      'line-menu': { label: 'B One line, one menu', hint: 'Same single line, but only Fork stays an icon: Pin and Mark as seen are in one three-dot menu, the quietest line, one more click. Shows on the header of the open agent.' },
      detailed: { label: 'C Details panel', hint: 'The same one-line header and icons as A, plus a Details button: it opens folder, branch and the chips in a floating panel over the page instead of squeezing them into the line. Shows on the header of the open agent.' },
    },
  },
  treeDensity: {
    id: 'ui-tree-density',
    label: 'Tree rows',
    initial: 'herdr-tinted',
    options: {
      'herdr-tinted': { label: 'A Herdr', hint: 'Recommended. The rows of the Herdr WAgents panel: 30 px, program icon, bold name, muted folder, age, and the state light in a fixed column on the right (blue dot = finished and unseen, spinner = working, "Needs you" pill, grey ring = idle). The open row has a gold outline and a gradient; red, orange and blue tints for needs you, flagged and unseen. Shows on every agent row of the Tree and Custom lists (left).' },
      compact: { label: 'B Compact (previous)', hint: 'The previous rows, kept to compare: state icon on the left, name, host icon, time; 36 px high, no gradient on the open row. The Custom list always uses a Herdr row. Shows on every agent row of the Tree list (left).' },
      'herdr-name': { label: 'C Herdr, name only', hint: 'The Herdr row without the grey folder text: only the session name, the age and the state light. The densest. Shows on every agent row of the Tree and Custom lists (left).' },
    },
  },
  switchReadiness: {
    id: 'ui-switch-readiness',
    label: 'Move readiness',
    initial: 'badge',
    options: {
      badge: { label: 'A Badge in the line', hint: 'Recommended. A coloured badge in the header line says "Free to move", "Busy: N running" or "Unknown" (when the line has room), and the Move icon is tinted green (free) or amber (busy, unknown) with a 10 px dot on its corner. No text on the button, no extra row. Shows on the header of the open agent.' },
      button: { label: 'B Coloured button', hint: 'No badge in the line: the Move button itself is a coloured pill with words, green "Move: free", amber "Move: N running" or "Move: unknown". Shows on the header of the open agent (the button needs a Web or Terminal agent started here).' },
      banner: { label: 'C Banner row', hint: 'No badge, a plain grey Move icon, and a full-width coloured row under the header says in a sentence what moving does (green: nothing runs; amber: what would be interrupted). Shows on the header of the open agent.' },
    },
  },
  groupHeader: {
    id: 'ui-group-header',
    label: 'Group header',
    initial: 'herdr',
    options: {
      herdr: { label: 'A Herdr', hint: 'Recommended. Like the Herdr panel: a small 11 px medium title in grey, the count after it, no background, a gap above; the settings or state icon sits in the same right column as the state lights of the rows. Shows on every group header of the Tree, Groups and Custom lists (left).' },
      bar: { label: 'B Bar', hint: 'A tinted bar with a 4 px coloured left edge, the title in 14 px bold and the count in a grey pill: heavy, easy to find at a glance. Shows on every group header of the Tree, Groups and Custom lists (left).' },
      pill: { label: 'C Pill', hint: 'The group name in an outlined pill, in the colour of the group, the count outside it: loud, good for a few groups, tiring with ten. Shows on every group header of the Tree, Groups and Custom lists (left).' },
    },
  },
} as const satisfies Record<string, UiQuestion<string>>;

export type UiQuestionKey = keyof typeof UI_QUESTIONS;
export type UiVariantValues = {
  headerActions: HeaderActionsVariant;
  treeDensity: TreeDensityVariant;
  switchReadiness: SwitchReadinessVariant;
  groupHeader: GroupHeaderVariant;
};

/** What every question shows when no dock chose (and in a build without the dock). */
export const DEFAULT_UI_VARIANTS: UiVariantValues = {
  headerActions: UI_QUESTIONS.headerActions.initial,
  treeDensity: UI_QUESTIONS.treeDensity.initial,
  switchReadiness: UI_QUESTIONS.switchReadiness.initial,
  groupHeader: UI_QUESTIONS.groupHeader.initial,
};
