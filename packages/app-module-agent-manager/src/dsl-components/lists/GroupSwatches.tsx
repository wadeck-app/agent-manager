import { Tooltip } from '@wadeck-app/dsl-ui';
import { Check } from 'lucide-react';
import { GROUP_COLORS, type GroupColor } from '../shared.js';
import { GROUP_LOOK } from '../ui/groupLook.js';
import { RowButton } from '../ui/RowButton.js';

/** A row of color choices (a radio group) with a "no color" first. */
export function GroupSwatches({ label, value, onPick }: { label: string; value: GroupColor | null; onPick: (color: GroupColor | null) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span id={`swatches-${label.replace(/ /g, '-')}`} className="text-xs font-medium text-muted">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={`swatches-${label.replace(/ /g, '-')}`} className="flex flex-wrap gap-1">
        {([null, ...GROUP_COLORS] as (GroupColor | null)[]).map((option) => {
          const look = GROUP_LOOK[option ?? 'none'];
          const selected = option === value;
          return (
          <Tooltip key={option ?? 'none'} content={look.label} describe={false}>
            <RowButton type="button" role="radio" aria-checked={selected} aria-label={look.label} onClick={() => onPick(option)} className={`inline-flex h-6 w-6 items-center justify-center rounded border ${selected ? 'border-primary ring-1 ring-primary' : 'border-border hover:bg-muted-bg'}`}>
              <span aria-hidden="true" className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-full ${look.dot}`}>
                {selected ? <Check aria-hidden="true" className="h-2.5 w-2.5 text-surface" /> : null}
              </span>
            </RowButton>
          </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
