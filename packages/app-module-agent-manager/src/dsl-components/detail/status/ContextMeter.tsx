import { Tooltip } from '../deps.js';
import type { SessionStatusDto } from '../deps.js';
import { CHIP } from './chipStyle.js';
import { contextTone, formatTokens } from './format.js';

/**
 * How close the session is to its AUTO-COMPACT, as a bare percentage (no icon, no bar, no "~"): the context size over the point where Claude Code compacts,
 * not over the window. The colour follows the share (green, yellow from 70 %, red from 90 %). The tooltip gives the tokens used, the auto-compact point and
 * the window, and says the point is assumed (window minus 33k): it is not written in the transcript, and /autocompact or CLAUDE_CODE_AUTO_COMPACT_WINDOW
 * can lower it.
 */
export function ContextMeter({ context }: { context: NonNullable<SessionStatusDto['contextUsedPct']> }) {
  const tone = contextTone(context.value);
  const tip =
    `${formatTokens(context.usedTokens)} tokens in the context, auto-compact at about ${formatTokens(context.compactAtTokens)} (${context.value}%, ${tone.label}). ` +
    `Window ${formatTokens(context.windowTokens)}; ${context.note}. Auto-compact is assumed 33k tokens below the window, not read from Claude Code: ` +
    'a smaller window set with /autocompact or CLAUDE_CODE_AUTO_COMPACT_WINDOW makes it come sooner.';
  return (
    <Tooltip content={tip}>
      <span tabIndex={0} role="img" aria-label={`Context ${context.value}% of the way to auto-compact, ${tone.label}`} className={CHIP}>
        <span aria-hidden="true" className={`tabular-nums ${tone.text}`}>
          {context.value}%
        </span>
      </span>
    </Tooltip>
  );
}
