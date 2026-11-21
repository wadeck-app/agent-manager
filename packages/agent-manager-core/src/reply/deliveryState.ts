import { composeMessageText, originMarkerFor, shortMarkerFor } from './compose.js';
import { wireMsgId } from './messageIds.js';
import { REPLY_MARKER_MODES } from './replyMarker.js';
import type { ReplyConfig } from './config.js';
import type { DeliveredAs, ReplyPriority, TransportKind } from './types.js';

/**
 * queued: a mailbox transport holds it, no session picked it up yet.
 * sent: a direct transport wrote it.
 * queued-in-session: a `queue-operation` enqueue line carrying the origin marker was seen in the transcript.
 * confirmed: a user line carrying the message was seen, whatever the `replyMarker` setting (D-2026-11-19-a): matched by `origin.msg_id` (the socket `msg_id`, see
 *   wireMsgId) first; else by an origin marker (short or full) in the text; else, on a typed transport (hc), by the whole text of an origin-human line at or after the send.
 * unconfirmed: not seen after the confirmation window, or after `hintAfter` on an idle session whose transcript did not grow. Never a hard
 *   failure: it can still become confirmed, the reply is never resent automatically (decision 42).
 * expired: a mailbox reply nobody picked up within `mailboxExpiry`.
 */
export type DeliveryStateName = 'queued' | 'sent' | 'queued-in-session' | 'confirmed' | 'unconfirmed' | 'expired';

export interface DeliveryRecord {
  id: string;
  sessionId: string;
  state: 'queued' | 'sent';
  transportId: string;
  kind: TransportKind;
  /** Epoch ms of the transport accept. */
  sentAt: number;
  priority: ReplyPriority;
  /** Present and true when this call returned an earlier send of the same id instead of sending again. */
  duplicate?: boolean;
  /** An identifier the transport gave the delivery (hc: `<terminal>#turn<N>`). Informational only. */
  handle?: string;
  /** The text the user typed and the saved image paths (from the audit): a typed transport (hc) is confirmed by them, its transcript line has no id. */
  text?: string;
  imagePaths?: readonly string[];
  /** hc only: `hc send` reported that the program went working after the text. An early hint shown in the reason, never a confirmation. */
  started?: boolean;
  /** Present when the message WAS delivered but its audit line could not be written: the delivery stands, only the audit trail has a gap. */
  auditError?: { message: string; fix: string };
}

/** The part of a transcript line this function reads. Other fields are ignored. Entries without a parseable `timestamp` do not count as growth. */
export interface ReplyTranscriptEntry {
  type?: string;
  operation?: string;
  /** ISO text (as in the transcript) or epoch ms. */
  timestamp?: string | number;
  content?: unknown;
  message?: { content?: unknown };
  /** The `origin` of a user line: `kind` ('human', 'peer', ...) and `msg_id` (kept by Claude Code when the socket `msg_id` is a UUID). */
  origin?: { kind?: string; msg_id?: string };
  [key: string]: unknown;
}

/** A transcript line this much before the send still counts (the clocks of Claude Code, hc and this process differ a little). */
const CLOCK_TOLERANCE_MS = 1000;

export interface DeliveryContext {
  /**
   * Transcript lines already used to confirm another reply. A typed reply is matched by its text, so two identical replies ("ok", "ok") need two lines: the caller
   * evaluates the replies oldest first with one shared set; a matching line is added to it.
   */
  claimed?: Set<ReplyTranscriptEntry>;
  /**
   * Every reply of the batch being evaluated (the same session, any order; this record included). Needed to tell identical typed replies apart: when n identical
   * replies were sent but fewer than n matching lines are in the transcript, which of them arrived cannot be told, so none is confirmed by its text (the lines that
   * are there may belong to the later ones). Without it each reply is judged alone.
   */
  siblings?: readonly DeliveryRecord[];
  /** The registry status group of the session now. The hint needs 'idle'. */
  sessionStatus?: 'busy' | 'idle' | 'other';
  /** How the transport of the reply delivers: the "probably not delivered" hint depends on it. Default: peer (the socket wording). */
  deliveredAs?: DeliveredAs;
}

export interface DeliveryStatus {
  state: DeliveryStateName;
  /** Why the state was reached (for the UI tooltip). */
  reason: string;
  /** Set with `unconfirmed` when it comes from the idle hint: what probably happened and what to do. */
  hint?: string;
}

function textOf(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : typeof (part as { text?: unknown })?.text === 'string' ? (part as { text: string }).text : '')).join('\n');
  }
  return '';
}

function timeOf(entry: ReplyTranscriptEntry): number | undefined {
  const value = entry.timestamp;
  const time = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : undefined;
}

/** Line endings and the spaces around the lines do not make a different message. */
export function normalizeReplyText(text: string): string {
  return normalize(text);
}

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

/** What a typed line can equal: the reply composed with each marker mode (the setting may have changed since the send), and the typed text alone. Normalized. */
function typedCandidates(record: DeliveryRecord): Set<string> {
  const wanted = new Set<string>();
  const text = record.text;
  const imagePaths = record.imagePaths ?? [];
  if (text === undefined || (text.trim() === '' && imagePaths.length === 0)) {
    return wanted;
  }
  for (const marker of REPLY_MARKER_MODES) {
    wanted.add(normalize(composeMessageText({ text, imagePaths: [...imagePaths], id: record.id, marker })));
  }
  wanted.add(normalize(text));
  wanted.delete('');
  return wanted;
}

/** What identifies a typed reply for the "identical replies" rule: same transport, same typed text (normalized), same images. */
function sameReplyKey(record: DeliveryRecord): string {
  return [record.transportId, normalize(record.text ?? ''), (record.imagePaths ?? []).join('|')].join('\u0000');
}

function isTypedLine(entry: ReplyTranscriptEntry, typed: ReadonlySet<string>, notBefore: number): boolean {
  const at = timeOf(entry);
  return entry.type === 'user' && entry.origin?.kind === 'human' && at !== undefined && at >= notBefore - CLOCK_TOLERANCE_MS && typed.has(normalize(textOf(entry.message?.content ?? entry.content)));
}

/**
 * The note to show when identical typed replies cannot be told apart, undefined when this reply may be matched by its text. The rule: with n identical replies and
 * fewer than n matching lines (human origin, at or after the first of them), no reply of the group is confirmed by text. It never claims more than the evidence;
 * the residual is a line typed by hand with the same text (it counts as a match, see the threat model).
 */
function identicalRepliesNote(record: DeliveryRecord, entries: readonly ReplyTranscriptEntry[], typed: ReadonlySet<string>, context: DeliveryContext): string | undefined {
  const key = sameReplyKey(record);
  const group = (context.siblings ?? [record]).filter((other) => sameReplyKey(other) === key);
  if (group.length < 2) {
    return undefined;
  }
  const first = Math.min(...group.map((other) => other.sentAt));
  const lines = entries.filter((entry) => isTypedLine(entry, typed, first)).length;
  return lines >= group.length ? undefined : `${group.length} identical replies were sent but ${lines} matching line(s) are in the transcript: which of them arrived cannot be told yet`;
}

/**
 * Does this user line carry the message? `origin.msg_id` decides when the line has one (it does not depend on the text, so no `replyMarker` setting can break it);
 * otherwise a marker (short or full) in the text decides. A line whose `origin.msg_id` is another id is not this message. Last, for a typed transport (hc: no id on
 * the line): the WHOLE text equals the reply (normalized, no substring), the line is origin human, at or after the send (1 s tolerance), and not claimed yet.
 */
function userLineMatch(entry: ReplyTranscriptEntry, record: DeliveryRecord, markers: readonly string[], context: DeliveryContext, typed: ReadonlySet<string>): 'msg_id' | 'marker' | 'text' | undefined {
  const lineId = entry.origin?.msg_id;
  if (typeof lineId === 'string' && lineId !== '') {
    return lineId.toLowerCase() === wireMsgId(record.id) ? 'msg_id' : undefined;
  }
  const text = textOf(entry.message?.content ?? entry.content);
  if (markers.some((marker) => text.includes(marker))) {
    return 'marker';
  }
  if (typed.size > 0 && entry.origin?.kind === 'human' && context.claimed?.has(entry) !== true) {
    const at = timeOf(entry);
    if (at !== undefined && at >= record.sentAt - CLOCK_TOLERANCE_MS && typed.has(normalize(text))) {
      return 'text';
    }
  }
  return undefined;
}

/**
 * Pure state machine of one reply. `transcriptEntries` are the transcript lines of the session (at least those since `record.sentAt`).
 * Order: confirmed > queued-in-session > expired > unconfirmed > the record state.
 * UNVERIFIED: that a peer message appears as a `queue-operation` carrying its text, and that a hook-delivered reminder appears as a line with the
 * marker (it is not a user line: how it appears is still to be measured, M4); until measured, a mailbox reply is confirmed by any line type that
 * holds the marker, which is the only evidence available.
 */
export function deliveryState(record: DeliveryRecord, transcriptEntries: readonly ReplyTranscriptEntry[], now: number, config: ReplyConfig, context: DeliveryContext = {}): DeliveryStatus {
  const marker = originMarkerFor(record.id);
  // Every marker a reply may carry: the setting can change between the send and now, and a reply sent with one marker is still confirmed.
  const markers = [marker, shortMarkerFor(record.id)];
  const candidates = context.deliveredAs === 'typed' ? typedCandidates(record) : new Set<string>();
  const ambiguity = candidates.size > 0 ? identicalRepliesNote(record, transcriptEntries, candidates, context) : undefined;
  // Ambiguous identical replies: no text match at all (the id and marker matches are not affected).
  const typed = ambiguity === undefined ? candidates : new Set<string>();
  let queued = false;
  let grew = false;
  for (const entry of transcriptEntries) {
    const at = timeOf(entry);
    if (at !== undefined && at > record.sentAt) {
      grew = true;
    }
    const matched = entry.type === 'user' ? userLineMatch(entry, record, markers, context, typed) : undefined;
    if (matched !== undefined) {
      const as = entry.origin?.kind === undefined ? '' : ` (origin ${entry.origin.kind})`;
      if (matched === 'text') {
        context.claimed?.add(entry);
      }
      const reason =
        matched === 'msg_id'
          ? `a user line with origin.msg_id of the message is in the transcript${as}`
          : matched === 'marker'
            ? `a user line with the origin marker and the message id is in the transcript${as}`
            : `a user line with the exact text of the reply is in the transcript${as} (no marker or id: matched by the whole text and the time)`;
      return { state: 'confirmed', reason };
    }
    if (record.kind === 'mailbox' && entry.type !== 'queue-operation' && entry.type !== 'assistant' && markers.some((candidate) => textOf(entry.message?.content ?? entry.content).includes(candidate))) {
      return { state: 'confirmed', reason: 'a line with the origin marker and the message id is in the transcript (hook delivery, UNVERIFIED shape)' };
    }
    if (entry.type === 'queue-operation' && entry.operation === 'enqueue' && markers.some((candidate) => textOf(entry.content).includes(candidate))) {
      queued = true;
    }
  }
  if (queued) {
    return { state: 'queued-in-session', reason: 'the session enqueued the message (queue-operation enqueue with the origin marker)' };
  }
  const elapsed = now - record.sentAt;
  if (record.kind === 'mailbox' && config.mailboxExpiryMs > 0 && elapsed > config.mailboxExpiryMs) {
    return { state: 'expired', reason: `no session picked the reply up within the mailbox expiry (${config.mailboxExpiryMs} ms)` };
  }
  if (config.confirmationWindowMs > 0 && elapsed > config.confirmationWindowMs) {
    return { state: 'unconfirmed', reason: `not seen in the transcript within the confirmation window (${config.confirmationWindowMs} ms)` };
  }
  if (config.hintAfterMs > 0 && elapsed > config.hintAfterMs && context.sessionStatus === 'idle' && !grew) {
    return {
      state: 'unconfirmed',
      reason: `the session is idle and its transcript did not grow ${config.hintAfterMs} ms after the send`,
      hint: context.deliveredAs === 'typed'
        ? 'probably not delivered. Check that the terminal still runs the session (hc ls), that no dialog is open in it and that nobody has an unfinished draft there (a draft delays the send, hc setting draft_wait); then resend, or switch transport'
        : 'probably not delivered. Check that crossSessionInbound is "accept" in ~/.claude/settings.json (a session in bypass-permissions holds messages otherwise), that the session is still open, and that Claude Code was not updated (the socket protocol is private); then resend, or switch transport',
    };
  }
  if (ambiguity !== undefined) {
    return { state: record.state, reason: ambiguity };
  }
  if (record.started === true) {
    return { state: record.state, reason: 'hc reported that the program went working after the text (started); the user line is not in the transcript yet' };
  }
  return { state: record.state, reason: record.state === 'queued' ? 'held for the session, not picked up yet' : 'accepted by the transport, not seen in the transcript yet' };
}
