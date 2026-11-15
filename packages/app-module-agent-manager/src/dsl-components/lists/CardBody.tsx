import type { AgentRow } from '../data/types.js';
import { Folder } from 'lucide-react';
import { RowMarks } from './RowMarks.js';
import { StateIconTip } from './StateIconTip.js';
import { StatusPill } from './StatusPill.js';
import { TimeInState } from './TimeInState.js';
import { detailLine } from './common.js';

export function CardBody({ session, now }: { session: AgentRow; now: number }) {
  const subtitle = session.lastActivity !== '' ? session.lastActivity : detailLine(session);
  return (
    <div className="flex flex-col gap-1.5 p-3">
      <div className="flex items-center gap-2">
        <StateIconTip session={session} />
        <span className="min-w-0 flex-1 truncate font-semibold text-content" title={session.displayName}>
          {session.displayName}
        </span>
        <RowMarks session={session} />
        <TimeInState session={session} now={now} />
      </div>
      {subtitle !== '' ? (
        <p className="line-clamp-2 break-words text-xs text-muted" title={subtitle}>
          {subtitle}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted" title={session.cwd}>
          <Folder aria-hidden="true" className="h-3 w-3 shrink-0" />
          <span className="truncate">{session.folder}</span>
        </span>
        <span className="ml-auto">
          <StatusPill session={session} />
        </span>
      </div>
    </div>
  );
}

/** The two letters of the rail monogram: the first two characters of the folder as written (no case change). */
export function monogram(folder: string): string {
  return Array.from(folder.replace(/^[^\p{L}\p{N}]+/u, '')).slice(0, 2).join('');
}
