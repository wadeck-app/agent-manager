import { ButtonAction, Tooltip } from '@wadeck-app/dsl-ui';
import { ListChecks, ListX } from 'lucide-react';
import { useSelection } from '../lists/selection.js';
import { groupCheck } from '../logic/selection.js';

/**
 * Select all, in the toolbar, in the selection mode only: a labelled button, never a second checkbox next to the mode toggle (two boxes side by side read as
 * one control). It ticks every session the current list shows (a folded group included); when they are all ticked it says "Select none" and clears them. The
 * count of the selection is said by the batch popup.
 */
export function SelectAllBox({ ids }: { ids: readonly string[] }) {
  const selection = useSelection();
  if (selection === null || !selection.mode || ids.length === 0) {
    return null;
  }
  const all = groupCheck(ids, selection.selected) === 'all';
  return (
    <Tooltip content={all ? `Unselect the ${ids.length} listed sessions` : `Select the ${ids.length} listed sessions`}>
      <span data-select-all="" className="inline-flex">
        <ButtonAction
        variant="secondary"
        size="sm"
        icon={all ? <ListX aria-hidden="true" className="h-3.5 w-3.5" /> : <ListChecks aria-hidden="true" className="h-3.5 w-3.5" />}
        label={all ? 'Select none' : 'Select all'}
        onClick={() => selection.setMany(ids, !all)}
      />
      </span>
    </Tooltip>
  );
}
