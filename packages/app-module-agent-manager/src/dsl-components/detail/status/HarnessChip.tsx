import { Tooltip } from '../deps.js';
import { CHIP } from './chipStyle.js';
import { harnessChip } from './harness.js';

/** The program and its version in a few characters ("CCv2.1.325"); the full name is in the tooltip. */
export function HarnessChip({ harness }: { harness: string }) {
  const { short, full } = harnessChip(harness);
  return (
    <Tooltip content={`${full}, the program this session runs under.`}>
      <span tabIndex={0} aria-label={full} className={CHIP}>
        {short}
      </span>
    </Tooltip>
  );
}
