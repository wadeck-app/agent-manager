import { ShieldOff, TriangleAlert } from 'lucide-react';
import { Tooltip, useNow } from '../deps.js';
import type { BypassDto } from '../deps.js';
import { CHIP, CHIP_ICON, CHIP_WARNING } from './chipStyle.js';
import { clockTime } from './format.js';

/** The expiry of a bypass counted in time, as a clock time of today; a bypass counted in uses has none. */
function expiry(bypass: BypassDto, now: number): string {
  return bypass.leftMs === undefined ? `${bypass.left} left, counted in uses (no expiry time)` : `expires around ${clockTime(now + bypass.leftMs)} (${bypass.left} left)`;
}

/** The w-guardrails bypasses active for the session, as the status line shows them ("c&p 1h52m"), and a warning chip when the bypass file could not be read. */
export function BypassChips({ bypasses, error }: { bypasses: readonly BypassDto[] | undefined; error: string | undefined }) {
  const now = useNow(30_000);
  return (
    <>
      {(bypasses ?? []).map((bypass) => (
        <Tooltip key={bypass.category} content={`Bypass ${bypass.category}: a guardrail is switched off for this session; ${expiry(bypass, now)}.`}>
          <span tabIndex={0} aria-label={`Bypass ${bypass.label}, ${bypass.left} left`} className={CHIP}>
            <ShieldOff aria-hidden="true" className={CHIP_ICON} />
            <span aria-hidden="true">
              {bypass.label} <span className="tabular-nums">{bypass.left}</span>
            </span>
          </span>
        </Tooltip>
      ))}
      {error === undefined ? null : (
        <Tooltip content={error}>
          <span tabIndex={0} aria-label={`Bypass file problem: ${error}`} className={CHIP_WARNING}>
            <TriangleAlert aria-hidden="true" className={CHIP_ICON} />
            Bypass file unreadable
          </span>
        </Tooltip>
      )}
    </>
  );
}
