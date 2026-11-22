import { clockText, remainingText, type GrantDto } from '../deps.js';
import { DisabledWrite } from './DisabledWrite.js';

export function GrantItem({ grant, now, showSession }: { grant: GrantDto; now: number; showSession: boolean }) {
  const left = Math.max(0, grant.expiresAt - now);
  const uses = grant.maxUses === null ? `${grant.used} use${grant.used === 1 ? '' : 's'}, no limit` : `${grant.used} of ${grant.maxUses} uses`;
  return (
    <li data-grant={grant.id} className="flex items-start gap-1 border-t border-border px-3 py-2 first:border-t-0">
      <div className="min-w-0 flex-1 text-xs">
        <p className="flex flex-wrap items-center gap-x-1.5">
          <span className="font-medium text-content">{grant.category}</span>
          <span className="text-muted">{grant.mode === 'once' ? 'once' : 'time-boxed'}</span>
        </p>
        <p className="tabular-nums text-muted">
          <span title={`Expires at ${clockText(grant.expiresAt)}`}>{remainingText(left)} left</span>
          {`, ${uses}`}
        </p>
        {showSession ? <p className="truncate text-muted">{`Session ${grant.sessionName === '' ? grant.sessionId.slice(0, 8) : grant.sessionName}`}</p> : null}
        <p className="break-words text-muted">{grant.rationale === '' ? 'No reason given' : grant.rationale}</p>
      </div>
      <DisabledWrite label={`Revoke the ${grant.category} bypass`} icon="revoke" iconOnly />
    </li>
  );
}

