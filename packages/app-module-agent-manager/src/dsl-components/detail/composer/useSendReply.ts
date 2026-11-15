import { useCallback, useRef, useState } from 'react';
import { addPending, getPending, removePending, rememberImages, updatePending } from '../pending.js';
import { newMessageId, postReply, type SendInput, type SendOutcome } from './postReply.js';

export type { SendInput, SendOutcome } from './postReply.js';

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
        updatePending(sessionId, messageId, { state: 'sending', error: undefined, priority: input.priority });
      } else {
        addPending({ messageId, sessionId, text: input.text, imageCount: input.images.length, sentAt: Date.now(), state: 'sending', priority: input.priority });
      }
      rememberImages(messageId, input.images);
      setSending(true);
      const outcome = await postReply(sessionId, messageId, input);
      setSending(false);
      if (!outcome.ok) {
        updatePending(sessionId, messageId, { state: 'failed', error: outcome.error });
        return outcome;
      }
      retry.current = undefined;
      updatePending(sessionId, messageId, { state: outcome.response.deliveryUi === 'sending' ? 'sending' : outcome.response.deliveryUi });
      return outcome;
    },
    [sessionId],
  );

  return { send, sending };
}
