import { ALargeSmall, TriangleAlert, X } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { DENSITY_LABEL, DENSITY_SETTINGS, dismissDensityProblem, setDensity, useDensity, useDensityProblem, useDensitySetting, type Density, type DensitySetting } from './density.js';
import { autoHint, densityHint } from './densityScale.js';
import { IconButton } from '@wadeck-app/dsl-ui';
import { TipIconButton } from './TipIconButton.js';
import { FOCUS_RING } from './focusRing.js';
import { usePopover } from './usePopover.js';
import { POPUP_SURFACE } from './popupSurface.js';
import { RowButton } from './RowButton.js';

const DENSITY_ALERT = 'mb-2 flex items-start gap-1.5 rounded border border-warning bg-warning-bg px-2 py-1.5 text-xs text-warning-text';

const CHECKED_RADIO = '[role="radio"][aria-checked="true"]';

/** The label of a choice: `auto` says what it currently picks. */
function choiceLabel(value: DensitySetting, resolved: Density): string {
  return value === 'auto' ? `Auto (currently ${DENSITY_LABEL[resolved]})` : DENSITY_LABEL[value];
}

/**
 * The text size setting: an icon button and a small panel with the choices (a radio group, arrows move, Enter or Space picks, Escape closes and gives the
 * focus back to the button). The choice is kept in localStorage and applies to the whole page at once through the scope wrapper.
 */
export function DensityControl() {
  const setting = useDensitySetting();
  const resolved = useDensity();
  const problem = useDensityProblem();
  const { open, setOpen, box, panelId } = usePopover(CHECKED_RADIO);

  const onRadioKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const next = DENSITY_SETTINGS[(DENSITY_SETTINGS.indexOf(setting) + step + DENSITY_SETTINGS.length) % DENSITY_SETTINGS.length];
    if (next !== undefined) {
      setDensity(next);
      queueMicrotask(() => box.current?.querySelector<HTMLElement>(CHECKED_RADIO)?.focus());
    }
  };

  return (
    <div ref={box} className="relative">
      <TipIconButton
        size="icon-sm"
        variant={open ? 'neutral' : 'ghost'}
        aria-label={problem === '' ? 'Text size' : 'Text size (a note about the saved setting)'}
        tip={problem === '' ? 'Text size' : `Text size: ${problem}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
        className={problem === '' ? '' : 'text-warning-text'}
        icon={problem === '' ? <ALargeSmall aria-hidden="true" className="h-4 w-4" /> : <TriangleAlert aria-hidden="true" className="h-4 w-4" />}
      />
      {open ? (
        <div id={panelId} role="dialog" aria-label="Text size" className={`absolute right-0 top-full z-30 mt-1 w-72 ${POPUP_SURFACE} p-2`}>
          {problem !== '' ? (
            <div role="alert" className={DENSITY_ALERT}>
              <p className="min-w-0 flex-1">{problem}</p>
<IconButton size="icon-xs" aria-label="Dismiss the note about the text size" onClick={dismissDensityProblem} icon={<X aria-hidden="true" className="h-3 w-3" />} />
            </div>
          ) : null}
          <div role="radiogroup" aria-label="Text size" onKeyDown={onRadioKeyDown} className="flex flex-col gap-1">
            {DENSITY_SETTINGS.map((value) => (
              <RowButton
                key={value}
                type="button"
                role="radio"
                aria-checked={value === setting}
                tabIndex={value === setting ? 0 : -1}
                onClick={() => setDensity(value)}
                className={`flex min-h-am-hit flex-col items-start justify-center rounded px-3 py-1 text-left text-sm ${value === setting ? 'bg-primary-light text-content' : 'text-content hover:bg-muted-bg'} ${FOCUS_RING}`}
              >
                <span className="font-medium">{choiceLabel(value, resolved)}</span>
                <span className="text-xs text-muted">{value === 'auto' ? autoHint() : densityHint(value)}</span>
              </RowButton>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
