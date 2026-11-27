import { getErrorMessage } from './errorText.js';

/*
 * How the messages of the conversation (yours and the agent ones) are drawn in the log. A user setting, saved in this browser (localStorage) like the row look
 * (logic/rowLook.ts): the list menu (Chat section) and the log filter popup edit the same value. A stored value that is not one of the choices is NEVER replaced
 * silently: the default shows and the page says so (`problem`). The layouts themselves (classes) are in detail/log/chatLayouts.ts.
 */

/** The layouts, the default first. */
export const CHAT_LAYOUT_IDS = ['rule', 'bubbles', 'claude-ai', 'terminal'] as const;
export type ChatLayoutVariant = (typeof CHAT_LAYOUT_IDS)[number];

export const DEFAULT_CHAT_LAYOUT: ChatLayoutVariant = 'rule';

export const CHAT_LAYOUT_STORAGE_KEY = 'agent-manager.chatLayout';

export const CHAT_LAYOUT_CHOICES: Record<ChatLayoutVariant, { label: string; hint: string }> = {
  rule: { label: 'Rule', hint: 'A coloured rule on the left, a small name and the age above' },
  bubbles: { label: 'Bubbles', hint: 'The agent in a bordered bubble on the left, yours tinted on the right' },
  'claude-ai': { label: 'Claude.ai', hint: 'One centred reading column, the agent as plain text, yours in a soft pill' },
  terminal: { label: 'Terminal', hint: 'No bubble and no name, a gutter glyph, tight lines' },
};

export function isChatLayout(value: unknown): value is ChatLayoutVariant {
  return CHAT_LAYOUT_IDS.some((id) => id === value);
}

export interface ParsedChatLayout {
  layout: ChatLayoutVariant;
  /** A sentence when the stored value is not valid or the storage cannot be read; empty otherwise (nothing stored is not a problem). */
  problem: string;
}

/** The layout of the stored text (null: nothing stored, the default). A value that is not a choice gives the default AND a problem. */
export function parseChatLayout(text: string | null): ParsedChatLayout {
  if (text === null) {
    return { layout: DEFAULT_CHAT_LAYOUT, problem: '' };
  }
  if (isChatLayout(text)) {
    return { layout: text, problem: '' };
  }
  return {
    layout: DEFAULT_CHAT_LAYOUT,
    problem: `The saved chat layout (key ${CHAT_LAYOUT_STORAGE_KEY} of this browser) is ${JSON.stringify(text)}, expected one of ${CHAT_LAYOUT_IDS.join(', ')}. The default (${DEFAULT_CHAT_LAYOUT}) is shown. Pick a layout in the list menu (Chat section) or in the log filter popup to save a valid one over it.`,
  };
}

/** The saved layout. A storage that throws (private mode) is a problem too, never "nothing saved" without a word. */
export function readChatLayout(): ParsedChatLayout {
  try {
    return parseChatLayout(window.localStorage.getItem(CHAT_LAYOUT_STORAGE_KEY));
  } catch (error) {
    return { layout: DEFAULT_CHAT_LAYOUT, problem: `The browser storage cannot be read (${getErrorMessage(error)}), so the saved chat layout is unknown: the default (${DEFAULT_CHAT_LAYOUT}) is shown. Allow site data for this page in the browser.` };
  }
}

/** Stores the layout. Returns undefined when saved, else the sentence to show: the choice applies until the page reloads. */
export function saveChatLayout(layout: ChatLayoutVariant): string | undefined {
  try {
    window.localStorage.setItem(CHAT_LAYOUT_STORAGE_KEY, layout);
    return undefined;
  } catch (error) {
    return `The chat layout could not be saved (${getErrorMessage(error)}). It applies until you reload the page, then it goes back to ${DEFAULT_CHAT_LAYOUT}. Allow site data for this page in the browser, or free its storage, then pick it again.`;
  }
}
