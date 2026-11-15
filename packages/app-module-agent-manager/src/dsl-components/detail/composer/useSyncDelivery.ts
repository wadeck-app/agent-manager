import { useEffect } from 'react';
import type { ReplyMessageDto } from '../deps.js';
import { getPending, syncDelivery, updatePending } from '../pending.js';

/**
 * The server knows the real state of a message (the agent took it, or it failed): the local copy shown in the log follows it. The audited messages are also
 * handed to the log (their priority and state by id), and the ones a reload lost come back as pending (see syncDelivery in pending.ts).
 */
export function useSyncDelivery(sessionId: string, messages: readonly ReplyMessageDto[] | undefined): void {
  useEffect(() => {
    if (messages === undefined) {
      return;
    }
    for (const message of messages) {
      const local = getPending(sessionId).find((entry) => entry.messageId === message.messageId);
      if (local !== undefined && local.state !== 'failed' && local.state !== message.ui) {
        updatePending(sessionId, message.messageId, { state: message.ui, error: message.ui === 'failed' ? message.reason : undefined });
      }
    }
    syncDelivery(sessionId, messages, Date.now());
  }, [messages, sessionId]);
}
