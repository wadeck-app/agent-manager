import { GRANT_TITLE, ruleOf } from './GrantRowParts.js';
import { ReasonText } from './ReasonText.js';
import { TimeChip } from './TimeChip.js';
import { UsesChip } from './UsesChip.js';
import { GrantShell } from './GrantShell.js';
import { useGrantRevoke, type GrantRowProps } from './GrantRowParts.js';

/** B. A card with a coloured rule on its left (one colour per category), the title and the trash on the first line, the reason on up to two lines. */
export function CardRow(props: GrantRowProps) {
  const grant = props.group.grants[0]!;
  const { icon, confirmBox } = useGrantRevoke(props);
  return (
    <GrantShell group={props.group} confirmBox={confirmBox} className={`mx-3 my-1.5 flex flex-col gap-1 rounded border border-l-4 border-border bg-surface px-2 py-1.5 ${ruleOf(grant.category)}`}>
      <div className="flex min-h-6 items-center gap-1.5">
        <span className={GRANT_TITLE}>{grant.category}</span>
        <TimeChip grant={grant} now={props.now} />
        <UsesChip grant={grant} />
        <span className="ml-auto shrink-0">{icon}</span>
      </div>
      {grant.sessionLabel === '' ? null : <p className="truncate text-xs text-muted">{`Session ${grant.sessionLabel}`}</p>}
      <div className="flex min-w-0">
        <ReasonText grant={grant} lines={2} />
      </div>
    </GrantShell>
  );
}
