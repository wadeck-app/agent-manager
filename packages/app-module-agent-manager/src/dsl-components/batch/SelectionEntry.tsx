import { ButtonAction, IconButton, Tooltip } from '@wadeck-app/dsl-ui';
import { ListChecks, X } from 'lucide-react';
import { useSelection } from '../lists/selection.js';
import { StyledCheckbox } from '../ui/StyledCheckbox.js';
import { useUiVariant } from '../ui/UiVariants.js';
import { SelectAllBox } from './SelectAllBox.js';

/** Where in the toolbar the entry is drawn: right after the title, or among the actions (before New session). */
export type SelectionEntrySlot = 'title' | 'actions';

const MODE_NAME = 'Selection mode';

/**
 * The entry point of the selection mode (the A/B question `ui-selection-entry`): a toggle in the toolbar that shows or hides the checkboxes of the rows and of
 * the group headers. Turning it off clears the selection. While the mode is on, a labelled "Select all" button appears right after the toggle (never a second checkbox). The three variants differ by
 * place and look, not by behavior: A a labelled checkbox toggle by the title, B a "Select" button with icon and label, C an icon-only toggle with a tooltip.
 */
export function SelectionEntry({ slot, ids }: { slot: SelectionEntrySlot; ids: readonly string[] }) {
  const selection = useSelection();
  const variant = useUiVariant('selectionEntry');
  if (selection === null) {
    return null;
  }
  const on = selection.mode;
  const toggle = (): void => selection.setMode(!on);
  const where = variant === 'checkbox' ? 'title' : 'actions';
  if (where !== slot) {
    return null;
  }
  let control;
  if (variant === 'checkbox') {
    control = (
      <Tooltip content={on ? 'Leave the selection mode (Escape)' : 'Select several agents'}>
        {/* A labelled toggle: the box AND the word "Select" in one bordered control, which is tinted and pressed while the mode is on (a bare box next to the "Select all" button read as two boxes). */}
        <label data-selection-entry="checkbox" className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded border px-2 text-sm ${on ? 'border-primary bg-primary-light text-content' : 'border-border text-muted hover:bg-muted-bg'}`}>
          <StyledCheckbox aria-label={MODE_NAME} checked={on} onChange={toggle} />
          <span aria-hidden="true">Select</span>
        </label>
      </Tooltip>
    );
  } else if (variant === 'button') {
    control = (
      <span data-selection-entry="button" className="inline-flex">
        <ButtonAction variant={on ? 'primary' : 'secondary'} size="sm" icon={on ? <X aria-hidden="true" className="h-3.5 w-3.5" /> : <ListChecks aria-hidden="true" className="h-3.5 w-3.5" />} label={on ? 'Cancel' : 'Select'} onClick={toggle} />
      </span>
    );
  } else {
    control = (
      <Tooltip content={on ? 'Leave the selection mode (Escape)' : 'Select several agents'}>
        <span data-selection-entry="icon" className="inline-flex">
          <IconButton size="icon-sm" variant={on ? 'neutral' : 'ghost'} aria-label={MODE_NAME} aria-pressed={on} onClick={toggle} icon={<ListChecks aria-hidden="true" className="h-4 w-4" />} />
        </span>
      </Tooltip>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      {control}
      {on ? <SelectAllBox ids={ids} /> : null}
    </span>
  );
}
