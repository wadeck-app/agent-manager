import { ArrowDown, ArrowUp } from 'lucide-react';
import { TipRows, Tooltip } from '../deps.js';
import type { SessionCostDto } from '../deps.js';
import { CHIP, CHIP_ICON } from './chipStyle.js';
import { costEstimateNote, sessionCostLines } from './costText.js';
import { formatTokens, groupDigits } from './format.js';

/**
 * Tokens of the last API call as the status line shows them: the prompt size going up, the answer coming down. Either one alone is shown when only one is known.
 * The tooltip also carries the estimated cost of the session as rows (main session, sub-agents, total) and says it is an estimate from a dated price table.
 */
export function TokenCounts({ tokensIn, tokensOut, cost }: { tokensIn: number | undefined; tokensOut: number | undefined; cost?: SessionCostDto | undefined }) {
  const parts = [tokensIn === undefined ? undefined : `${groupDigits(tokensIn)} tokens in the prompt of the last call`, tokensOut === undefined ? undefined : `${groupDigits(tokensOut)} tokens in its answer (grows while it streams)`].filter((part) => part !== undefined);
  const rows =
    cost === undefined
      ? undefined
      : sessionCostLines(cost).map((line) => ({
          label: line.label,
          value: (
            <span data-cost-line="" className={`font-medium tabular-nums ${line.missing ? 'text-white/70' : ''}`}>
              {line.value}
            </span>
          ),
        }));
  const note = cost === undefined ? '' : ` ${costEstimateNote(cost.total)} Cost covers every message of the session and of its sub-agents, not only the last call.`;
  return (
    <Tooltip content={<TipRows rows={rows ?? []} note={`${parts.join('; ')}. Same numbers as the Claude Code status line (they are the last call, not running totals).${note}`} />}>
      <span tabIndex={0} aria-label={`Tokens: ${parts.join(', ')}`} className={CHIP}>
        {tokensIn === undefined ? null : (
          <span aria-hidden="true" className="inline-flex items-center gap-0.5 tabular-nums">
            <ArrowUp className={CHIP_ICON} />
            {formatTokens(tokensIn)}
          </span>
        )}
        {tokensOut === undefined ? null : (
          <span aria-hidden="true" className="inline-flex items-center gap-0.5 tabular-nums">
            <ArrowDown className={CHIP_ICON} />
            {formatTokens(tokensOut)}
          </span>
        )}
      </span>
    </Tooltip>
  );
}
