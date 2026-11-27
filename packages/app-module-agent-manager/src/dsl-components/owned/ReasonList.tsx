import { useState } from 'react';
import { groupReasons } from '../logic/adoptSwitch.js';
import { FOCUS_RING } from '../ui/focusRing.js';
import { RowButton } from '../ui/RowButton.js';

/** How many reasons are listed before "Show N more": the first ones are the ones to read, the rest is one click away. */
export const VISIBLE_REASONS = 3;

/**
 * The reasons a move is not free, grouped by kind: a title with a count and one line saying what the move does to that kind, then the details (at most
 * VISIBLE_REASONS in all until the user asks for the rest).
 */
export function ReasonList({ reasons }: { reasons: readonly string[] }) {
  const [all, setAll] = useState(false);
  const groups = groupReasons(reasons);
  let budget = all ? Number.POSITIVE_INFINITY : VISIBLE_REASONS;
  const hidden = Math.max(0, reasons.length - VISIBLE_REASONS);
  return (
    <div data-reason-list="" className="flex flex-col gap-3">
      {groups.map((group) => {
        const shown = group.reasons.slice(0, Math.max(0, budget));
        budget -= shown.length;
        return (
          <section key={group.kind} aria-label={group.title} className="flex flex-col gap-0.5">
            <h3 className="text-sm font-semibold text-content">{`${group.title} (${group.reasons.length})`}</h3>
            <p className="text-xs text-muted">{group.consequence}</p>
            {shown.length > 0 ? (
              <ul className="mt-1 list-disc pl-5">
                {shown.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
      {hidden > 0 ? (
        <RowButton type="button" aria-expanded={all} onClick={() => setAll(!all)} className={`self-start rounded text-sm text-primary underline hover:no-underline ${FOCUS_RING}`}>
          {all ? 'Show fewer details' : `Show ${hidden} more`}
        </RowButton>
      ) : null}
    </div>
  );
}
