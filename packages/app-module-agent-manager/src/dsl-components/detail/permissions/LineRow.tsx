import { GRANT_SESSION, GRANT_TITLE } from './GrantRowParts.js';
import { ReasonText } from './ReasonText.js';
import { TimeChip } from './TimeChip.js';
import { UsesChip } from './UsesChip.js';
import { GrantShell } from './GrantShell.js';
import { useGrantRevoke, type GrantRowProps } from './GrantRowParts.js';

/** A. One line (chip, time left, trash) and the reason on one line under it: the densest look that still says why. */
export function LineRow(props: GrantRowProps) {
  const grant = props.group.grants[0]!;
  const { icon, confirmBox } = useGrantRevoke(props);
  return (
    <GrantShell group={props.group} confirmBox={confirmBox} className="flex flex-col gap-0.5 border-t border-border px-3 py-1.5 first:border-t-0">
      <div className="flex min-h-6 items-center gap-1.5">
        <span className={GRANT_TITLE}>{grant.category}</span>
        <TimeChip grant={grant} now={props.now} />
        <UsesChip grant={grant} />
        <span className="ml-auto shrink-0">{icon}</span>
      </div>
      <div className="flex min-w-0 items-baseline gap-1.5">
        {grant.sessionLabel === '' ? null : <span className={GRANT_SESSION}>{grant.sessionLabel}</span>}
        <ReasonText grant={grant} />
      </div>
    </GrantShell>
  );
}
