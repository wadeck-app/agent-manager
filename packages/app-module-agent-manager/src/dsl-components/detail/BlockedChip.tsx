import { ShieldAlert } from 'lucide-react';
import type { GuardrailBlocksDto } from '../shared.js';
import { recentChipLabel, recentChipRows, recentChipTooltip } from '../logic/guardrails.js';
import { chipClass } from '../ui/Chip.js';
import { FOCUS_RING, TipRows, Tooltip } from './deps.js';
import { requestRailTab } from './railRequest.js';
import { RowButton } from '../ui/RowButton.js';

/**
 * ONE small counter in the header of the open agent: "3 blocked" by a guardrail in the LAST 30 MINUTES, with the categories in its tooltip. Nothing when there is
 * no recent block (the full history is on the Guardrails page and in the Permissions tab). A click opens the Permissions tab of the panel beside the log.
 * The standard neutral chip of the module (the same skin as the state and the program chips of the line), as a button.
 */
export function BlockedChip({ sessionId, blocks }: { sessionId: string; blocks: GuardrailBlocksDto | undefined }) {
  const label = recentChipLabel(blocks);
  if (blocks === undefined || label === '') {
    return null;
  }
  return (
    <Tooltip side="bottom" content={<TipRows rows={recentChipRows(blocks)} note={recentChipTooltip(blocks)} />}>
      <RowButton type="button" data-blocked-chip="" aria-label={`${label} in the last 30 min. Open the Permissions tab`} onClick={() => requestRailTab(sessionId, 'permissions')} className={`${chipClass('warning')} cursor-pointer hover:brightness-95 ${FOCUS_RING}`}>
        <ShieldAlert aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
        {label}
      </RowButton>
    </Tooltip>
  );
}
