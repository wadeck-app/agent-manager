import { Collapsible, FieldSelect, Tooltip } from '@wadeck-app/dsl-ui';
import { MODEL_OPTIONS, PERMISSION_MODE_OPTIONS, type ChoiceOption } from '../logic/launchForm.js';
import { modelModeSummary } from '../logic/modelMode.js';

export interface ModelModeOptionsProps {
  model: string;
  mode: string;
  onModel: (value: string) => void;
  onMode: (value: string) => void;
  /** The session record gave its model or mode: the new session follows them until the user changes one. */
  known: boolean;
  /** The user changed the model or the mode here. */
  changed: boolean;
  /** The fields wait (a request runs). */
  busy: boolean;
  /** The long explanation (where the values come from, the model family of the row): the tooltip of the disclosure, never text in the dialog. */
  hint: string;
}

/** The options of a select, plus the current value when the list does not know it (an exact model id an owned session was launched with). */
function withValue(options: readonly ChoiceOption[], value: string): ChoiceOption[] {
  return value === '' || options.some((option) => option.value === value) ? [...options] : [...options, { value, label: value }];
}

/** The Model and Permission mode of the Fork and Thread dialogs, folded behind one line that says what they are now (the hint is its tooltip). */
export function ModelModeOptions({ model, mode, onModel, onMode, known, changed, busy, hint }: ModelModeOptionsProps) {
  return (
    <Tooltip content={hint}>
    <span data-model-mode-options="" data-tip-fill="" className="block">
      <Collapsible title={modelModeSummary({ known, changed })}>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldSelect label="Model" value={model} onChange={onModel} options={withValue(MODEL_OPTIONS, model)} disabled={busy} />
          <FieldSelect label="Permission mode" value={mode} onChange={onMode} options={withValue(PERMISSION_MODE_OPTIONS, mode)} disabled={busy} />
        </div>
      </Collapsible>
    </span>
    </Tooltip>
  );
}
