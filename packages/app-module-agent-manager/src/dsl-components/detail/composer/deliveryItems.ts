import type { ReplyMessageDto } from '../deps.js';
import type { PendingMessage } from '../pending.js';

/** How long after a send the status keeps being polled for a message that is not final yet (delivered but not seen). */
export const FOLLOW_MS = 2 * 60_000;

/** True while something is worth polling for: a local message still in flight, or a recent one not seen by the agent yet. */
export function needsPolling(server: readonly ReplyMessageDto[], local: readonly PendingMessage[], now: number): boolean {
  const recent = (at: number): boolean => now - at < FOLLOW_MS;
  return local.some((message) => (message.state === 'sending' || message.state === 'delivered') && recent(message.sentAt)) || server.some((message) => (message.ui === 'sending' || message.ui === 'delivered') && recent(message.sentAt));
}
