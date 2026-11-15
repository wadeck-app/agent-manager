import { Bot, Pin } from 'lucide-react';
import type { AgentRow } from '../data/types.js';

/** Small markers after the name: pinned, sub-agents. Icons with a text alternative, never glyphs. */
export function RowMarks({ session }: { session: AgentRow }) {
  return (
    <>
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
