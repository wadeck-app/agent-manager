import type { ChatLayoutVariant } from '../deps.js';

/**
 * How the messages of the conversation (yours and the agent ones) are drawn: ONE descriptor per layout, read by ChatMessage (one renderer for the content and
 * the actions of every layout). A layout is only classes and a few modes; promoting one to a persisted setting is adding its id to a list and reading it from
 * localStorage (see logic/rowLook.ts for the pattern). Tool calls, thinking, hooks and notices are not messages: they keep their rows and only follow the
 * `column` and `gap` of the layout.
 */

/** Where the sender is told: a column before the text (glyph box, bare glyph, text glyph, clock and name), or nowhere (the name is then in the header, or only read aloud). */
export type LeadMode = 'none' | 'avatar' | 'icon' | 'prefix' | 'gutter';
/** The line above the text: inline (name, age, marks, actions), a tinted strip of a card, or none. */
export type HeaderMode = 'inline' | 'strip' | 'none';
/** The age: in the header, in the toolbar shown on hover or focus, or in the gutter column. */
export type TimeMode = 'header' | 'hover' | 'gutter';

export interface MessageStyle {
  /** The row: the alignment of the message in the column. */
  outer: string;
  /** The message itself: bubble, card, rule or plain. */
  card: string;
  /** The colour of the message (background, rule); the interrupt cue replaces it. */
  tone: string;
  lead: LeadMode;
  /** Classes of the lead cell (the glyph box, the prefix colour). */
  leadClass: string;
  /** The text glyph of the prefix lead. */
  prefix: string;
  header: HeaderMode;
  /** The header strip of a card. */
  strip: string;
  /** The name in the header. */
  name: string;
  time: TimeMode;
  /** Wraps the body (padding of a card). */
  body: string;
  /** Lines shown before Show more; absent: the whole message. */
  clampLines?: number;
}

export interface ChatLayout {
  /** The column of every row (messages and the other rows): width and alignment. */
  column: string;
  /** The space between rows. */
  gap: string;
  /** A following message of the same sender drops its lead and header (Slack, Discord). */
  groupSender: boolean;
  /** Added to the row of a message that starts a group, when groupSender. */
  groupStart: string;
  /** What shows a message that interrupted the running step. */
  interrupt: string;
  user: MessageStyle;
  assistant: MessageStyle;
}

const BLOCK = 'group relative';
const HEADER_NAME = 'text-xs font-medium text-muted';
const STRONG_NAME = 'text-sm font-semibold text-content';
const AVATAR = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-md';
const RULE_CARD = `${BLOCK} flex w-full flex-col gap-1 border-l-2 py-1 pl-3 pr-2`;
const CARD_BOX = `${BLOCK} w-full overflow-hidden rounded-lg border border-border bg-surface`;
const STRIP = 'flex items-center gap-2 border-b border-border px-3 py-1.5';
const LINE_CARD = `${BLOCK} flex w-full items-start gap-2 px-2 py-0.5`;

const NONE = { lead: 'none', leadClass: '', prefix: '', header: 'none', strip: '', name: HEADER_NAME, time: 'hover', body: '' } as const satisfies Partial<MessageStyle>;

const BUBBLES: ChatLayout = {
  column: '',
  gap: 'gap-2',
  groupSender: false,
  groupStart: '',
  interrupt: 'border-warning bg-primary-light',
  user: { ...NONE, header: 'inline', time: 'header', outer: 'flex justify-end', card: `${BLOCK} flex max-w-am-prose flex-col gap-1 rounded-lg border px-3.5 py-2.5`, tone: 'border-transparent bg-primary-light' },
  assistant: { ...NONE, header: 'inline', time: 'header', outer: 'flex justify-start', card: `${BLOCK} flex max-w-am-prose flex-col gap-1 rounded-lg border px-3.5 py-2.5`, tone: 'border-border bg-surface' },
};

const CLAUDE_AI: ChatLayout = {
  column: 'mx-auto w-full max-w-[76ch]',
  gap: 'gap-5',
  groupSender: false,
  groupStart: '',
  interrupt: 'ring-1 ring-warning',
  user: { ...NONE, outer: 'flex justify-end', card: `${BLOCK} max-w-[80%] rounded-2xl px-4 py-2`, tone: 'bg-muted-bg' },
  assistant: { ...NONE, outer: 'flex', card: `${BLOCK} w-full px-1`, tone: '' },
};

const SLACK: ChatLayout = {
  column: 'w-full',
  gap: 'gap-0.5',
  groupSender: true,
  groupStart: 'mt-2',
  interrupt: 'ring-1 ring-warning',
  user: { ...NONE, lead: 'avatar', leadClass: `${AVATAR} bg-primary-light`, header: 'inline', time: 'header', name: STRONG_NAME, outer: 'flex', card: `${BLOCK} flex w-full gap-3 rounded px-2 py-1 hover:bg-muted-bg`, tone: '' },
  assistant: { ...NONE, lead: 'avatar', leadClass: `${AVATAR} bg-muted-bg`, header: 'inline', time: 'header', name: STRONG_NAME, outer: 'flex', card: `${BLOCK} flex w-full gap-3 rounded px-2 py-1 hover:bg-muted-bg`, tone: '' },
};

const TERMINAL: ChatLayout = {
  column: 'w-full',
  gap: 'gap-1.5',
  groupSender: false,
  groupStart: '',
  interrupt: 'ring-1 ring-warning',
  user: { ...NONE, lead: 'prefix', leadClass: 'text-primary', prefix: '>', outer: 'flex', card: `${LINE_CARD} rounded-sm`, tone: 'bg-muted-bg' },
  assistant: { ...NONE, lead: 'prefix', leadClass: 'text-hue-purple', prefix: '\u25CF', outer: 'flex', card: LINE_CARD, tone: '' },
};

const RULE: ChatLayout = {
  column: 'w-full',
  gap: 'gap-3',
  groupSender: false,
  groupStart: '',
  interrupt: 'border-warning',
  user: { ...NONE, header: 'inline', time: 'header', name: 'text-xs font-semibold uppercase tracking-wide text-muted', outer: 'flex', card: RULE_CARD, tone: 'border-primary bg-primary-light', clampLines: 6 },
  assistant: { ...NONE, header: 'inline', time: 'header', name: 'text-xs font-semibold uppercase tracking-wide text-muted', outer: 'flex', card: RULE_CARD, tone: 'border-hue-purple' },
};

const CARD: ChatLayout = {
  column: 'mr-auto w-full max-w-[90ch]',
  gap: 'gap-4',
  groupSender: false,
  groupStart: '',
  interrupt: 'ring-2 ring-warning',
  user: { ...NONE, header: 'strip', time: 'header', strip: `${STRIP} bg-primary-light`, name: STRONG_NAME, outer: 'flex', card: CARD_BOX, tone: '', body: 'px-3 py-3' },
  assistant: { ...NONE, header: 'strip', time: 'header', strip: `${STRIP} bg-muted-bg`, name: STRONG_NAME, outer: 'flex', card: CARD_BOX, tone: '', body: 'px-3 py-3' },
};

const IRC_CARD = `${BLOCK} flex w-full items-baseline gap-2 rounded-sm px-1 hover:bg-muted-bg`;

const IRC: ChatLayout = {
  column: 'w-full',
  gap: 'gap-0.5',
  groupSender: false,
  groupStart: '',
  interrupt: 'ring-1 ring-warning',
  user: { ...NONE, lead: 'gutter', leadClass: 'text-primary', time: 'gutter', outer: 'flex', card: IRC_CARD, tone: '', clampLines: 8 },
  assistant: { ...NONE, lead: 'gutter', leadClass: 'text-hue-purple', time: 'gutter', outer: 'flex', card: IRC_CARD, tone: '', clampLines: 8 },
};

const DOC: ChatLayout = {
  column: 'mx-auto w-full max-w-[72ch]',
  gap: 'gap-6',
  groupSender: false,
  groupStart: '',
  interrupt: 'ring-1 ring-warning',
  user: { ...NONE, lead: 'icon', leadClass: 'text-primary', outer: 'flex', card: `${BLOCK} flex w-full gap-3 rounded-lg px-4 py-3`, tone: 'bg-muted-bg' },
  assistant: { ...NONE, outer: 'flex', card: `${BLOCK} w-full px-1`, tone: '' },
};

export const CHAT_LAYOUTS: Record<ChatLayoutVariant, ChatLayout> = {
  bubbles: BUBBLES,
  'claude-ai': CLAUDE_AI,
  slack: SLACK,
  terminal: TERMINAL,
  rule: RULE,
  card: CARD,
  irc: IRC,
  doc: DOC,
};

/** The names of the two senders when nothing else is said (a label that differs, "You (queued)", "You, via web", is shown even where the layout has no name). */
export const PLAIN_LABEL = { user: 'You', assistant: 'Claude' } as const;
