import { getErrorMessage } from '@wadeck-app/agent-manager-core';
import { REPLY_MARKER_MODES, composeMessageText, normalizeReplyText, readAudit, wireMsgId, type AuditRecord } from '@wadeck-app/agent-manager-core/reply';
import { stripPeerWrapper } from '@wadeck-app/agent-manager-core/transcript';
import type { LogEntry } from '../commons/api.js';

/** How far back the audit is read to recognize the replies of a log answer. An older reply is shown as the peer message it is (never wrongly linked). */
const LINK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const LINK_LIMIT = 200;
/** An enqueue line of a reply is written right after the send; a line this much later is not it. */
const QUEUE_WINDOW_MS = 60_000;
/** A transcript line this much before the send still counts (clocks differ a little). */
const CLOCK_TOLERANCE_MS = 1000;
/** The wrapper Claude Code puts before the text of a message from another session, on one line or two. */
const QUEUE_WRAPPER = /^\s*Another Claude session sent a message:\s*/;

/** What the page needs to recognize the replies of this session without any marker in the text (replyMarker none, the default). */
export interface LinkResult {
  entries: LogEntry[];
  /** Empty when fine; else why the replies could not be recognized (shown, never hidden). */
  note: string;
}

/** The texts a sent reply can have in the session, whatever the marker setting was at the time: every marker mode, with the image lines. Normalized. */
function sentTexts(record: AuditRecord): string[] {
  return REPLY_MARKER_MODES.map((marker) => normalizeReplyText(composeMessageText({ text: record.text, imagePaths: record.imagePaths, id: record.msgId, marker })));
}

function queuePreviewMatches(entry: Extract<LogEntry, { kind: 'queue-operation' }>, record: AuditRecord, texts: readonly string[]): boolean {
  const preview = entry.contentPreview;
  const at = entry.timestamp;
  if (preview === undefined || at === undefined || at < record.time - CLOCK_TOLERANCE_MS || at > record.time + QUEUE_WINDOW_MS) {
    return false;
  }
  const seen = normalizeReplyText(preview.replace(QUEUE_WRAPPER, ''));
  if (seen === '') {
    return false;
  }
  // A truncated preview is the start of the text: it must be a prefix of the reply, never a loose "contains".
  return texts.some((text) => (entry.contentTruncated === true ? text.startsWith(seen) : text === seen));
}

/**
 * Recognizes the replies sent from agent-manager in a log answer, whatever the `replyMarker` setting was:
 * - a peer message whose `origin.msg_id` is the wire id of an audited reply of this session (exact: the id is derived from the message id) gets `webReply`
 *   (the same shape a marker gives), so the page shows its "You, via web" row and delivery mark;
 * - a queue enqueue whose preview is, exactly (normalized), the text of an audited reply sent just before gets `webReplyId`, so the page can hide it. A person's own
 *   queued line is never marked unless it equals the text of a reply we sent at that moment.
 * Nothing else changes. When the audit cannot be read the entries stay as they are and the note says so.
 */
export async function linkWebReplies(entries: readonly LogEntry[], sessionId: string, configDir: string): Promise<LinkResult> {
  const wantsUser = (entry: LogEntry): boolean => entry.kind === 'user-prompt' && entry.source === 'peer' && entry.webReply === undefined && entry.originMsgId !== undefined;
  const wantsQueue = (entry: LogEntry): boolean => entry.kind === 'queue-operation' && entry.operation === 'enqueue' && entry.webReplyId === undefined && entry.contentPreview !== undefined;
  if (!entries.some((entry) => wantsUser(entry) || wantsQueue(entry))) {
    return { entries: [...entries], note: '' };
  }
  let records: AuditRecord[];
  try {
    records = (await readAudit(configDir, { limit: LINK_LIMIT, sinceMs: Date.now() - LINK_WINDOW_MS, sessionId })).records.filter((record) => record.outcome === 'sent');
  } catch (error) {
    return { entries: [...entries], note: `The reply audit cannot be read (${getErrorMessage(error)}): the messages sent from this page are shown as plain messages of another session. Check the permissions of ${configDir}.` };
  }
  const byWireId = new Map(records.map((record) => [wireMsgId(record.msgId), record]));
  const linked = entries.map((entry): LogEntry => {
    if (entry.kind === 'user-prompt' && wantsUser(entry)) {
      const record = byWireId.get(entry.originMsgId!.toLowerCase());
      return record === undefined ? entry : { ...entry, webReply: { messageId: record.msgId, text: stripPeerWrapper(entry.text) } };
    }
    if (entry.kind === 'queue-operation' && wantsQueue(entry)) {
      const record = records.find((candidate) => queuePreviewMatches(entry, candidate, sentTexts(candidate)));
      return record === undefined ? entry : { ...entry, webReplyId: record.msgId };
    }
    return entry;
  });
  return { entries: linked, note: '' };
}
