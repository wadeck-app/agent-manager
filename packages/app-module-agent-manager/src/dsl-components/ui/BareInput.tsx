import type { ComponentProps } from 'react';

/** The magnifier of a search field: absolutely placed at the left of the input (give the input a left padding of about 28 px). */
export const SEARCH_ICON = 'pointer-events-none absolute left-2 top-1/2 h-am-icon-sm w-am-icon-sm -translate-y-1/2 text-muted';

// ComponentProps (not InputHTMLAttributes) so that the React 19 `ref` prop passes through.
export type BareInputProps = ComponentProps<'input'>;

/**
 * The module's one bare text input element, for the fields the dsl-ui FieldText cannot be: it always draws a visible label above the control, and these fields
 * are compact search or path inputs that sit under a label of their own (or an icon): the search box of the toolbar, the folder filters, the folder path
 * combobox. The caller gives the look (classes) and an accessible name. A field with a visible label is a FieldText.
 * Not a FieldText look-alike: it has no label, no description, no error text.
 */
export function BareInput({ type = 'text', ...rest }: BareInputProps) {
  return (
    // The single exemption of the module for text inputs, see the doc above.
    // violations-suppress: react/no-raw-input the bare compact input of the module, see the doc above
    <input {...rest} type={type} />
  );
}
