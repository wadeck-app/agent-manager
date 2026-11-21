import { ShieldAlert } from 'lucide-react';
import { blockedText } from '../logic/guardrails.js';
import type { GuardrailBlocksDto } from '../shared.js';
import { Tooltip } from '../ui/Tooltip.js';

/** The small "blocked by a guardrail" mark of a list row: a shield and the count, the sentence in the tooltip. Nothing for a session with no counters. */
export function GuardrailChip({ blocks }: { blocks: GuardrailBlocksDto | undefined }) {
  if (blocks === undefined) {
    return null;
  }
  const text = `${blockedText(blocks)}${blocks.timeout ? '. Bypass requests are timed out' : ''}`;
  return (
    <Tooltip content={text}>
      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-hue-orange-bg px-1.5 text-xs text-hue-orange">
        <ShieldAlert aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
        <span aria-label={text}>{blocks.total}</span>
      </span>
    </Tooltip>
  );
}
