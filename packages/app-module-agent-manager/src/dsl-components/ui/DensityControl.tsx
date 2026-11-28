import { ALargeSmall, TriangleAlert } from 'lucide-react';
import { useDensityProblem } from './density.js';
import { IconButton } from '@wadeck-app/dsl-ui';
import { CHECKED_RADIO, DensityChoices } from './DensityChoices.js';
import { usePopover } from './usePopover.js';
import { POPUP_SURFACE } from './popupSurface.js';

/**
 * The text size setting: an icon button and a small panel with the choices (DensityChoices; Escape closes and gives the focus back to the button).
 * The choice is kept in localStorage and applies to the whole page at once through the scope wrapper.
 */
export function DensityControl() {
  const problem = useDensityProblem();
  const { open, setOpen, box, panelId } = usePopover(CHECKED_RADIO);

  return (
    <div ref={box} className="relative">
      <IconButton
        size="icon-sm"
        variant={open ? 'neutral' : 'ghost'}
        aria-label={problem === '' ? 'Text size' : 'Text size (a note about the saved setting)'}
        tooltip={problem === '' ? 'Text size' : `Text size: ${problem}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
        className={problem === '' ? '' : 'text-warning-text'}
        icon={problem === '' ? <ALargeSmall aria-hidden="true" className="h-4 w-4" /> : <TriangleAlert aria-hidden="true" className="h-4 w-4" />}
      />
      {open ? (
        <div id={panelId} role="dialog" aria-label="Text size" className={`absolute right-0 top-full z-30 mt-1 w-72 ${POPUP_SURFACE} p-2`}>
          <DensityChoices />
        </div>
      ) : null}
    </div>
  );
}
