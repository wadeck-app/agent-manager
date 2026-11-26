import { Flag, Pin } from 'lucide-react';
import type { AgentRow } from '../data/types.js';
import { GuardrailChip } from '../guardrails/GuardrailChip.js';
import { HostBadge } from '../owned/OwnedChips.js';
import { OwnedStateChip } from '../owned/OwnedStateChip.js';

/**
 * Small markers of a row: the host and state of an owned session (nothing for a discovered one), pinned (the sub-agent count is not a mark: the chevron of the row, where the list shows sub-agents, says it). Icons with a text alternative, never
 * glyphs. `iconOnly` (the compact Tree density) shows the host and the state as icons: their words stay in the accessible name and the tooltip.
 */
export function RowMarks({ session, iconOnly = false }: { session: AgentRow; iconOnly?: boolean }) {
  return (
    <>
      <HostBadge session={session} iconOnly={iconOnly} />
      <OwnedStateChip session={session} compact iconOnly={iconOnly} />
      <GuardrailChip blocks={session.guardrailBlocks} />
      {session.flagged ? (
        <span className="inline-flex shrink-0 text-hue-orange">
          <Flag aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          <span className="sr-only">Flagged</span>
        </span>
      ) : null}
      {session.pinned ? (
        <span className="inline-flex shrink-0 text-muted-tint">
          <Pin aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          <span className="sr-only">Pinned</span>
        </span>
      ) : null}
    </>
  );
}
