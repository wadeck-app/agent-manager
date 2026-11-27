import { Tooltip } from '@wadeck-app/dsl-ui';
import { ShieldAlert } from 'lucide-react';
import { recentBlockedText } from '../logic/guardrails.js';
import type { GuardrailBlocksDto } from '../shared.js';

/** The same warning tone as the "N blocked" chip of the detail header (chipClass('warning')), so the list and the header say the same thing in the same colour. */
const GUARDRAIL_MARK = 'inline-flex shrink-0 text-warning-text';

/**
 * The small "blocked by a guardrail" mark of a list row: the shield alone (no count: a number beside it would take room from the name; the count and the window
 * are the tooltip, the accessible name and the chip of the detail header). It exists only when something was blocked in the LAST 30 MINUTES, however many blocks
 * the session had before: the full history is in the detail header and on the Guardrails page.
 */
export function GuardrailChip({ blocks }: { blocks: GuardrailBlocksDto | undefined }) {
  const sentence = blocks === undefined ? '' : recentBlockedText(blocks);
  if (blocks === undefined || sentence === '') {
    return null;
  }
  const text = `${sentence}${blocks.timeout ? '. Bypass requests are timed out' : ''}`;
  return (
    <Tooltip content={text}>
      <span role="img" aria-label={text} className={GUARDRAIL_MARK}>
        <ShieldAlert aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
      </span>
    </Tooltip>
  );
}
