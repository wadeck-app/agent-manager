import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { failureText, requestJson } from '../data/http.js';
import type { AgentRow } from '../data/types.js';
import { isLiveWeb } from '../logic/owned.js';
import type { OwnedDecisionResponse, OwnedPermissionDto } from '../shared.js';
import { Banner } from '../ui/Banner.js';
import { PermissionRequest } from './PermissionRequest.js';
import { usePermissions } from './usePermissions.js';

/** How long the answer of the last decision stays on screen. */
export const FEEDBACK_MS = 6000;

/**
 * The permission requests of a Web session (stream-json), above the reply box. The first one (the oldest) is answered in full; the others wait behind it as
 * one line each. Allow is once, Deny carries an optional reason. No key answers a request: both buttons need a click, and neither takes the focus by itself.
 * Renders nothing when no request waits and the daemon answered; a daemon that cannot be asked is said.
 */
export function PermissionCard({ session }: { session: AgentRow }) {
  const enabled = isLiveWeb(session);
  const fast = session.ownedState === 'requires_action' || session.pendingPermissions > 0;
  const { permissions, error: pollError, refresh } = usePermissions(session.sessionId, enabled, fast);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const [inFlight, setInFlight] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState('');
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    if (feedback === '') {
      return;
    }
    const timer = setTimeout(() => setFeedback(''), FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [feedback]);

  const waiting = permissions.filter((permission) => !answered.has(permission.requestId));
  const current = waiting[0];

  const decide = async (request: OwnedPermissionDto, decision: 'allow' | 'deny', message: string): Promise<void> => {
    setInFlight(request.requestId);
    setFailure('');
    setFeedback('');
    const text = message.trim();
    const body = decision === 'deny' && text !== '' ? { decision, message: text } : { decision };
    const result = await requestJson<OwnedDecisionResponse>(`/owned/${encodeURIComponent(session.sessionId)}/permissions/${encodeURIComponent(request.requestId)}`, { method: 'POST', body });
    setInFlight(undefined);
    const title = request.displayName ?? request.toolName;
    if (!result.ok || !result.value.ok) {
      // The request may be answered already (another page, the end of the session): the list is read again, so the card shows what is true now.
      setFailure(`The ${title} request was not ${decision === 'allow' ? 'allowed' : 'denied'}. ${result.ok ? failureText(result.value, 200) : result.text}`);
      refresh();
      return;
    }
    setAnswered((previous) => new Set(previous).add(request.requestId));
    setFeedback(decision === 'allow' ? `Allowed ${title} once. The agent continues.` : `Denied ${title}. The agent was told${text === '' ? ' it was denied' : `: ${text}`}.`);
    refresh();
  };

  if (!enabled) {
    return null;
  }
  if (current === undefined && pollError === '' && failure === '' && feedback === '') {
    return null;
  }
  return (
    <section aria-label="Permission requests" data-permission-card="" className="flex shrink-0 flex-col gap-1.5 border-t border-hue-red bg-hue-red-bg px-4 py-2">
      {pollError !== '' ? <Banner tone="error">{`The permission requests of this session could not be read, so a request may be waiting that you cannot see. ${pollError}`}</Banner> : null}
      {failure !== '' ? <Banner tone="error">{failure}</Banner> : null}
      {feedback !== '' ? (
        <p role="status" className="flex items-center gap-1.5 text-sm text-content">
          <Check aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-hue-green" />
          {feedback}
        </p>
      ) : null}
      {current !== undefined ? <PermissionRequest key={current.requestId} request={current} total={waiting.length} inFlight={inFlight !== undefined} onDecide={(request, decision, message) => void decide(request, decision, message)} /> : null}
      {waiting.length > 1 ? (
        <ul aria-label="Requests waiting behind this one" className="flex flex-col gap-0.5 text-sm text-muted-tint">
          {waiting.slice(1).map((request) => (
            <li key={request.requestId} data-permission-queued={request.requestId} className="truncate">
              {`Next: ${request.displayName ?? request.toolName}${request.description !== undefined && request.description !== '' ? `, ${request.description}` : ''}`}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
