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
  // Labelled rows (the card of a tooltip is read by looking for one figure): tokens used, the point, the window and how each of them was assumed.
  const rows = [
    { label: 'In the context', value: `${formatTokens(context.usedTokens)} tokens` },
    { label: 'Auto-compact at', value: `about ${formatTokens(context.compactAtTokens)} (${context.value}%, ${tone.label})` },
    { label: 'Window', value: formatTokens(context.windowTokens) },
    { label: 'Window assumed', value: sentence(context.note), clamp: 3 as const },
    { label: 'Point assumed', value: '33k tokens below the window, not read from Claude Code. /autocompact or CLAUDE_CODE_AUTO_COMPACT_WINDOW can set a smaller window: it then comes sooner.', clamp: 4 as const },
  ];
  return (
    <Tooltip rows={rows} maxWidth="md">
      <span tabIndex={0} role="img" aria-label={`Context ${context.value}% of the way to auto-compact, ${tone.label}`} className={CHIP}>
        <span aria-hidden="true" className={`tabular-nums ${tone.text}`}>
          {context.value}%
        </span>
      </span>
    </Tooltip>
  );
}

/** A note of the server as a sentence: it starts with a capital and ends with a full stop. */
function sentence(note: string): string {
  const text = note.trim();
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`;
}
