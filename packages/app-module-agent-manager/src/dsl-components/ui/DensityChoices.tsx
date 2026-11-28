import { X } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import { DENSITY_LABEL, DENSITY_SETTINGS, dismissDensityProblem, setDensity, useDensity, useDensityProblem, useDensitySetting, type Density, type DensitySetting } from './density.js';
import { autoHint, densityHint } from './densityScale.js';
import { IconButton } from '@wadeck-app/dsl-ui';
import { FOCUS_RING } from './focusRing.js';
import { RowButton } from './RowButton.js';

const DENSITY_ALERT = 'mb-2 flex items-start gap-1.5 rounded border border-warning bg-warning-bg px-2 py-1.5 text-xs text-warning-text';

/** The selector of the checked choice: where the focus goes when a popup that holds the choices opens. */
export const CHECKED_RADIO = '[role="radio"][aria-checked="true"]';

/** The label of a choice: `auto` says what it currently picks. */
function choiceLabel(value: DensitySetting, resolved: Density): string {
  return value === 'auto' ? `Auto (currently ${DENSITY_LABEL[resolved]})` : DENSITY_LABEL[value];
}

/**
 * The choices of the text size: the note about the saved setting (when there is one), then a radio group (arrows move, Enter or Space picks). Shared by the
 * popover of DensityControl and by the overflow menu of a narrow screen (MoreMenu).
 */
export function DensityChoices() {
  const setting = useDensitySetting();
  const resolved = useDensity();
  const problem = useDensityProblem();
  const box = useRef<HTMLDivElement>(null);

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
    <div ref={box}>
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
  );
}
