import { Tooltip } from '../deps.js';
import { CHIP } from './chipStyle.js';
import { formatSpan } from './format.js';

/** How long the session process has been running, since the start recorded in the registry. */
export function DurationChip({ durationMs }: { durationMs: number }) {
  const text = formatSpan(durationMs);
  return (
    <Tooltip content="Time since this session started, from the registry. After a resume the Claude Code status line can show a longer time (it restores the earlier clock).">
      <span tabIndex={0} aria-label={`Running for ${text}`} className={CHIP}>
        <span aria-hidden="true" className="tabular-nums">
          {text}
        </span>
      </span>
    </Tooltip>
  );
}
