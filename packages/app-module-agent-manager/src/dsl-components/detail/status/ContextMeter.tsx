import { Gauge } from 'lucide-react';
import { Tooltip } from '../deps.js';
import type { SessionStatusDto } from '../deps.js';
import { CHIP, CHIP_ICON } from './chipStyle.js';
import { contextTone, formatTokens } from './format.js';

/**
 * The share of the context window used: a small bar and the percentage, with "~" while it is an estimate (the window is not written in the transcript, so
 * the basis, the window and the note are in the tooltip). The colour follows the share (green, yellow from 70 %, red from 90 %); the number says the same.
 */
export function ContextMeter({ context }: { context: NonNullable<SessionStatusDto['contextUsedPct']> }) {
  const tone = contextTone(context.value);
  const estimate = context.basis === 'estimate';
  const shown = `${estimate ? '~' : ''}${context.value}%`;
  const tip = `${estimate ? 'Estimated ' : ''}context used: ${context.value}% of a ${formatTokens(context.windowTokens)} window (${tone.label}). ${context.note}`.trim();
  return (
    <Tooltip content={tip}>
      <span tabIndex={0} role="img" aria-label={`Context used ${shown}, ${tone.label}`} className={CHIP}>
        <Gauge aria-hidden="true" className={`${CHIP_ICON} ${tone.text}`} />
        <span aria-hidden="true" className="relative h-1.5 w-12 overflow-hidden rounded-full bg-border">
          <span className={`absolute inset-y-0 left-0 rounded-full ${tone.bar}`} style={{ width: `${Math.min(100, Math.max(0, context.value))}%` }} />
        </span>
        <span aria-hidden="true" className={`tabular-nums ${tone.text}`}>
          {shown}
        </span>
      </span>
    </Tooltip>
  );
}
