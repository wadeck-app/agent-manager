import { useCallback, useRef, useState } from 'react';
import { failureText, requestJson } from '../deps.js';
import type { ReplyOk, ReplyRequest, ReplyResponse } from '../deps.js';
import { addPending, getPending, removePending, updatePending } from '../pending.js';
import type { AttachedImage } from './types.js';

export interface SendInput {
  text: string;
  images: readonly AttachedImage[];
  priority: 'next' | 'now';
}

export type SendOutcome = { ok: true; response: ReplyOk } | { ok: false; error: string };

function newMessageId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function fingerprint(input: SendInput): string {
  return JSON.stringify([input.text, input.priority, input.images.map((image) => image.id)]);
}

/**
 * POST /sessions/:id/reply. The log shows the message at once (pending store). A failed send keeps its message id: sending the SAME payload again
 * reuses it, so the server never delivers it twice (the answer then says `duplicate`). A changed payload gets a new id and the failed one is dropped.
 */
export function useSendReply(sessionId: string): { send: (input: SendInput) => Promise<SendOutcome>; sending: boolean } {
  const [sending, setSending] = useState(false);
  const retry = useRef<{ print: string; messageId: string } | undefined>(undefined);

  const send = useCallback(
    async (input: SendInput): Promise<SendOutcome> => {
      const print = fingerprint(input);
      const previous = retry.current;
      const messageId = previous?.print === print ? previous.messageId : newMessageId();
      if (previous !== undefined && previous.messageId !== messageId) {
        removePending(sessionId, previous.messageId);
      }
      retry.current = { print, messageId };
      if (getPending(sessionId).some((message) => message.messageId === messageId)) {
        updatePending(sessionId, messageId, { state: 'sending', error: undefined });
      } else {
        addPending({ messageId, sessionId, text: input.text, imageCount: input.images.length, sentAt: Date.now(), state: 'sending' });
      }
      setSending(true);
      const body: ReplyRequest = {
        text: input.text,
        messageId,
        priority: input.priority,
        ...(input.priority === 'now' ? { confirmNow: true } : {}),
        ...(input.images.length > 0 ? { images: input.images.map(({ name, mime, dataBase64 }) => ({ name, mime, dataBase64 })) } : {}),
      };
      const result = await requestJson<ReplyResponse>(`/sessions/${encodeURIComponent(sessionId)}/reply`, { method: 'POST', body });
      setSending(false);
      const failure = !result.ok ? result.text : !result.value.ok ? failureText(result.value, 200) : undefined;
      if (failure !== undefined || !result.ok || !result.value.ok) {
        const error = failure ?? 'The server answered without a result.';
        updatePending(sessionId, messageId, { state: 'failed', error });
        return { ok: false, error };
      }
      retry.current = undefined;
      updatePending(sessionId, messageId, { state: result.value.deliveryUi === 'sending' ? 'sending' : result.value.deliveryUi });
      return { ok: true, response: result.value };
    },
    [sessionId],
  );

  return { send, sending };
}
