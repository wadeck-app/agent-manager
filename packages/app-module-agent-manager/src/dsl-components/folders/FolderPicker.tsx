import { useAbTest, useRegisterAbTests } from '@wadeck-app/dsl-ui';
import type { ReactNode } from 'react';
import { DEFAULT_FOLDER_PICKER, FOLDER_PICKER_VARIANTS, type FolderPickerVariant } from '../logic/folderVariants.js';
import type { FolderPick } from '../logic/folderPicker.js';
import { FOCUS_RING } from '../ui/focusRing.js';
import { FolderColumns } from './FolderColumns.js';
import { FolderExplorer } from './FolderExplorer.js';
import { FolderPalette } from './FolderPalette.js';
import { PickedLine } from './PickedLine.js';
import { FolderSmartList } from './FolderSmartList.js';
import { FolderTree } from './FolderTree.js';
import { BareInput } from '../ui/BareInput.js';

export const FOLDER_FIELD = `w-full rounded border border-border bg-surface px-2.5 py-1.5 text-base text-content placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`;

export interface FolderPickerProps {
  /** The id of the Folder input (the label of the field points at it). */
  inputId: string;
  /** The text of the Folder field. */
  value: string;
  onChange: (text: string) => void;
  /** The folder the user picked in the helper; the dialog keeps it to show its name and branch. */
  onPick: (pick: FolderPick) => void;
  /** The palette completes the text itself and only says what it knows of the folder. */
  onKnow: (pick: FolderPick) => void;
  /** What is known about the folder in the field, when it was picked from a list (not for a path typed by hand). */
  picked: FolderPick | undefined;
  disabled: boolean;
  invalid: boolean;
  placeholder: string;
  /** Forces one variant (tests, or a caller with a fixed choice): the A/B test is then not declared. */
  variant?: FolderPickerVariant;
}

/**
 * The Folder field of the New session dialog and the helper that chooses its value. The helper is the A/B test `folder-picker` (five variants, see
 * logic/folderVariants.ts), declared in code and shown in the dock of the page with the others (the choice is kept in localStorage `ab.folder-picker`).
 * Every variant writes the chosen path into the field and tells the dialog what it knows of it (name, branch); the field stays editable, a typed path is always valid
 * input (the daemon checks the folder at launch).
 */
export function FolderPicker({ inputId, value, onChange, onPick, onKnow, picked, disabled, invalid, placeholder, variant: forced }: FolderPickerProps) {
  const test = useAbTest<FolderPickerVariant>({
    id: 'folder-picker',
    label: 'Folder picker',
    initial: DEFAULT_FOLDER_PICKER,
    options: Object.fromEntries(FOLDER_PICKER_VARIANTS.map((entry) => [entry.id, { label: entry.label, hint: entry.hint }])) as Record<FolderPickerVariant, { label: string; hint: string }>,
  });
  useRegisterAbTests(forced === undefined ? [test] : []);
  const variant = forced ?? test.value;
  const fieldClass = `${FOLDER_FIELD} font-mono ${invalid ? 'border-danger' : ''}`;

  if (variant === 'palette') {
    return (
      <div className="flex flex-col gap-1.5">
        <FolderPalette inputId={inputId} value={value} onChange={onChange} onPick={onPick} onKnow={onKnow} disabled={disabled} invalid={invalid} placeholder={placeholder} className={fieldClass} />
        <PickedLine picked={picked} value={value} />
      </div>
    );
  }
  // The four variants that sit under a plain Folder field (the palette is the field itself). A table, so that a variant added to the type is a compile error here.
  const helpers: Record<Exclude<FolderPickerVariant, 'palette'>, ReactNode> = {
    tree: <FolderTree value={value} onPick={onPick} disabled={disabled} />,
    columns: <FolderColumns value={value} onPick={onPick} disabled={disabled} />,
    smart: <FolderSmartList value={value} onPick={onPick} disabled={disabled} />,
    explorer: <FolderExplorer value={value} onPick={onPick} disabled={disabled} />,
  };
  const helper = helpers[variant];
  return (
    <div className="flex flex-col gap-1.5">
      <BareInput
        id={inputId}
        data-autofocus=""
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid}
        placeholder={placeholder}
        className={fieldClass}
      />
      <PickedLine picked={picked} value={value} />
      {helper}
    </div>
  );
}
