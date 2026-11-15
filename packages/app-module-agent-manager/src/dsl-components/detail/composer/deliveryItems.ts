import type { DeliveryUi, ReplyMessageDto } from '../deps.js';
import type { PendingMessage } from '../pending.js';

export interface DeliveryItem {
  messageId: string;
  text: string;
  imageCount: number;
  at: number;
  ui: DeliveryUi;
  /** Failure text or the hint of an unconfirmed delivery; empty otherwise. */
  detail: string;
  /** Tooltip: why the state was reached. */
  reason: string;
}

export const MAX_ITEMS = 5;

/**
 * The "last messages" list: the audited messages of the server (they carry the real state) plus the local ones the server does not list yet or never
 * will (a send that failed before reaching the audit). Newest first, at most MAX_ITEMS.
 */
export function deliveryItems(server: readonly ReplyMessageDto[], local: readonly PendingMessage[]): DeliveryItem[] {
  const known = new Set(server.map((message) => message.messageId));
  const fromServer: DeliveryItem[] = server.map((message) => ({
    messageId: message.messageId,
    text: message.text,
    imageCount: message.imageCount,
    at: message.sentAt,
    ui: message.ui,
    detail: message.state === 'failed' ? [message.reason, message.hint].filter((part) => part !== '').join('. ') : message.hint,
    reason: message.reason,
  }));
  const fromLocal: DeliveryItem[] = local
    .filter((message) => !known.has(message.messageId))
    .map((message) => ({
      messageId: message.messageId,
      text: message.text,
      imageCount: message.imageCount,
      at: message.sentAt,
      ui: message.state,
      detail: message.error ?? '',
      reason: message.state === 'sending' ? 'The request is in flight.' : '',
    }));
  return [...fromLocal, ...fromServer].sort((a, b) => b.at - a.at).slice(0, MAX_ITEMS);
}

/** How long after a send the status keeps being polled for a message that is not final yet (delivered but not seen). */
export const FOLLOW_MS = 2 * 60_000;

/** True while something is worth polling for: a local message still in flight, or a recent one not seen by the agent yet. */
export function needsPolling(server: readonly ReplyMessageDto[], local: readonly PendingMessage[], now: number): boolean {
  const recent = (at: number): boolean => now - at < FOLLOW_MS;
  return local.some((message) => (message.state === 'sending' || message.state === 'delivered') && recent(message.sentAt)) || server.some((message) => (message.ui === 'sending' || message.ui === 'delivered') && recent(message.sentAt));
}
