import { chipClass, clockText, Tooltip } from '../deps.js';
import { leftOf, type GrantRowData } from './grantModel.js';

/** The time left as a small chip (amber under 5 min, red when expired); the tooltip says when it expires. */
export function TimeChip({ grant, now }: { grant: GrantRowData; now: number }) {
  const left = leftOf(grant, now);
  const variant = left.expired ? 'danger' : left.soon ? 'warning' : 'neutral';
  return (
    <Tooltip content={`Expires at ${clockText(grant.expiresAt)}`}>
      <span data-grant-left="" className={`${chipClass(variant, 'xs')} tabular-nums`}>
        {left.text}
      </span>
    </Tooltip>
  );
}
