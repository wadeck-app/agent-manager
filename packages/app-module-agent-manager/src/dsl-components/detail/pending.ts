import { useSyncExternalStore } from 'react';

/**
 * Messages the user just sent, shown by the log as "sent, waiting" until the transcript echoes them. Written by the composer, read by the log.
 * One in-memory store shared by both (they live in sibling folders). The log removes an entry when it finds the matching user prompt in the transcript
 * (see detail/log, reconcile), the composer updates `state` from the answers of POST /reply and GET /reply/status.
 */
export interface PendingMessage {
  /** The client message id sent to POST /reply (also the key of the delivery list). */
  messageId: string;
  sessionId: string;
  text: string;
  imageCount: number;
  /** Epoch ms of the click on send. */
  sentAt: number;
  /** 'sending': request in flight; 'delivered': accepted; 'seen': the agent took it (queue dequeue / echo); 'failed': nothing was sent. */
  state: 'sending' | 'delivered' | 'seen' | 'failed';
  /** Message and hint of the failure, when state is 'failed'. */
  error?: string;
}

const bySession = new Map<string, readonly PendingMessage[]>();
const listeners = new Set<() => void>();
const EMPTY: readonly PendingMessage[] = [];

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribePending(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPending(sessionId: string): readonly PendingMessage[] {
  return bySession.get(sessionId.toLowerCase()) ?? EMPTY;
}

export function addPending(message: PendingMessage): void {
  const id = message.sessionId.toLowerCase();
  bySession.set(id, [...(bySession.get(id) ?? EMPTY), message]);
  emit();
}

export function updatePending(sessionId: string, messageId: string, patch: Partial<Pick<PendingMessage, 'state' | 'error'>>): void {
  const id = sessionId.toLowerCase();
  const list = bySession.get(id);
  if (list === undefined) {
    return;
  }
  bySession.set(id, list.map((message) => (message.messageId === messageId ? { ...message, ...patch } : message)));
  emit();
}

export function removePending(sessionId: string, messageId: string): void {
  const id = sessionId.toLowerCase();
  const list = bySession.get(id);
  if (list === undefined) {
    return;
  }
  bySession.set(id, list.filter((message) => message.messageId !== messageId));
  emit();
}

/** Test helper: forget everything. */
export function resetPending(): void {
  bySession.clear();
  emit();
}

/** The pending messages of one session (stable reference while nothing changed). */
export function usePending(sessionId: string): readonly PendingMessage[] {
  return useSyncExternalStore(subscribePending, () => getPending(sessionId));
}
