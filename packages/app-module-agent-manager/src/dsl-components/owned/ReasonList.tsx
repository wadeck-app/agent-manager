import { ButtonAction } from '@wadeck-app/dsl-ui';
import { useState } from 'react';
import { groupReasons, visibleReasonGroups } from '../logic/adoptSwitch.js';
import { prose } from '../logic/prose.js';

/** How many reasons are listed before "Show N more": the first ones are the ones to read, the rest is one click away. */
export const VISIBLE_REASONS = 3;

/**
 * The reasons a hand-over is not free, grouped by kind: a title with a count and one line saying what the hand-over does to that kind, then the details (at most
 * VISIBLE_REASONS in all until the user asks for the rest).
 */
export function ReasonList({ reasons }: { reasons: readonly string[] }) {
  const [all, setAll] = useState(false);
  // A group none of whose reasons is listed yet has no heading either (a title with nothing under it reads as broken); "Show N more" brings it.
  const groups = visibleReasonGroups(groupReasons(reasons), all ? Number.POSITIVE_INFINITY : VISIBLE_REASONS);
  const hidden = Math.max(0, reasons.length - VISIBLE_REASONS);
  return (
    <div data-reason-list="" className="flex flex-col gap-3">
      {groups.map(({ group, shown }) => (
        <section key={group.kind} aria-label={group.title} className="flex flex-col gap-0.5">
          <h3 className="text-sm font-semibold text-content">{`${group.title} (${group.reasons.length})`}</h3>
          <p className="text-xs text-muted">{group.consequence}</p>
          <ul className="mt-1 list-disc pl-5">
            {shown.map((reason) => (
              <li key={reason}>{prose(reason)}</li>
            ))}
          </ul>
        </section>
      ))}
      {hidden > 0 ? (
        <div className="self-start">
          <ButtonAction variant="link" underline="always" size="md" ariaExpanded={all} onClick={() => setAll(!all)} label={all ? 'Show fewer details' : `Show ${hidden} more`} />
        </div>
      ) : null}
    </div>
  );
}
