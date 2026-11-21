import { Bot, Pin } from 'lucide-react';
import type { AgentRow } from '../data/types.js';
import { GuardrailChip } from '../guardrails/GuardrailChip.js';
import { HostBadge } from '../owned/OwnedChips.js';
import { OwnedStateChip } from '../owned/OwnedStateChip.js';

/**
 * Small markers of a row: the host and state of an owned session (nothing for a discovered one), pinned, sub-agents. Icons with a text alternative, never
 * glyphs. `iconOnly` (the compact Tree density) shows the host and the state as icons: their words stay in the accessible name and the tooltip.
 */
export function RowMarks({ session, iconOnly = false }: { session: AgentRow; iconOnly?: boolean }) {
  return (
    <>
      <HostBadge session={session} iconOnly={iconOnly} />
      <OwnedStateChip session={session} compact iconOnly={iconOnly} />
      <GuardrailChip blocks={session.guardrailBlocks} />
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
