import type { LogEntry } from '../deps.js';
import { PENDING_EXPIRY_MS, type PendingMessage } from '../pending.js';

/** Clock skew and the delay between click and the line in the transcript. */
const SLACK_MS = 5000;

/** A message the agent took (state seen) whose echo never matched stays this long, then it leaves the timeline (the transcript has it). */
export const SEEN_GRACE_MS = 60_000;

/** Line endings and the spaces around the lines do not make a different message. */
function normalized(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

const IMAGE_LINE = /^The user attached an image: .+\. Read it\.$/;

/** The text of a peer entry without the wrapper line, the closing paragraph Claude Code adds and the image lines agent-manager adds (see parseWebReply in the core package). */
function peerText(text: string): string {
  const lines = normalized(
    text
      .replace(/^\s*Another Claude session sent a message:[ \t]*\r?\n\s*/, '')
      .replace(/\n\s*\nThis came from another Claude session[\s\S]*$/, ''),
  ).split('\n');
  while (lines.length > 0 && IMAGE_LINE.test(lines[lines.length - 1]!)) {
    lines.pop();
  }
  return normalized(lines.join('\n'));
}

/**
 * The transcript echoes what the user sent. A reply sent from agent-manager comes back as a "peer" entry that carries its marker: the id is the proof (no text,
 * no clock). Otherwise it is a user prompt (typed, or queued while the agent was busy), possibly followed by image paths: matched by its text and the time.
 */
export function echoes(entry: LogEntry, message: PendingMessage): boolean {
  // Only an entry delivered as a peer message can be our reply (the server sets webReply only for those): the id is then the proof.
  if (entry.kind === 'user-prompt' && entry.source === 'peer' && entry.webReply !== undefined) {
    return entry.webReply.messageId === message.messageId;
  }
  // With the replyMarker setting none (the default) a reply has no marker. The server recognizes it by origin.msg_id (the wire id derived from the message id, which
  // this page cannot compute) and sets webReply: that is the strongest proof, handled above. When the server could not (audit unreadable or not written yet), a peer
  // entry with an origin.msg_id is matched by the WHOLE text (wrapper and image lines set aside, normalized), written at or after the send and not later than the
  // pending expiry. Never a prefix, never an entry without a time, never an image-only message.
  if (entry.kind === 'user-prompt' && entry.source === 'peer' && entry.webReply === undefined && entry.originMsgId !== undefined) {
    const wanted = normalized(message.text);
    return wanted !== '' && entry.timestamp !== undefined && entry.timestamp >= message.sentAt - SLACK_MS && entry.timestamp <= message.sentAt + PENDING_EXPIRY_MS && peerText(entry.text) === wanted;
  }
  if (entry.kind !== 'user-prompt' || (entry.source !== 'human' && entry.source !== 'other')) {
    return false;
  }
  if (entry.timestamp !== undefined && entry.timestamp < message.sentAt - SLACK_MS) {
    return false;
  }
  const wanted = message.text.trim();
  if (wanted === '') {
    // An image-only message: the echo has the saved image path as text, or the image itself.
    return entry.images.length > 0 || entry.text.trim() !== '';
  }
  return entry.text.trim().startsWith(wanted);
}

/** Splits the pending messages into the ones the transcript already shows (to forget) and the ones still waiting (to show). Each entry echoes one message. */
export function reconcilePending(entries: readonly LogEntry[], pending: readonly PendingMessage[]): { echoed: PendingMessage[]; waiting: PendingMessage[] } {
  const used = new Set<string>();
  const echoed: PendingMessage[] = [];
  const waiting: PendingMessage[] = [];
  for (const message of pending) {
    // By id first (exact: the marker of the entry names this message), then by text. A message that failed is matched by id only: by text it could take the echo of
    // another message, and "failed" may be a verdict the transcript later overturns (an unconfirmed delivery the agent did take).
    const byId = entries.find((entry) => !used.has(entry.key) && entry.kind === 'user-prompt' && entry.source === 'peer' && entry.webReply?.messageId === message.messageId);
    const match = byId ?? (message.state === 'failed' ? undefined : entries.find((entry) => !used.has(entry.key) && echoes(entry, message)));
    if (match === undefined) {
      waiting.push(message);
    } else {
      used.add(match.key);
      echoed.push(message);
    }
  }
  return { echoed, waiting };
}

/** The pending messages worth drawing now: a failed one stays, the others until they expire, and a seen one only for a short grace period (the echo normally replaces it at once). */
export function drawable(waiting: readonly PendingMessage[], now: number): PendingMessage[] {
  return waiting.filter((message) => message.state === 'failed' || (now - message.sentAt < PENDING_EXPIRY_MS && !(message.state === 'seen' && now - message.sentAt > SEEN_GRACE_MS)));
}
