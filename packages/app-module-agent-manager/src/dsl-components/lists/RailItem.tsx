import type { AgentRow } from '../data/types.js';
import { monogram } from '../logic/monogram.js';
import { StatusIcon } from '../ui/StatusIcon.js';
import { TimeInState } from './TimeInState.js';
import { detailLine } from './common.js';

export function RailItem({ session, now }: { session: AgentRow; now: number }) {
  const subtitle = session.lastActivity !== '' ? session.lastActivity : detailLine(session);
  return (
    <div className="flex items-center gap-3">
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted-bg text-sm font-semibold text-content">
        {monogram(session.folder)}
        <span className="absolute -right-1 -top-1 rounded-full bg-surface">
          <StatusIcon state={session.state} sizeClass="h-3.5 w-3.5" labelled={false} />
        </span>
      </span>
      <span className="hidden min-w-0 flex-1 group-hover/rail:block group-focus-within/rail:block">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-semibold text-content">{session.displayName}</span>
          <TimeInState session={session} now={now} />
        </span>
        <span className="block truncate text-xs text-muted">{subtitle !== '' ? subtitle : session.folder}</span>
      </span>
    </div>
  );
}
