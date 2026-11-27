import { Tooltip } from '../deps.js';
import { detailRows, leftOf } from './grantModel.js';
import { GRANT_TITLE } from './GrantRowParts.js';
import { GrantShell } from './GrantShell.js';
import { useGrantRevoke, type GrantRowProps } from './GrantRowParts.js';

/** The one look of a bypass: a table line: category, time left, trash in fixed columns (so that the times line up); the reason, the uses and the session are in the tooltip of the line. */
export function TableRow(props: GrantRowProps) {
  const { grant } = props;
  const { icon, confirmBox } = useGrantRevoke(props);
  const left = leftOf(grant, props.now);
  const hasExtra = grant.usesText !== '' || grant.sessionLabel !== '';
  return (
    <GrantShell grant={grant} confirmBox={confirmBox} className="border-t border-border px-3 py-0.5 first:border-t-0">
      <div className="grid min-h-7 grid-cols-[minmax(0,1fr)_6.5rem_1.75rem] items-center gap-x-2">
        <Tooltip rows={detailRows(grant)} maxWidth="sm" className="flex min-w-0">
          <span tabIndex={0} data-grant-reason="" className={`${GRANT_TITLE} ${left.expired ? 'text-muted' : ''}`}>
            {grant.category}
          </span>
        </Tooltip>
        <span data-grant-left="" className={`truncate text-right text-xs tabular-nums ${left.soon ? 'text-warning-text' : 'text-muted'}`}>
          {left.text}
        </span>
        <span className="flex justify-end">{icon}</span>
      </div>
      {hasExtra ? (
        <p className="-mt-1 truncate pb-0.5 text-xs text-muted">
          {grant.usesText === '' ? null : <span data-grant-uses="">{grant.usesText}</span>}
          {grant.usesText !== '' && grant.sessionLabel !== '' ? ', ' : null}
          {grant.sessionLabel === '' ? null : <span data-grant-session="">{grant.sessionLabel}</span>}
        </p>
      ) : null}
    </GrantShell>
  );
}
