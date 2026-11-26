import { StyledCheckbox } from '../ui/StyledCheckbox.js';
import { visibleSessionIds } from '../workspace/usePageShortcuts.js';
import { useSelection } from './selection.js';

/**
 * The checkbox of a row, in the selection mode only (nothing is drawn, and no room is kept, otherwise): the first item of the row, at its left edge, so that
 * the boxes of every row and of every group header are one column. It stays out of the tab order like the other buttons of a row: the row is the tab stop,
 * X toggles it from the keyboard.
 */
export function RowCheckbox({ id, name, firstLine = false }: { id: string; name: string; /** A row of several lines: the box is centered on its first line (the 20 px of the state icon, 2 px down), not on the row. */ firstLine?: boolean }) {
  const selection = useSelection();
  if (selection === null || !selection.mode) {
    return null;
  }
  const checked = selection.isSelected(id);
  return (
    <span data-row-checkbox="" className={`inline-flex shrink-0 items-center ${firstLine ? 'mt-0.5 h-5' : 'h-7'}`} onClick={(event) => event.stopPropagation()}>
      <StyledCheckbox
        tabIndex={-1}
        aria-label={`Select ${name}`}
        checked={checked}
        // A shift click extends the range from the last ticked row, like a shift click on the row; others toggle. React fires onChange even when the click
        // was cancelled, so the shift key is read here, from the click that caused the change, and nothing else may toggle.
        onChange={(event) => {
          if ((event.nativeEvent as MouseEvent).shiftKey === true) {
            selection.selectRange(id, visibleSessionIds());
          } else {
            selection.toggle(id);
          }
        }}
      />
    </span>
  );
}
