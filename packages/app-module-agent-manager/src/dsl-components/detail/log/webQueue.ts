import type { LogEntry } from '../deps.js';

const MARKER = /\[web reply via agent-manager #[A-Za-z0-9_.-]+\]/;

/**
 * The "Queue enqueue" and "Queue dequeue" lines of a message sent from agent-manager say nothing the bubble of the message does not: they are left out of the
 * timeline. An enqueue is ours when its preview holds our marker. The dequeue that IMMEDIATELY follows it in the list (the agent taking that message) goes with
 * it; nothing is counted or carried: a dequeue that does not directly follow a hidden enqueue (its enqueue is outside the list, or another entry sits between)
 * is not paired and stays visible, so an unrelated dequeue is never hidden by mistake. Every other queue line stays visible.
 */
export function hideWebQueueLines(entries: readonly LogEntry[]): LogEntry[] {
  const out: LogEntry[] = [];
  let afterHiddenEnqueue = false;
  for (const entry of entries) {
    if (entry.kind === 'queue-operation') {
      if (entry.operation === 'enqueue' && entry.contentPreview !== undefined && MARKER.test(entry.contentPreview)) {
        afterHiddenEnqueue = true;
        continue;
      }
      if (entry.operation === 'dequeue' && afterHiddenEnqueue) {
        afterHiddenEnqueue = false;
        continue;
      }
    }
    afterHiddenEnqueue = false;
    out.push(entry);
  }
  return out;
}
