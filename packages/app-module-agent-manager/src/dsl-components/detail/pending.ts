import { useSyncExternalStore } from 'react';
import type { AttachedImage } from './composer/types.js';
import type { ReplyMessageDto } from './deps.js';

/**
 * Messages the user just sent, shown by the log until the transcript echoes them. Written by the composer, read by the log. One in-memory store shared by both
 * (they live in sibling folders). The log removes an entry when it finds the message in the transcript (see detail/log, reconcile), the composer updates
 * `state` from the answers of POST /reply and GET /reply/status, and brings back a message a reload lost (see syncDelivery).
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
  /** 'now' aborts the running tool call: the timeline shows it differently. Absent when unknown. */
  priority?: 'next' | 'now';
}

/** How long a message that is not echoed stays in the timeline as pending before it is forgotten (the audit still lists it). */
export const PENDING_EXPIRY_MS = 10 * 60_000;
/** After this long without the transcript showing it, a pending message is drawn as unconfirmed (a warning, with what to check) instead of "sending". */
export const UNCONFIRMED_AFTER_MS = 2 * 60_000;

const bySession = new Map<string, readonly PendingMessage[]>();
const deliveryBySession = new Map<string, ReadonlyMap<string, ReplyMessageDto>>();
/** Ids the transcript already echoed: never added again from the audit records of the server (it still lists them). */
const settled = new Set<string>();
/** Ids the person dismissed (a failed or unconfirmed bubble): never adopted again from the audit records, also after a reload (sessionStorage, bounded). */
const DISMISSED_KEY = 'agent-manager.dismissedPending';
const MAX_DISMISSED = 200;
let dismissed: Set<string> | undefined;
/** The images of the messages sent from this page (a retry needs them; the audit records only keep their count). Memory only, bounded. */
const imagePayloads = new Map<string, readonly AttachedImage[]>();
const MAX_PAYLOADS = 20;
const listeners = new Set<() => void>();
const EMPTY: readonly PendingMessage[] = [];
const EMPTY_DELIVERY: ReadonlyMap<string, ReplyMessageDto> = new Map();

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

export function updatePending(sessionId: string, messageId: string, patch: Partial<Pick<PendingMessage, 'state' | 'error' | 'priority'>>): void {
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

function dismissedSet(): Set<string> {
  if (dismissed === undefined) {
    dismissed = new Set<string>();
    try {
      const raw = window.sessionStorage.getItem(DISMISSED_KEY);
      const parsed: unknown = raw === null ? [] : JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.filter((item): item is string => typeof item === 'string').forEach((item) => dismissed?.add(item));
      }
    } catch {
      // Unreadable: nothing is remembered as dismissed (a dismissed message may then come back once; it can be dismissed again).
    }
  }
  return dismissed;
}

/** The person dismissed this message: its bubble goes and it is not adopted again from the audit records, even after a reload of the page. */
export function dismissPending(sessionId: string, messageId: string): void {
  const set = dismissedSet();
  set.add(`${sessionId.toLowerCase()}:${messageId}`);
  try {
    window.sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...set].slice(-MAX_DISMISSED)));
  } catch {
    // Not saved: it holds until the page is reloaded.
  }
  imagePayloads.delete(messageId);
  removePending(sessionId, messageId);
}

export function rememberImages(messageId: string, images: readonly AttachedImage[]): void {
  if (images.length === 0) {
    return;
  }
  imagePayloads.set(messageId, images);
  while (imagePayloads.size > MAX_PAYLOADS) {
    const oldest = imagePayloads.keys().next();
    if (oldest.done === true) {
      break;
    }
    imagePayloads.delete(oldest.value);
  }
}

export function getImages(messageId: string): readonly AttachedImage[] | undefined {
  return imagePayloads.get(messageId);
}

/** Whether the message can be sent again as it was: it has text, or its images are still in memory (they are not after a reload). */
export function canRetry(message: PendingMessage): boolean {
  return message.imageCount === 0 ? message.text !== '' : getImages(message.messageId) !== undefined;
}

/** The transcript shows this message: the pending copy goes, and it never comes back from the audit records. */
export function settlePending(sessionId: string, messageId: string): void {
  settled.add(`${sessionId.toLowerCase()}:${messageId}`);
  removePending(sessionId, messageId);
}

/**
 * The audited messages of the server. The timeline looks up the state and the priority of a message it shows from them (a "You, via web" bubble comes from the
 * transcript and only knows its id), and a message a reload would have lost, which is not seen yet, not expired and not echoed, becomes pending again.
 */
export function syncDelivery(sessionId: string, messages: readonly ReplyMessageDto[], now: number): void {
  const id = sessionId.toLowerCase();
  deliveryBySession.set(id, new Map(messages.map((message) => [message.messageId, message])));
  const known = new Set((bySession.get(id) ?? EMPTY).map((message) => message.messageId));
  const adopted: PendingMessage[] = messages
    .filter((message) => !known.has(message.messageId) && !settled.has(`${id}:${message.messageId}`) && !dismissedSet().has(`${id}:${message.messageId}`) && message.ui !== 'seen' && now - message.sentAt < PENDING_EXPIRY_MS)
    .map((message) => ({
      messageId: message.messageId,
      sessionId,
      text: message.text,
      imageCount: message.imageCount,
      sentAt: message.sentAt,
      state: message.ui,
      ...(message.priority === 'now' || message.priority === 'next' ? { priority: message.priority } : {}),
      ...(message.ui === 'failed' ? { error: [message.reason, message.hint].filter((part) => part !== '').join('. ') } : {}),
    }));
  if (adopted.length > 0) {
    bySession.set(id, [...(bySession.get(id) ?? EMPTY), ...adopted].sort((a, b) => a.sentAt - b.sentAt));
  }
  emit();
}

export function getDelivery(sessionId: string): ReadonlyMap<string, ReplyMessageDto> {
  return deliveryBySession.get(sessionId.toLowerCase()) ?? EMPTY_DELIVERY;
}

/** Test helper: forget everything. */
export function resetPending(): void {
  bySession.clear();
  deliveryBySession.clear();
  settled.clear();
  dismissed = undefined;
  imagePayloads.clear();
  try {
    window.sessionStorage.removeItem(DISMISSED_KEY);
  } catch {
    // Nothing to clear.
  }
  emit();
}

/** The pending messages of one session (stable reference while nothing changed). */
export function usePending(sessionId: string): readonly PendingMessage[] {
  return useSyncExternalStore(subscribePending, () => getPending(sessionId));
}

/** The audited messages of one session by id (stable reference until the next sync). */
export function useDelivery(sessionId: string): ReadonlyMap<string, ReplyMessageDto> {
  return useSyncExternalStore(subscribePending, () => getDelivery(sessionId));
}
