import { originMarkerFor } from './compose.js';
import type { ReplyConfig } from './config.js';
import type { ReplyPriority, TransportKind } from './types.js';

/**
 * queued: a mailbox transport holds it, no session picked it up yet.
 * sent: a direct transport wrote it.
 * queued-in-session: a `queue-operation` enqueue line carrying the origin marker was seen in the transcript.
 * confirmed: a user line with the origin marker (which contains the id) was seen.
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
  [key: string]: unknown;
}

export interface DeliveryContext {
  /** The registry status group of the session now. The hint needs 'idle'. */
  sessionStatus?: 'busy' | 'idle' | 'other';
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

/**
 * Pure state machine of one reply. `transcriptEntries` are the transcript lines of the session (at least those since `record.sentAt`).
 * Order: confirmed > queued-in-session > expired > unconfirmed > the record state.
 * UNVERIFIED: that a peer message appears as a `queue-operation` carrying its text, and that a hook-delivered reminder appears as a line with the
 * marker (it is not a user line: how it appears is still to be measured, M4); until measured, a mailbox reply is confirmed by any line type that
 * holds the marker, which is the only evidence available.
 */
export function deliveryState(record: DeliveryRecord, transcriptEntries: readonly ReplyTranscriptEntry[], now: number, config: ReplyConfig, context: DeliveryContext = {}): DeliveryStatus {
  const marker = originMarkerFor(record.id);
  let queued = false;
  let grew = false;
  for (const entry of transcriptEntries) {
    const at = timeOf(entry);
    if (at !== undefined && at > record.sentAt) {
      grew = true;
    }
    if (entry.type === 'user' && textOf(entry.message?.content ?? entry.content).includes(marker)) {
      return { state: 'confirmed', reason: 'a user line with the origin marker and the message id is in the transcript' };
    }
    if (record.kind === 'mailbox' && entry.type !== 'queue-operation' && entry.type !== 'assistant' && textOf(entry.message?.content ?? entry.content).includes(marker)) {
      return { state: 'confirmed', reason: 'a line with the origin marker and the message id is in the transcript (hook delivery, UNVERIFIED shape)' };
    }
    if (entry.type === 'queue-operation' && entry.operation === 'enqueue' && textOf(entry.content).includes(marker)) {
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
      hint: 'probably not delivered. Check that crossSessionInbound is "accept" in ~/.claude/settings.json (a session in bypass-permissions holds messages otherwise), that the session is still open, and that Claude Code was not updated (the socket protocol is private); then resend, or switch transport',
    };
  }
  return { state: record.state, reason: record.state === 'queued' ? 'held for the session, not picked up yet' : 'accepted by the transport, not seen in the transcript yet' };
}
