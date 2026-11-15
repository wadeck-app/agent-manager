import { failureText, requestJson } from '../deps.js';
import type { ReplyOk, ReplyRequest, ReplyResponse } from '../deps.js';
import type { AttachedImage } from './types.js';

export interface SendInput {
  text: string;
  images: readonly AttachedImage[];
  priority: 'next' | 'now';
}

export type SendOutcome = { ok: true; response: ReplyOk } | { ok: false; error: string };

export function newMessageId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * POST /sessions/:id/reply for one message id. Choosing priority 'now' was the person's explicit confirmation (the chip says what is lost), so the request
 * carries confirmNow: true, which the server still requires. No store is touched here: the callers (a send, a retry) own the pending message.
 */
export async function postReply(sessionId: string, messageId: string, input: SendInput): Promise<SendOutcome> {
  const body: ReplyRequest = {
    text: input.text,
    messageId,
    priority: input.priority,
    ...(input.priority === 'now' ? { confirmNow: true } : {}),
    ...(input.images.length > 0 ? { images: input.images.map(({ name, mime, dataBase64 }) => ({ name, mime, dataBase64 })) } : {}),
  };
  const result = await requestJson<ReplyResponse>(`/sessions/${encodeURIComponent(sessionId)}/reply`, { method: 'POST', body });
  const failure = !result.ok ? result.text : !result.value.ok ? failureText(result.value, 200) : undefined;
  if (failure !== undefined || !result.ok || !result.value.ok) {
    return { ok: false, error: failure ?? 'The server answered without a result.' };
  }
  return { ok: true, response: result.value };
}
