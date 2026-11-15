import { addPending, canRetry, dismissPending, getImages, rememberImages, updatePending, type PendingMessage } from '../pending.js';
import { newMessageId, postReply } from './postReply.js';

/**
 * Sends a failed or unconfirmed message again, as a NEW message (a new id: the first one may have reached the agent, the server will not treat the retry as its
 * duplicate and the person sees both outcomes). The same text, priority and images; the old bubble is dismissed (and stays dismissed after a reload). Refuses,
 * with a sentence, when the images of the message are no longer in memory (after a reload): sending the text without them would be a silent change.
 */
export async function retryPending(message: PendingMessage): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!canRetry(message)) {
    return { ok: false, error: 'The images of this message are no longer in memory (the page was reloaded): attach them again in the box and send a new message.' };
  }
  const images = message.imageCount > 0 ? (getImages(message.messageId) ?? []) : [];
  const priority = message.priority ?? 'next';
  const messageId = newMessageId();
  dismissPending(message.sessionId, message.messageId);
  addPending({ messageId, sessionId: message.sessionId, text: message.text, imageCount: message.imageCount, sentAt: Date.now(), state: 'sending', priority });
  rememberImages(messageId, images);
  const outcome = await postReply(message.sessionId, messageId, { text: message.text, images, priority });
  if (!outcome.ok) {
    updatePending(message.sessionId, messageId, { state: 'failed', error: outcome.error });
    return { ok: false, error: outcome.error };
  }
  updatePending(message.sessionId, messageId, { state: outcome.response.deliveryUi });
  return { ok: true };
}
