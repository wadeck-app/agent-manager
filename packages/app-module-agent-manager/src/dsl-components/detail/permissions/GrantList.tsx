import { KeyRound } from 'lucide-react';
import type { GrantDto } from '../deps.js';
import { GrantItem } from './GrantItem.js';

const NOTE = 'text-xs text-muted';

export function GrantList({ title, grants, empty, now, showSession }: { title: string; grants: readonly GrantDto[]; empty: string; now: number; showSession: boolean }) {
  return (
    <section aria-label={title} className="border-b border-border">
      <h4 className="flex items-center gap-1.5 px-3 pt-2 text-xs font-medium text-content">
        <KeyRound aria-hidden="true" className="h-am-icon-sm w-am-icon-sm text-muted" />
        {title}
        <span className="tabular-nums text-muted">{grants.length}</span>
      </h4>
      {grants.length === 0 ? (
        <p className={`px-3 py-2 ${NOTE}`}>{empty}</p>
      ) : (
        <ul>
          {grants.map((grant) => (
            <GrantItem key={`${grant.project}|${grant.id}`} grant={grant} now={now} showSession={showSession} />
          ))}
        </ul>
      )}
    </section>
  );
}

