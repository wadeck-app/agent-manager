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

export const SWITCH_READINESS = ['window', 'wheel', 'plug', 'pill', 'hop'] as const;
export type SwitchReadinessVariant = (typeof SWITCH_READINESS)[number];

export const READINESS_PREVIEW = ['real', 'free', 'busy', 'unknown'] as const;
export type ReadinessPreviewValue = (typeof READINESS_PREVIEW)[number];

export const GROUP_HEADER = ['herdr', 'bar', 'pill'] as const;
export type GroupHeaderVariant = (typeof GROUP_HEADER)[number];

export const HEADER_PLACEMENT = ['in-trail', 'in-page'] as const;
export type HeaderPlacementVariant = (typeof HEADER_PLACEMENT)[number];

export const GRANT_ROW = ['line', 'card', 'table', 'expand', 'grouped'] as const;
export type GrantRowVariant = (typeof GRANT_ROW)[number];

export const CHAT_LAYOUT = ['bubbles', 'claude-ai', 'slack', 'terminal', 'rule', 'card', 'irc', 'doc'] as const;
export type ChatLayoutVariant = (typeof CHAT_LAYOUT)[number];

export const HOOK_ROWS = ['rows', 'merged', 'footer', 'chips'] as const;
export type HookRowsVariant = (typeof HOOK_ROWS)[number];

export const UI_QUESTIONS = {
  headerPlacement: {
    id: 'ui-header-placement',
    label: 'Header placement',
    initial: 'in-trail',
    options: {
      'in-trail': { label: 'In the breadcrumb row', hint: 'The default: the Agents header (title, selection toggle, count, layout menu, search, filter, text size, shortcuts) sits in the shell breadcrumb row, to the right of the breadcrumb, and the page gains one line of height; the shell hides its own page crumb, the title Agents stays in our header. Needs a shell with the header slot (app-core-cli 2026.11.26-236 or later), else the header is not shown. HOW TO SEE IT: nothing to do, open the Agents page: the header is at the top, next to the breadcrumb.' },
      'in-page': { label: 'In the page', hint: 'The header is the bordered row at the top of the page, under the shell breadcrumb row. HOW TO SEE IT: open the Agents page, then pick this option: the header leaves the breadcrumb row and is drawn at the top of the page.' },
    },
  },
  switchReadiness: {
    id: 'ui-switch-readiness',
    label: 'Hand-over icon',
    initial: 'window',
    options: {
      window: { label: 'A Destination window', hint: 'The window of the host the session goes TO (a terminal prompt when it goes to the Terminal, a browser bar when it goes to the Web), with a small arrow leaving through its corner. Free: the arrow alone. Busy: the arrow is filled and takes an amber tone. Unknown: the arrow is dotted and paler. No text, no extra row, no banner; the tooltip lists what a hand-over interrupts. HOW TO SEE IT: select any agent in the list, then pick Free, Busy or Unknown in "Preview hand-over" (next row of this dock); it also works on an agent that is not started here.' },
      wheel: { label: 'B Steering wheel', hint: 'A steering wheel, the known picture of taking over the controls: the other host takes the wheel. Free: an empty wheel. Busy: a solid wheel. Unknown: the rim is dotted. No text, no extra row, no banner; the tooltip lists what a hand-over interrupts. HOW TO SEE IT: select any agent in the list, then pick Free, Busy or Unknown in "Preview hand-over" (next row of this dock); it also works on an agent that is not started here.' },
      plug: { label: 'C Plug', hint: 'A plug: the session plugs into the other host. Free: a hollow plug. Busy: the plug body is solid. Unknown: the plug body is dotted. No text, no extra row, no banner; the tooltip lists what a hand-over interrupts. HOW TO SEE IT: select any agent in the list, then pick Free, Busy or Unknown in "Preview hand-over" (next row of this dock); it also works on an agent that is not started here.' },
      pill: { label: 'D Two hosts', hint: 'A split pill with the two hosts (Web on the left, Terminal on the right): the host the session is in is solid, the other is outlined with a chevron. Free: a solid half. Busy: the solid half has a big hole. Unknown: the half is dotted instead of solid. No text, no extra row, no banner; the tooltip lists what a hand-over interrupts. HOW TO SEE IT: select any agent in the list, then pick Free, Busy or Unknown in "Preview hand-over" (next row of this dock); it also works on an agent that is not started here.' },
      hop: { label: 'E Two slots', hint: 'Two host slots (Web on the left, Terminal on the right) and a dot, the session, with a small hop arc to the other slot. Free: the dot in an empty slot. Busy: the slot is solid with a hole. Unknown: a dotted ring in the slot. No text, no extra row, no banner; the tooltip lists what a hand-over interrupts. HOW TO SEE IT: select any agent in the list, then pick Free, Busy or Unknown in "Preview hand-over" (next row of this dock); it also works on an agent that is not started here.' },
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
  grantRow: {
    id: 'ui-grant-row',
    label: 'Grant row',
    initial: 'line',
    options: {
      line: { label: 'A One line', hint: 'The recommended one. Each bypass is one line (category, time left, use limit only when there is one, trash icon on the right) and its reason on ONE line under it, cut with the full text, the id and the expiry in a tooltip. HOW TO SEE IT: open an agent, Permissions tab (section This session, or Other sessions of this project).' },
      card: { label: 'B Card', hint: 'A small card with a coloured rule on its left (one colour per category), the title, the time left and the trash on the first line, the reason on up to two lines. HOW TO SEE IT: open an agent, Permissions tab.' },
      table: { label: 'C Table', hint: 'The densest: one line per bypass in fixed columns (category, time left, trash) so that the times line up; the reason, the uses and the session are in the tooltip of the line. HOW TO SEE IT: open an agent, Permissions tab, hover or Tab to a category.' },
      expand: { label: 'D Expand', hint: 'A collapsed line (chevron, category, time left, trash); a click opens the reason in full, the uses, the session, the id and the expiry. HOW TO SEE IT: open an agent, Permissions tab, click a bypass line.' },
      grouped: { label: 'E Grouped', hint: 'Bypasses of one session that share their reason and expiry minute (a git-commit and a git-push asked together) are ONE row with one chip each and one trash that revokes all of them (one confirmation, then one revoke after the other, each PIN-gated: the plugin has no revoke-many call). HOW TO SEE IT: open an agent, Permissions tab, with two bypasses made by one request.' },
    },
  },
  chatLayout: {
    id: 'ui-chat-layout',
    label: 'Chat layout',
    initial: 'bubbles',
    options: {
      bubbles: { label: 'A Bubbles (today)', hint: 'The look as it is today, WhatsApp / iMessage / Telegram style: the agent in a bordered bubble on the left, yours tinted on the right, both with a name and age header, up to 92% of the width. HOW TO SEE IT: open any agent with a log: the messages of the conversation (yours and the agent ones) change; tool calls, thinking and notices keep their rows.' },
      'claude-ai': { label: 'B Claude.ai', hint: 'ChatGPT / Claude.ai style, in one centred reading column of about 76 characters: the agent writes as plain text with no bubble and no name, yours is a soft rounded pill on the right (up to 80%). Age and thread action appear on hover or focus. HOW TO SEE IT: open any agent with a log: the messages of the conversation (yours and the agent ones) change; tool calls, thinking and notices keep their rows.' },
      slack: { label: 'C Slack', hint: 'Slack / Discord style: everything on the left, a square glyph (you, Claude), the bold name and the age on one line, the text under it. Following messages of the same sender have no header (age on hover). Full width. HOW TO SEE IT: open any agent with a log: the messages of the conversation (yours and the agent ones) change; tool calls, thinking and notices keep their rows.' },
      terminal: { label: 'D Terminal', hint: 'Claude Code transcript style: no bubble, no name, a left gutter with a glyph (a chevron for you, a dot for Claude), text flush, tight spacing, full width. Age and thread action on hover or focus. HOW TO SEE IT: open any agent with a log: the messages of the conversation (yours and the agent ones) change; tool calls, thinking and notices keep their rows.' },
      rule: { label: 'E Rule', hint: 'Cursor / Copilot Chat / Zed style: a thin coloured rule on the left (blue for you, purple for Claude), a small name and the age above, your block tinted. A long message of yours stops at 6 lines with Show more. HOW TO SEE IT: open any agent with a log: the messages of the conversation (yours and the agent ones) change; tool calls, thinking and notices keep their rows.' },
      card: { label: 'F Card', hint: 'GitHub / Linear comment style: each message is a card with a tinted header strip (glyph, name, age, actions) and an airy body, left aligned, about 90 characters wide. HOW TO SEE IT: open any agent with a log: the messages of the conversation (yours and the agent ones) change; tool calls, thinking and notices keep their rows.' },
      irc: { label: 'G Log lines', hint: 'IRC / terminal log style: one tight line per message, a fixed gutter with the clock time, then the sender (you, claude), then the text wrapping under itself. A message longer than 8 lines stops there with Show more. HOW TO SEE IT: open any agent with a log: the messages of the conversation (yours and the agent ones) change; tool calls, thinking and notices keep their rows.' },
      doc: { label: 'H Document', hint: 'Notion style: a centred document column of about 72 characters, airy; Claude writes the document as plain text, yours are callouts (a tinted block with a person glyph). Age on hover or focus. HOW TO SEE IT: open any agent with a log: the messages of the conversation (yours and the agent ones) change; tool calls, thinking and notices keep their rows.' },
    },
  },
  hookRows: {
    id: 'ui-log-hooks',
    label: 'Hook rows',
    initial: 'rows',
    options: {
      rows: { label: 'A Rows (today)', hint: 'The look as it is today: every hook, the Stop hook summary and the turn duration is a row of its own, with an icon, a label ("System: stop-hook", "System: turn-duration") and an age column. HOW TO SEE IT: open any agent with a log that has hooks (turn the Hooks switch on in the filter popup of the header) and a finished turn: the hook and "System: turn-duration" rows change. Nothing is lost: the full lines open on a click (or in the tooltip); a failed hook is red in every option, and the Hooks filter hides the hook parts in every option.' },
      merged: { label: 'B One line', hint: 'The hooks and the turn rows that follow each other are ONE row: "System" with the names in one line (stop-hook, turn took 32 s) and the age of the first. A click opens the individual lines, each opening in turn. A failed hook turns the row red and says it. HOW TO SEE IT: open any agent with a log that has hooks (turn the Hooks switch on in the filter popup of the header) and a finished turn: the hook and "System: turn-duration" rows change. Nothing is lost: the full lines open on a click (or in the tooltip); a failed hook is red in every option, and the Hooks filter hides the hook parts in every option.' },
      footer: { label: 'C Footer', hint: 'The same run is a slim muted line, no icon column and no age column (the age is in its tooltip): "turn took 32 s, stop-hook ran". A click opens the individual lines. A failed hook turns the line red. HOW TO SEE IT: open any agent with a log that has hooks (turn the Hooks switch on in the filter popup of the header) and a finished turn: the hook and "System: turn-duration" rows change. Nothing is lost: the full lines open on a click (or in the tooltip); a failed hook is red in every option, and the Hooks filter hides the hook parts in every option.' },
      chips: { label: 'D Chips', hint: 'The same run is a strip of small chips right under the message it follows (one chip per hook, one for the stop hooks, one for the duration), no header row. The tooltip of each chip lists its details; a click on the strip opens the individual lines. A failed hook is a red chip. HOW TO SEE IT: open any agent with a log that has hooks (turn the Hooks switch on in the filter popup of the header) and a finished turn: the hook and "System: turn-duration" rows change. Nothing is lost: the full lines open on a click (or in the tooltip); a failed hook is red in every option, and the Hooks filter hides the hook parts in every option.' },
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
  headerPlacement: HeaderPlacementVariant;
  grantRow: GrantRowVariant;
  chatLayout: ChatLayoutVariant;
  hookRows: HookRowsVariant;
};

/** What every question shows when no dock chose (and in a build without the dock). */
export const DEFAULT_UI_VARIANTS: UiVariantValues = {
  treeDensity: 'herdr-tinted',
  switchReadiness: UI_QUESTIONS.switchReadiness.initial,
  groupHeader: 'herdr',
  readinessPreview: UI_QUESTIONS.readinessPreview.initial,
  headerPlacement: UI_QUESTIONS.headerPlacement.initial,
  grantRow: UI_QUESTIONS.grantRow.initial,
  chatLayout: UI_QUESTIONS.chatLayout.initial,
  hookRows: UI_QUESTIONS.hookRows.initial,
};
