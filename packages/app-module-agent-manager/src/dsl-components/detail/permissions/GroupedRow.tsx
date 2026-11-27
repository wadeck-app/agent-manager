import { chipClass } from '../deps.js';
import { categoriesText, GRANT_SESSION } from './GrantRowParts.js';
import { ReasonText } from './ReasonText.js';
import { TimeChip } from './TimeChip.js';
import { UsesChip } from './UsesChip.js';
import { GrantShell } from './GrantShell.js';
import { useGrantRevoke, type GrantRowProps } from './GrantRowParts.js';

/** E. Bypasses that share session, reason and expiry minute (a git-commit and a git-push asked together) are one row with one chip each and ONE revoke for all of them. */
export function GroupedRow(props: GrantRowProps) {
  const grants = props.group.grants;
  const first = grants[0]!;
  const { icon, confirmBox } = useGrantRevoke(props);
  return (
    <GrantShell group={props.group} confirmBox={confirmBox} className="flex flex-col gap-1 border-t border-border px-3 py-1.5 first:border-t-0">
      <div className="flex items-start gap-1.5">
        <ul aria-label={categoriesText(grants)} className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-0.5">
          {grants.map((grant) => (
            <li key={grant.id} className="min-w-0">
              <span data-grant-category="" className={`${chipClass('info', 'xs')} font-medium`}>
                <span className="truncate">{grant.category}</span>
              </span>
            </li>
          ))}
        </ul>
        <span className="shrink-0">{icon}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <TimeChip grant={first} now={props.now} />
        {grants.map((grant) => (
          <UsesChip key={grant.id} grant={grant} />
        ))}
        {first.sessionLabel === '' ? null : <span className={GRANT_SESSION}>{first.sessionLabel}</span>}
      </div>
      <div className="flex min-w-0">
        <ReasonText grant={first} />
      </div>
    </GrantShell>
  );
}
