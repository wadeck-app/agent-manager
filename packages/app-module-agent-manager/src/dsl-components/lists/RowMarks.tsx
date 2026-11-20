import { Bot, Pin } from 'lucide-react';
import type { AgentRow } from '../data/types.js';
import { HostBadge } from '../owned/OwnedChips.js';
import { OwnedStateChip } from '../owned/OwnedStateChip.js';

/** Small markers after the name: the host and state of an owned session (nothing for a discovered one), pinned, sub-agents. Icons with a text alternative, never glyphs. */
export function RowMarks({ session }: { session: AgentRow }) {
  return (
    <>
      <HostBadge session={session} />
      <OwnedStateChip session={session} compact />
      {session.pinned ? (
        <span className="inline-flex shrink-0 text-muted">
          <Pin aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          <span className="sr-only">Pinned</span>
        </span>
      ) : null}
      {session.subagentCount > 0 ? (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted">
          <Bot aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          <span aria-label={`${session.subagentCount} sub-agents`}>{session.subagentCount}</span>
        </span>
      ) : null}
    </>
  );
}
