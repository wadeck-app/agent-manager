import { KeyRound } from 'lucide-react';
import { useNow, type CliGrantDto } from '../deps.js';
import { fromCli } from './grantModel.js';
import { GrantRows } from './GrantRows.js';

const NOTE = 'text-xs text-muted';

/** The bypasses of this session from the admin CLI, with a one-second clock for the countdown (the list itself is read every 30 s). */
export function CliGrantList({ grants, cwdNote, busy, onRevoke }: { grants: readonly CliGrantDto[]; cwdNote: string; busy: boolean; onRevoke: (grant: CliGrantDto) => Promise<boolean> }) {
  const now = useNow(1000);
  return (
    <section aria-label="This session" className="border-b border-border">
      <h4 className="flex items-center gap-1.5 px-3 pt-2 text-xs font-medium text-content">
        <KeyRound aria-hidden="true" className="h-am-icon-sm w-am-icon-sm text-muted" />
        This session
        <span className="tabular-nums text-muted">{grants.length}</span>
      </h4>
      {cwdNote === '' ? null : <p className={`px-3 pt-1 break-words ${NOTE}`}>{cwdNote}</p>}
      {grants.length === 0 ? <p className={`px-3 py-2 ${NOTE}`}>No active bypass for this session.</p> : <GrantRows grants={grants.map(fromCli)} now={now} busy={busy} onRevoke={onRevoke} />}
    </section>
  );
}
