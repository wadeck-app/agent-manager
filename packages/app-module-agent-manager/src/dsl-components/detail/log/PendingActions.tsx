import { RotateCw, X } from 'lucide-react';
import { useState } from 'react';
import { retryPending } from '../composer/retryPending.js';
import { TipIconButton } from '../deps.js';
import { canRetry, dismissPending, type PendingMessage } from '../pending.js';


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
<TipIconButton size="icon-sm" aria-label="Send again as a new message" tip="Send it again as a new message (same text, priority and images)" disabled={busy} onClick={() => void send()} icon={<RotateCw aria-hidden="true" className="h-3.5 w-3.5" />} />
      ) : null}
<TipIconButton size="icon-sm" aria-label="Dismiss this message" tip="Dismiss this message: it is forgotten here, nothing is sent" onClick={() => dismissPending(message.sessionId, message.messageId)} icon={<X aria-hidden="true" className="h-3.5 w-3.5" />} />
      {problem !== '' ? <span role="alert" className="sr-only">{problem}</span> : null}
    </span>
  );
}
