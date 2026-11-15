import { RotateCw, X } from 'lucide-react';
import { useState } from 'react';
import { retryPending } from '../composer/retryPending.js';
import { FOCUS_RING, Tooltip } from '../deps.js';
import { canRetry, dismissPending, type PendingMessage } from '../pending.js';

const BUTTON = `inline-flex items-center rounded p-0.5 text-muted hover:bg-muted-bg hover:text-content disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`;

/**
 * What can be done with a message that failed or was never confirmed: send it again as a NEW message (same text, priority and images) or dismiss it (it is then
 * forgotten for good, also after a reload). Retry is offered only when everything needed to send it as it was is still known.
 */
export function PendingActions({ message }: { message: PendingMessage }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const retry = canRetry(message);
  const send = async (): Promise<void> => {
    setBusy(true);
    setProblem('');
    const outcome = await retryPending(message);
    setBusy(false);
    if (!outcome.ok) {
      setProblem(outcome.error);
    }
  };
  return (
    <span className="flex items-center gap-0.5">
      {retry ? (
        <Tooltip content="Send it again as a new message (same text, priority and images)">
          <button type="button" aria-label="Send again as a new message" disabled={busy} onClick={() => void send()} className={BUTTON}>
            <RotateCw aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          </button>
        </Tooltip>
      ) : null}
      <Tooltip content="Dismiss this message: it is forgotten here, nothing is sent">
        <button type="button" aria-label="Dismiss this message" onClick={() => dismissPending(message.sessionId, message.messageId)} className={BUTTON}>
          <X aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
        </button>
      </Tooltip>
      {problem !== '' ? <span role="alert" className="sr-only">{problem}</span> : null}
    </span>
  );
}
