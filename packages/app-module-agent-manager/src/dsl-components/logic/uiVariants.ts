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

export const HEADER_ACTIONS = ['inline', 'menu', 'split'] as const;
export type HeaderActionsVariant = (typeof HEADER_ACTIONS)[number];

export const TREE_DENSITY = ['comfortable', 'compact', 'card'] as const;
export type TreeDensityVariant = (typeof TREE_DENSITY)[number];

export const CHIP_STYLE = ['soft', 'outline', 'dot'] as const;
export type ChipStyleVariant = (typeof CHIP_STYLE)[number];

export const SWITCH_READINESS = ['badge', 'button', 'banner'] as const;
export type SwitchReadinessVariant = (typeof SWITCH_READINESS)[number];

export const THREAD_PLACEMENT = ['hover', 'always', 'labelled'] as const;
export type ThreadPlacementVariant = (typeof THREAD_PLACEMENT)[number];

export const GROUP_HEADER = ['bar', 'plain', 'pill'] as const;
export type GroupHeaderVariant = (typeof GROUP_HEADER)[number];

export const UI_QUESTIONS = {
  headerActions: {
    id: 'ui-header-actions',
    label: 'Header actions',
    initial: 'inline',
    options: {
      inline: { label: 'A Inline', hint: 'Recommended. Fork, Pin and Mark as seen stay three icon buttons with tooltips on the title row (they are small: width was never the problem, the height of the header was, and that is fixed for every option). Nothing is hidden.' },
      menu: { label: 'B Menu', hint: 'One More actions button (three dots) opens a menu with Fork, Pin and Mark as seen: the quietest header and the best on a phone, at the price of one extra click for Fork.' },
      split: { label: 'C Split', hint: 'A labelled Fork button with a chevron that opens Pin and Mark as seen: Fork is the action people look for, so it is named, the others are one click behind.' },
    },
  },
  treeDensity: {
    id: 'ui-tree-density',
    label: 'Tree rows',
    initial: 'comfortable',
    options: {
      comfortable: { label: 'A Comfortable', hint: 'Recommended. Name and time on the first line, the last action and the host and state chips on the second: the name is never cut by a chip.' },
      compact: { label: 'B Compact', hint: 'One line per agent: the name, then an icon for the host (its name is in the tooltip) and the state chip only when it needs you. Densest, the host text is not readable at a glance.' },
      card: { label: 'C Card', hint: 'Comfortable inside a bordered card with a gap between agents: each agent reads as its own object, at the price of about 25 % fewer agents per screen.' },
    },
  },
  chipStyle: {
    id: 'ui-chip-style',
    label: 'Status chips',
    initial: 'soft',
    options: {
      soft: { label: 'A Soft', hint: 'Recommended. A tinted pill with its icon and label, the look the page already has.' },
      outline: { label: 'B Outline', hint: 'A bordered pill on the page background: quieter in a long list, the colour is carried by the text and border only.' },
      dot: { label: 'C Dot', hint: 'A coloured dot and plain text, no pill: the quietest, the least visible when something needs you.' },
    },
  },
  switchReadiness: {
    id: 'ui-switch-readiness',
    label: 'Move readiness',
    initial: 'badge',
    options: {
      badge: { label: 'A Badge', hint: 'Recommended. A short button ("Move to Terminal") and next to it a badge that says what runs ("8 running"); the colour of the badge, not of the button, warns.' },
      button: { label: 'B Button', hint: 'The button itself turns amber and carries the count in its label (the previous behaviour): one control, but a long label that wraps on a narrow screen.' },
      banner: { label: 'C Banner', hint: 'A neutral button and, under the actions, a warning line that lists the first reason: the clearest, the tallest.' },
    },
  },
  threadPlacement: {
    id: 'ui-thread-placement',
    label: 'Thread action',
    initial: 'hover',
    options: {
      hover: { label: 'A On hover', hint: 'Recommended. The Thread icon shows when the pointer or the keyboard focus is on the message, and always on a touch screen: the log stays calm, the action is one click away.' },
      always: { label: 'B Always', hint: 'The icon is always visible on every message (the previous behaviour): discoverable, but it repeats on every row of a long log.' },
      labelled: { label: 'C Labelled', hint: 'A text button "Thread" on hover or focus: explicit, wider, and it covers the time label on a narrow screen.' },
    },
  },
  groupHeader: {
    id: 'ui-group-header',
    label: 'Group header',
    initial: 'bar',
    options: {
      bar: { label: 'A Bar', hint: 'Recommended. A tinted header bar with the group colour as a left edge and the count in a pill: groups are easy to tell from the folders under them.' },
      plain: { label: 'B Plain', hint: 'The header of a folder (the previous look): same weight as the folders, the group is told by its coloured dot only.' },
      pill: { label: 'C Pill', hint: 'The group name in a coloured pill: loud, good for a few groups, tiring with ten.' },
    },
  },
} as const satisfies Record<string, UiQuestion<string>>;

export type UiQuestionKey = keyof typeof UI_QUESTIONS;
export type UiVariantValues = {
  headerActions: HeaderActionsVariant;
  treeDensity: TreeDensityVariant;
  chipStyle: ChipStyleVariant;
  switchReadiness: SwitchReadinessVariant;
  threadPlacement: ThreadPlacementVariant;
  groupHeader: GroupHeaderVariant;
};

/** What every question shows when no dock chose (and in a build without the dock). */
export const DEFAULT_UI_VARIANTS: UiVariantValues = {
  headerActions: UI_QUESTIONS.headerActions.initial,
  treeDensity: UI_QUESTIONS.treeDensity.initial,
  chipStyle: UI_QUESTIONS.chipStyle.initial,
  switchReadiness: UI_QUESTIONS.switchReadiness.initial,
  threadPlacement: UI_QUESTIONS.threadPlacement.initial,
  groupHeader: UI_QUESTIONS.groupHeader.initial,
};
