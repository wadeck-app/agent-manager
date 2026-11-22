import type { LogEntry, OwnedForkRequest } from '../shared.js';

/** What a thread is, in one place for the dialog and the button (research/session-fork.md, "Mini-fork / side thread"). */
export const THREAD_MEANING = 'Opens a new Web session that knows this conversation up to this message. The original is not changed.';

/** The cap of live threads per source session (DEFAULT_MAX_THREADS_PER_SESSION of the daemon host). */
export const THREAD_MAX = 3;

export interface ThreadLimitLine {
  /** caption: a small muted line. error: the cap is reached, the start is off. */
  tone: 'caption' | 'error';
  text: string;
}

/** What the dialog says about the cap: nothing while there is room, a caption from two live threads on, an error at the cap. */
export function threadLimitLine(inUse: number): ThreadLimitLine | undefined {
  if (inUse >= THREAD_MAX) {
    return { tone: 'error', text: `Thread limit reached: ${inUse} of ${THREAD_MAX} threads in use. Stop one of them to start another.` };
  }
  return inUse >= 2 ? { tone: 'caption', text: `${inUse} of ${THREAD_MAX} threads in use` } : undefined;
}

/** More than three lines or about 160 characters: the preview cuts it at three lines and offers "show full". */
export function quoteIsLong(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 160 || trimmed.split('\n').length > 3;
}

export type ThreadAnchor = { kind: 'ok'; uuid: string; text: string } | { kind: 'blocked'; reason: string };

/**
 * Whether a log row can open a thread, and on which transcript entry. Only the messages of the conversation count: what the person wrote (typed or sent from
 * agent-manager, shown with the words they wrote) and the text of the assistant. A tool call, a thinking block, a notice, harness text, an injected or peer
 * prompt and anything that belongs to a sub-agent transcript has no thread (undefined). A message whose transcript line carried no `uuid` is `blocked` with the
 * reason: the button says why it is off instead of disappearing.
 */
export function threadAnchorOf(entry: LogEntry): ThreadAnchor | undefined {
  if (entry.ownerAgentId !== undefined) {
    return undefined;
  }
  let text: string;
  if (entry.kind === 'assistant-text') {
    text = entry.text;
  } else if (entry.kind === 'user-prompt' && entry.harness === undefined && (entry.source === 'human' || entry.source === 'other' || entry.webReply !== undefined)) {
    text = entry.webReply?.text ?? entry.text;
  } else {
    return undefined;
  }
  if (entry.uuid === undefined) {
    return { kind: 'blocked', reason: 'This message has no uuid in the transcript (an older Claude Code wrote it), so a thread cannot stop at it.' };
  }
  return { kind: 'ok', uuid: entry.uuid, text };
}

export interface ThreadForm {
  sourceSessionId: string;
  atMessageId: string;
  /** The one-line quote of the message (shortMessage): kept by the daemon in the record of the thread for its chip. */
  atMessageQuote?: string;
  name: string;
  model: string;
  permissionMode: string;
}

/** The body of POST /owned/fork for a thread: only the fields that have a value. */
export function threadBody(form: ThreadForm): OwnedForkRequest {
  const name = form.name.trim();
  const model = form.model.trim();
  const permissionMode = form.permissionMode.trim();
  const quote = form.atMessageQuote?.trim() ?? '';
  return { sourceSessionId: form.sourceSessionId, atMessageId: form.atMessageId, ...(quote === '' ? {} : { atMessageQuote: quote }), ...(name === '' ? {} : { name }), ...(model === '' ? {} : { model }), ...(permissionMode === '' ? {} : { permissionMode }) };
}

const QUOTE_CHARS = 40;

/** One line of a message, cut at 40 characters with "..." (the quote of the chip and of the dialog). */
export function shortMessage(text: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length <= QUOTE_CHARS ? clean : `${clean.slice(0, QUOTE_CHARS)}...`;
}

/** The text of the chip of a thread: where it comes from and at which message. The quote comes from the record of the thread (a thread of an older version has none: the short id). */
export function threadChipText(sourceName: string | undefined, quote: string | undefined, messageId: string): string {
  const source = sourceName === undefined ? 'an agent that is not in the list' : sourceName;
  return `thread of ${source} at ${quote === undefined || quote === '' ? `message ${messageId.slice(0, 8)}` : `"${quote}"`}`;
}
