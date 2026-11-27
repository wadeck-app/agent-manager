import type { ChatLayoutVariant } from '../deps.js';

/**
 * How the messages of the conversation (yours and the agent ones) are drawn: ONE descriptor per layout, read by ChatMessage (one renderer for the content and
 * the actions of every layout). A layout is only classes and a few modes. The user picks it in the list menu (Chat section) or in the log filter popup, saved in
 * this browser (logic/chatLayoutPref.ts). Tool calls, thinking, hooks and notices are not messages: they keep their rows and only follow the `column` and `gap`
 * of the layout.
 */

/** Where the sender is told: a text glyph before the message, or nowhere (the name is then in the header, or only read aloud). */
export type LeadMode = 'none' | 'prefix';
/** The line above the text: inline (name, age, marks, actions) or none. */
export type HeaderMode = 'inline' | 'none';
/** The age: in the header, or in the toolbar shown on hover or focus. */
export type TimeMode = 'header' | 'hover';

export interface MessageStyle {
  /** The row: the alignment of the message in the column. */
  outer: string;
  /** The message itself: bubble, rule or plain. */
  card: string;
  /** The colour of the message (background, rule); the interrupt cue replaces it. */
  tone: string;
  lead: LeadMode;
  /** Classes of the lead cell (the prefix colour). */
  leadClass: string;
  /** The text glyph of the prefix lead. */
  prefix: string;
  header: HeaderMode;
  /** The name in the header. */
  name: string;
  time: TimeMode;
  /** Lines shown before Show more; absent: the whole message. */
  clampLines?: number;
}

export interface ChatLayout {
  /** The column of every row (messages and the other rows): width and alignment. */
  column: string;
  /** The space between rows. */
  gap: string;
  /** What shows a message that interrupted the running step. */
  interrupt: string;
  user: MessageStyle;
  assistant: MessageStyle;
}

const BLOCK = 'group relative';
const HEADER_NAME = 'text-xs font-medium text-muted';
const RULE_CARD = `${BLOCK} flex w-full flex-col gap-1 border-l-2 py-1 pl-3 pr-2`;
const LINE_CARD = `${BLOCK} flex w-full items-start gap-2 px-2 py-0.5`;

// The black circle (U+25CF), written as a code point: the sources are ASCII only.
const BULLET = String.fromCodePoint(0x25cf);
const NONE = { lead: 'none', leadClass: '', prefix: '', header: 'none', name: HEADER_NAME, time: 'hover' } as const satisfies Partial<MessageStyle>;

const BUBBLES: ChatLayout = {
  column: '',
  gap: 'gap-2',
  interrupt: 'border-warning bg-primary-light',
  user: { ...NONE, header: 'inline', time: 'header', outer: 'flex justify-end', card: `${BLOCK} flex max-w-am-prose flex-col gap-1 rounded-lg border px-3.5 py-2.5`, tone: 'border-transparent bg-primary-light' },
  assistant: { ...NONE, header: 'inline', time: 'header', outer: 'flex justify-start', card: `${BLOCK} flex max-w-am-prose flex-col gap-1 rounded-lg border px-3.5 py-2.5`, tone: 'border-border bg-surface' },
};

const CLAUDE_AI: ChatLayout = {
  column: 'mx-auto w-full max-w-[76ch]',
  gap: 'gap-5',
  interrupt: 'ring-1 ring-warning',
  user: { ...NONE, outer: 'flex justify-end', card: `${BLOCK} max-w-[80%] rounded-2xl px-4 py-2`, tone: 'bg-muted-bg' },
  assistant: { ...NONE, outer: 'flex', card: `${BLOCK} w-full px-1`, tone: '' },
};

const TERMINAL: ChatLayout = {
  column: 'w-full',
  gap: 'gap-1.5',
  interrupt: 'ring-1 ring-warning',
  user: { ...NONE, lead: 'prefix', leadClass: 'text-primary', prefix: '>', outer: 'flex', card: `${LINE_CARD} rounded-sm`, tone: 'bg-muted-bg' },
  assistant: { ...NONE, lead: 'prefix', leadClass: 'text-hue-purple', prefix: BULLET, outer: 'flex', card: LINE_CARD, tone: '' },
};

const RULE: ChatLayout = {
  column: 'w-full',
  gap: 'gap-3',
  interrupt: 'border-warning',
  user: { ...NONE, header: 'inline', time: 'header', name: 'text-xs font-semibold uppercase tracking-wide text-muted', outer: 'flex', card: RULE_CARD, tone: 'border-primary bg-primary-light', clampLines: 6 },
  assistant: { ...NONE, header: 'inline', time: 'header', name: 'text-xs font-semibold uppercase tracking-wide text-muted', outer: 'flex', card: RULE_CARD, tone: 'border-hue-purple' },
};

export const CHAT_LAYOUTS: Record<ChatLayoutVariant, ChatLayout> = {
  rule: RULE,
  bubbles: BUBBLES,
  'claude-ai': CLAUDE_AI,
  terminal: TERMINAL,
};

/** The names of the two senders when nothing else is said (a label that differs, "You (queued)", "You, via web", is shown even where the layout has no name). */
export const PLAIN_LABEL = { user: 'You', assistant: 'Claude' } as const;
