import type { Session } from '../session.js';

export type ReplyPriority = 'now' | 'next' | 'later';
export const REPLY_PRIORITIES: readonly ReplyPriority[] = ['now', 'next', 'later'];
export const DEFAULT_PRIORITY: ReplyPriority = 'next';

/** What a transport delivers. `text` is the FINAL text (marker, user text and image lines, see composeMessageText); `imagePaths` is repeated for transports that need them apart. */
export interface ReplyMessage {
  /** The message id: safe identifier, also the socket `msg_id` and the id inside the origin marker. */
  id: string;
  text: string;
  imagePaths: string[];
  /** Default 'next'. */
  priority: ReplyPriority;
  /** Where the reply came from, e.g. 'web'. */
  origin: string;
}

/**
 * direct: the transport writes into the session now (socket, herdr); `sent` is the state after accept.
 * mailbox: the reply waits until a hook of the session picks it up (asyncRewake, hot-wait, queue mod); `queued` until then, and it can expire.
 */
export type TransportKind = 'direct' | 'mailbox';

export interface ProbeCheck {
  name: string;
  ok: boolean;
  /** Never contains a token. */
  detail: string;
}

export interface ProbeResult {
  available: boolean;
  /** Why it is available or not, one sentence. */
  reason: string;
  /** What to do when it is not available (empty when it is). */
  fix: string;
  /** JSON-able facts: `checks`, `crossSessionInbound`, `permissionMode`, `warnings`. Never a token. */
  details: Record<string, unknown>;
}

/** Facts about the session that the registry does not carry (UNVERIFIED which registry field holds the mode, if any; the transcript does). */
export interface ProbeContext {
  /** The permission mode of the session as the transcript states it, e.g. 'bypassPermissions'. */
  permissionMode?: string;
}

export interface SendResult {
  /** The transport wrote the message. This is NOT a delivery confirmation: no transport confirms. */
  accepted: boolean;
  detail: string;
  /** Epoch ms. */
  sentAt: number;
  /** An identifier the transport gave the delivery, when it has one (hc: `<terminal>#turn<N>`). Informational: it is not a transcript key. */
  handle?: string;
}

/**
 * How the session sees the message (measured, research/reply-wrapper-and-user-origin.md):
 * peer: Claude Code marks it as a message of another session and wraps it (the model is told it was not typed by the user);
 * typed: it arrives as a prompt typed by the user (origin human), with the full authority of the user.
 */
export type DeliveredAs = 'peer' | 'typed';

/** The wording for the UI and the CLI. */
export const DELIVERED_AS_TEXT: Record<DeliveredAs, string> = {
  peer: 'peer message (wrapped by Claude Code)',
  typed: 'typed prompt (as the user)',
};

export interface ReplyTransport {
  readonly id: string;
  readonly kind: TransportKind;
  /** How the session sees what this transport delivers. */
  readonly deliveredAs: DeliveredAs;
  describe(): string;
  /** Never throws for an unavailable transport: the answer is `available: false` with a reason and a fix. */
  probe(session: Session, context?: ProbeContext): Promise<ProbeResult>;
  /** Throws a ReplyError (with a fix) when the message could not be written. */
  send(session: Session, message: ReplyMessage): Promise<SendResult>;
}
