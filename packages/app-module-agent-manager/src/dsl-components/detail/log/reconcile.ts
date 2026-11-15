import type { LogEntry } from '../deps.js';
import type { PendingMessage } from '../pending.js';

/** Clock skew and the delay between click and the line in the transcript. */
const SLACK_MS = 5000;

/** The transcript echoes what the user sent as a user prompt (typed, or queued while the agent was busy), possibly followed by image paths. */
export function echoes(entry: LogEntry, message: PendingMessage): boolean {
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
    if (message.state === 'failed') {
      // A failed message was never sent: it cannot be echoed; it stays until the user dismisses it.
      waiting.push(message);
      continue;
    }
    const match = entries.find((entry) => !used.has(entry.key) && echoes(entry, message));
    if (match === undefined) {
      waiting.push(message);
    } else {
      used.add(match.key);
      echoed.push(message);
    }
  }
  return { echoed, waiting };
}
