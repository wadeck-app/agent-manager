import { Tooltip } from '@wadeck-app/dsl-ui';
import { ShieldAlert } from 'lucide-react';
import { recentBlockedText } from '../logic/guardrails.js';
import type { GuardrailBlocksDto } from '../shared.js';

const GUARDRAIL_CHIP = 'inline-flex shrink-0 items-center gap-0.5 rounded-full bg-hue-orange-bg px-1.5 text-xs text-hue-orange';

/**
 * The small "blocked by a guardrail" mark of a list row: a shield and the number of blocks of the LAST 30 MINUTES, the sentence (with the window) in the tooltip.
 * Nothing when there is none in that window, however many blocks the session had before: the full history is in the detail header and on the Guardrails page.
 */
export function GuardrailChip({ blocks }: { blocks: GuardrailBlocksDto | undefined }) {
  const sentence = blocks === undefined ? '' : recentBlockedText(blocks);
  if (blocks === undefined || sentence === '') {
    return null;
  }
  const text = `${sentence}${blocks.timeout ? '. Bypass requests are timed out' : ''}`;
  return (
    <Tooltip content={text}>
      <span className={GUARDRAIL_CHIP}>
        <ShieldAlert aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
        <span aria-label={text}>{blocks.recent.total}</span>
      </span>
    </Tooltip>
  );
}
