import { ArrowDown, ArrowUp } from 'lucide-react';
import { Tooltip } from '../deps.js';
import { CHIP, CHIP_ICON } from './chipStyle.js';
import { formatTokens, groupDigits } from './format.js';

/** Tokens of the last API call as the status line shows them: the prompt size going up, the answer coming down. Either one alone is shown when only one is known. */
export function TokenCounts({ tokensIn, tokensOut }: { tokensIn: number | undefined; tokensOut: number | undefined }) {
  const parts = [tokensIn === undefined ? undefined : `${groupDigits(tokensIn)} tokens in the prompt of the last call`, tokensOut === undefined ? undefined : `${groupDigits(tokensOut)} tokens in its answer (grows while it streams)`].filter((part) => part !== undefined);
  return (
    <Tooltip content={`${parts.join('; ')}. Same numbers as the Claude Code status line (they are the last call, not running totals).`}>
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
