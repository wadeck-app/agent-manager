import { ButtonAction } from '@wadeck-app/dsl-ui';
import { KeyRound, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { clockText, GUARDRAILS_REVOKE_ENABLED, remainingText, type CliGrantDto } from '../deps.js';

/**
 * One bypass of the session as the plugin's admin CLI lists it. The time left counts down from the expiry (`now` ticks every second in the list), and
 * Revoke asks first: the confirmation names the category and the time left, then the caller sends the PIN-gated request.
 */
export function CliGrantItem({ grant, now, busy, onRevoke }: { grant: CliGrantDto; now: number; busy: boolean; onRevoke: (grant: CliGrantDto) => void }) {
  const [confirming, setConfirming] = useState(false);
  const left = Math.max(0, grant.expiresAt - now);
  const expired = left === 0;
  const uses = grant.usesLeft === null ? 'no use limit' : `${grant.usesLeft} use${grant.usesLeft === 1 ? '' : 's'} left`;
  return (
    <li data-cli-grant={grant.id} className="flex flex-col gap-1 border-t border-border px-3 py-2 first:border-t-0">
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1 text-xs">
          <p className="flex flex-wrap items-center gap-x-1.5">
            <span className="font-medium text-content">{grant.category}</span>
            <span className="text-muted">{grant.mode === 'once' ? 'once' : 'time-boxed'}</span>
            <span data-full-session="" title={`Matched on the full session id ${grant.sessionId}`} className="inline-flex items-center gap-0.5 text-muted">
              <KeyRound aria-hidden="true" className="h-3 w-3" />
              full id
            </span>
          </p>
          <p className="tabular-nums text-muted">
            <span title={`Expires at ${clockText(grant.expiresAt)}`}>{expired ? 'expired' : `${remainingText(left)} left`}</span>
            {`, ${uses}`}
          </p>
          <p className="break-words text-muted">{grant.reason === '' ? 'No reason given' : grant.reason}</p>
        </div>
        {GUARDRAILS_REVOKE_ENABLED && !confirming ? (
          <ButtonAction variant="secondary" size="sm" disabled={expired || busy} icon={<Trash2 aria-hidden="true" className="h-3.5 w-3.5" />} label={`Revoke the ${grant.category} bypass`} onClick={() => setConfirming(true)} />
        ) : null}
      </div>
      {confirming ? (
        <div className="flex flex-col gap-1.5 rounded border border-warning bg-warning-bg px-2 py-1.5 text-xs text-warning-text">
          <p>{`Revoke the ${grant.category} bypass (${remainingText(left)} left)? The guardrail applies again to this session at once.`}</p>
          <div className="flex gap-1.5">
            <ButtonAction
              variant="danger"
              size="sm"
              disabled={expired || busy}
              label="Confirm revoke"
              onClick={() => {
                setConfirming(false);
                onRevoke(grant);
              }}
            />
            <ButtonAction variant="secondary" size="sm" label="Cancel" onClick={() => setConfirming(false)} />
          </div>
        </div>
      ) : null}
    </li>
  );
}
