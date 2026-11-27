import { FOCUS_RING, Tooltip } from '../deps.js';
import { detailRows, NO_REASON, type GrantRowData } from './grantModel.js';

/** The reason on one line (or two), the full text and the details of the bypass in a tooltip; focusable so that the keyboard reaches the tooltip too. */
export function ReasonText({ grant, lines = 1 }: { grant: GrantRowData; lines?: 1 | 2 }) {
  return (
    <Tooltip rows={detailRows(grant)} maxWidth="sm" className="flex min-w-0 flex-1">
      <span tabIndex={0} data-grant-reason="" className={`min-w-0 break-words text-xs text-muted ${FOCUS_RING} ${lines === 1 ? 'truncate' : 'line-clamp-2'}`}>
        {grant.reason === '' ? NO_REASON : grant.reason}
      </span>
    </Tooltip>
  );
}
