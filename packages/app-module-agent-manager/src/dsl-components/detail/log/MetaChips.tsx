import type { ChipTone, MetaChip } from './toolChips.js';

/** Colour carries one meaning each: lines added, lines removed, a failure, something to look at. Every other chip is the muted text colour. */
const TONE_CLASS: Record<ChipTone, string> = {
  add: 'text-hue-green',
  remove: 'text-hue-red',
  fail: 'text-hue-red',
  warn: 'text-warning-text',
};

/**
 * The compact facts of a tool call or of a group (see toolChips.ts): tabular numbers, one image per chip whose name is the sentence (the signs and the
 * abbreviations are for the eye, `aria-label` and the tooltip say it in words).
 */
export function MetaChips({ chips }: { chips: readonly MetaChip[] }) {
  if (chips.length === 0) {
    return null;
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-tint" data-meta-chips="">
      {chips.map((chip) => (
        <span key={chip.id} role="img" aria-label={chip.label} title={chip.label} data-chip={chip.id} className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-muted-bg px-1">
          {chip.parts.map((part, index) => (
            <span key={index} aria-hidden="true" className={part.tone === undefined ? undefined : TONE_CLASS[part.tone]}>
              {part.text}
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}
