import { ButtonAction, Tooltip } from '@wadeck-app/dsl-ui';
import { Ban, Check } from 'lucide-react';
import { useId, type KeyboardEvent } from 'react';
import { useRowLookControl } from '../lists/RowLookContext.js';
import {
  ACTIVE_BACKGROUNDS,
  ACTIVE_BACKGROUND_LABEL,
  DEFAULT_ROW_LOOK,
  HIGHLIGHT_COLORS,
  HUE_LABEL,
  STATE_HUES,
  hueSolid,
  type HighlightColor,
  type RowLook,
  type StateTint,
} from '../logic/rowLook.js';
import { POPUP_SECTION } from '../ui/popupSurface.js';
import { RowButton } from '../ui/RowButton.js';
import { OptionChoice } from './OptionChoice.js';
import { OptionGroup } from './OptionGroup.js';
import { OptionToggle } from './OptionToggle.js';

const SWATCH_BOX = 'inline-flex h-6 w-6 items-center justify-center rounded border';
const SWATCH_DOT = 'inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border';
const SUB_TITLE = 'px-2 pt-1 text-xs font-medium text-muted';

interface SwatchGroupProps<T extends string> {
  label: string;
  value: T;
  options: readonly T[];
  /** The name of a choice (accessible name and tooltip). */
  nameOf: (option: T) => string;
  /** The CSS color of a choice, or undefined for "off". */
  colorOf: (option: T) => string | undefined;
  onPick: (option: T) => void;
}

/** One row of color choices (a radio group, roving tab stop: Tab enters on the checked one, the arrows move and pick). A choice without color is the crossed circle. */
function SwatchGroup<T extends string>({ label, value, options, nameOf, colorOf, onPick }: SwatchGroupProps<T>) {
  const labelId = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, option: T): void => {
    const index = options.indexOf(option);
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const next = options[(index + step + options.length) % options.length];
    if (next !== undefined) {
      onPick(next);
      const radios = event.currentTarget.closest('[role="radiogroup"]')?.querySelectorAll<HTMLElement>('[role="radio"]');
      radios?.[(index + step + options.length) % options.length]?.focus();
    }
  };
  return (
    <div className="flex flex-col gap-1 px-2">
      <span id={labelId} className="text-xs font-medium text-muted">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-1">
        {options.map((option) => {
          const checked = option === value;
          const color = colorOf(option);
          return (
            <Tooltip key={option} content={nameOf(option)} describe={false}>
              <RowButton
                role="radio"
                aria-checked={checked}
                aria-label={nameOf(option)}
                data-swatch={option}
                tabIndex={checked ? 0 : -1}
                onClick={() => onPick(option)}
                onKeyDown={(event) => onKeyDown(event, option)}
                className={`${SWATCH_BOX} ${checked ? 'border-primary ring-1 ring-primary' : 'border-border hover:bg-muted-bg'}`}
              >
                {color === undefined ? (
                  <Ban aria-hidden="true" className="h-4 w-4 text-muted" />
                ) : (
                  <span aria-hidden="true" className={SWATCH_DOT} style={{ backgroundColor: color }}>
                    {checked ? <Check aria-hidden="true" className="h-2.5 w-2.5 text-surface" /> : null}
                  </span>
                )}
              </RowButton>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

const TINT_OPTIONS: readonly StateTint[] = ['off', ...STATE_HUES];

/**
 * The "Rows" section of the list menu: how the state of a row looks, in every layout (logic/rowLook.ts). The list is the live preview: each control changes it at
 * once, and the choice is saved in this browser. The colors are the theme's hues (readable in light and dark); the crossed circle turns a background off (the flag icon
 * and the state light stay).
 */
export function RowLookSection() {
  const { look, setLook } = useRowLookControl();
  const patch = (change: Partial<RowLook>): void => setLook({ ...look, ...change });
  const tintNameOf = (option: StateTint): string => (option === 'off' ? 'No background' : HUE_LABEL[option]);
  const tintColorOf = (option: StateTint): string | undefined => (option === 'off' ? undefined : hueSolid(option));
  const highlightNameOf = (option: HighlightColor): string => HUE_LABEL[option];
  const highlightColorOf = (option: HighlightColor): string => hueSolid(option);
  const tintGroup = (label: string, field: 'needs' | 'flag' | 'unread') => (
    <SwatchGroup<StateTint> label={label} value={look[field]} options={TINT_OPTIONS} nameOf={tintNameOf} colorOf={tintColorOf} onPick={(option) => patch({ [field]: option })} />
  );
  return (
    <div data-section="rows" className={`mt-1.5 flex flex-col gap-2 ${POPUP_SECTION} pt-1`}>
      <p data-section-title="" className="px-2 pb-0 pt-1.5 text-xs font-semibold text-muted">
        Rows
      </p>
      <p className="px-2 text-xs text-muted">How the state of an agent looks in every layout. The list changes as you pick.</p>
      {tintGroup('Needs you: row background', 'needs')}
      {tintGroup('Flagged: row background (the flag stays)', 'flag')}
      {tintGroup('Blue dot (done or unread): row background', 'unread')}
      <div className={`flex flex-col gap-2 ${POPUP_SECTION} pt-1`}>
        <p className={SUB_TITLE}>Open row (the agent on screen)</p>
        <OptionGroup label="Background">
          {ACTIVE_BACKGROUNDS.map((option) => (
            <OptionChoice key={option} name="row-focus-bg" checked={look.focusBg === option} onSelect={() => patch({ focusBg: option })} label={ACTIVE_BACKGROUND_LABEL[option]} />
          ))}
        </OptionGroup>
        <OptionToggle checked={look.focusBar} onToggle={(focusBar) => patch({ focusBar })} label="Bar on the left" hint="A 3 px bar on the left edge, with any background" />
        <OptionToggle checked={look.focusOutline} onToggle={(focusOutline) => patch({ focusOutline })} label="Outline" hint="A thin outline around the row, with any background" />
        <SwatchGroup<HighlightColor> label="Highlight color (bar, outline, fill)" value={look.focusColor} options={HIGHLIGHT_COLORS} nameOf={highlightNameOf} colorOf={highlightColorOf} onPick={(focusColor) => patch({ focusColor })} />
        <SwatchGroup<HighlightColor> label="Gradient color" value={look.gradientColor} options={HIGHLIGHT_COLORS} nameOf={highlightNameOf} colorOf={highlightColorOf} onPick={(gradientColor) => patch({ gradientColor })} />
      </div>
      <div className={`flex flex-col gap-2 ${POPUP_SECTION} pt-1`}>
        <p className={SUB_TITLE}>Names</p>
        <OptionToggle checked={look.boldActive} onToggle={(boldActive) => patch({ boldActive })} label="Bold name for the active session" hint="Off: the open agent's name has the weight of the others" />
        <OptionToggle checked={look.dimIdle} onToggle={(dimIdle) => patch({ dimIdle })} label="Dim the name of idle sessions" hint="Off: every name has the same color" />
      </div>
      <div className={`flex justify-end ${POPUP_SECTION} px-2 pt-2 pb-1`}>
        <ButtonAction variant="secondary" label="Reset rows to defaults" onClick={() => setLook(DEFAULT_ROW_LOOK)} />
      </div>
    </div>
  );
}
