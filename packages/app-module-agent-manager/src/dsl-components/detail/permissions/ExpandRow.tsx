import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { RowButton } from '../deps.js';
import { detailRows } from './grantModel.js';
import { GRANT_TITLE } from './GrantRowParts.js';
import { TimeChip } from './TimeChip.js';
import { GrantShell } from './GrantShell.js';
import { useGrantRevoke, type GrantRowProps } from './GrantRowParts.js';

/** D. A collapsed line (chevron, category, time left, trash) that opens on a click to show the reason in full, the uses, the session, the id and the expiry. */
export function ExpandRow(props: GrantRowProps) {
  const grant = props.group.grants[0]!;
  const [open, setOpen] = useState(false);
  const { icon, confirmBox } = useGrantRevoke(props);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <GrantShell group={props.group} confirmBox={confirmBox} className="border-t border-border px-3 py-0.5 first:border-t-0">
      <div className="flex min-h-7 items-center gap-1">
        <RowButton aria-expanded={open} aria-label={`${grant.category} bypass details`} onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 items-center gap-1.5 rounded py-0.5 text-left">
          <Chevron aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted" />
          <span className={GRANT_TITLE}>{grant.category}</span>
          <TimeChip grant={grant} now={props.now} />
        </RowButton>
        <span className="shrink-0">{icon}</span>
      </div>
      {open ? (
        <dl data-grant-details="" className="ml-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 pb-1 text-xs">
          {detailRows(grant).map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-muted">{row.label}</dt>
              <dd className="break-words text-content">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </GrantShell>
  );
}
