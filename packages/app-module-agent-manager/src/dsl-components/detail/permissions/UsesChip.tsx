import { chipClass } from '../deps.js';
import type { GrantRowData } from './grantModel.js';

/** The use limit as a small chip; nothing at all for a bypass without a limit. */
export function UsesChip({ grant }: { grant: GrantRowData }) {
  return grant.usesText === '' ? null : (
    <span data-grant-uses="" className={chipClass('info', 'xs')}>
      {grant.usesText}
    </span>
  );
}
