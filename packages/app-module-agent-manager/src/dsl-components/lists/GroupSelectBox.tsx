import { StyledCheckbox } from '../ui/StyledCheckbox.js';
import { groupCheck } from '../logic/selection.js';
import { useSelection } from './selection.js';

/**
 * The select-all box of a group header (a folder, a custom group): in the selection mode only, as the FIRST item of the header (the same x as the boxes of the
 * rows). Checked when every member is selected, indeterminate when some are. Nothing is drawn, and no room is kept, outside the mode.
 */
export function GroupSelectBox({ ids, name, className = '' }: { ids: readonly string[]; name: string; className?: string }) {
  const selection = useSelection();
  if (selection === null || !selection.mode) {
    return null;
  }
  const state = groupCheck(ids, selection.selected);
  return (
    <span data-group-checkbox="" className={`inline-flex h-7 shrink-0 items-center ${className}`} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <StyledCheckbox
        indeterminate={state === 'some'}
        tabIndex={-1}
        disabled={ids.length === 0}
        aria-label={`Select all ${ids.length === 1 ? '1 session' : `${ids.length} sessions`} of ${name}`}
        checked={state === 'all'}
        onChange={() => selection.setMany(ids, state !== 'all')}
      />
    </span>
  );
}
