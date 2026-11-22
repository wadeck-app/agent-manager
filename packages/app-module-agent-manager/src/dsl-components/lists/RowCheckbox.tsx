import { StyledCheckbox } from '../ui/StyledCheckbox.js';
import { useSelection } from './selection.js';

/**
 * The checkbox of a row: at the left edge, over the program icon, shown on hover, on keyboard focus and whenever something is selected (so a selection can be
 * extended with the pointer alone). Out of the tab order like the other buttons of a row: the row is the tab stop, X toggles it from the keyboard.
 */
export function RowCheckbox({ id, name }: { id: string; name: string }) {
  const selection = useSelection();
  if (selection === null) {
    return null;
  }
  const checked = selection.isSelected(id);
  const shown = selection.count > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100';
  return (
    <span data-row-checkbox="" className={`absolute left-0.5 top-1/2 z-10 -translate-y-1/2 inline-flex rounded bg-surface p-0.5 shadow-sm ring-1 ring-border ${checked ? 'opacity-100' : shown}`} onClick={(event) => event.stopPropagation()}>
      <StyledCheckbox
        tabIndex={-1}
        aria-label={`Select ${name}`}
        checked={checked}
        onChange={() => selection.toggle(id)}
      />
    </span>
  );
}

