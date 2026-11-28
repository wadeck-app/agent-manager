import { IconButton, Tooltip } from '@wadeck-app/dsl-ui';
import { ListChecks } from 'lucide-react';
import { useSelection } from '../lists/selection.js';
import { SelectAllBox } from './SelectAllBox.js';

const MODE_NAME = 'Selection mode';

// The room of the Select all button (its wider label, "Select none", fits), kept free at every width while the mode is off, so that turning the mode on moves nothing.
const SELECT_ALL_SLOT = 'inline-flex min-w-[calc(var(--am-fs-xs)*9.5)]';

/**
 * The entry point of the selection mode: ONE icon toggle (a list with checks) right after the "Agents" title, where the pointer already is when the user looks at
 * the list. It never moves and never changes meaning: pressed (the primary fill) while the mode is on, and a second click leaves the mode and clears the selection.
 * The "Select all" button appears to its right, in a slot that is reserved while the mode is off, so nothing else in the toolbar shifts. The toggle, the Escape key
 * and the clear button are the ways out.
 */
export function SelectionEntry({ ids, reserveSlot = true }: { ids: readonly string[]; /** False on a narrow screen: the room is not worth reserving, the button takes it when the mode is on. */ reserveSlot?: boolean }) {
  const selection = useSelection();
  if (selection === null) {
    return null;
  }
  const on = selection.mode;
  return (
    <span className="inline-flex items-center gap-2">
      <Tooltip content={on ? 'Leave the selection mode (Escape)' : 'Select several agents'}>
        <span data-selection-entry="icon" className="inline-flex">
          <IconButton size="icon-sm" variant={on ? 'primary' : 'ghost'} aria-label={MODE_NAME} aria-pressed={on} onClick={() => selection.setMode(!on)} icon={<ListChecks aria-hidden="true" className="h-4 w-4" />} />
        </span>
      </Tooltip>
      <span data-select-all-slot="" className={reserveSlot ? SELECT_ALL_SLOT : 'inline-flex empty:hidden'}>
        {on ? <SelectAllBox ids={ids} /> : null}
      </span>
    </span>
  );
}
