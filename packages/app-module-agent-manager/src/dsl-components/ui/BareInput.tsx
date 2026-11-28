import type { ComponentProps } from 'react';

/** The magnifier of a search field: absolutely placed at the left of the input (give the input a left padding of about 28 px). */
export const SEARCH_ICON = 'pointer-events-none absolute left-2 top-1/2 h-am-icon-sm w-am-icon-sm -translate-y-1/2 text-muted';

// ComponentProps (not InputHTMLAttributes) so that the React 19 `ref` prop passes through.
export type BareInputProps = ComponentProps<'input'>;

/**
 * The module's one bare text input element. Checked against dsl-ui 2026.11.28-407, none of its fields can replace these inputs:
 * - FieldText (`hideLabel`, `icon`) keeps the caller's `id` / `aria-*` now, but has no `ref` and no typed `data-*`, bakes `px-3 py-2|py-1`, `text-sm|text-xs`, `pl-9` with an icon and its own focus style
 *   (a caller class is appended, so a narrower or differently padded field cannot be set reliably), and wraps the input in its own label element.
 * - SearchBar has `width`, `ariaLabel`, `ariaDescribedBy`, `inputRef`, `onKeyDown`, but no `aria-invalid`, no data attribute (the `/` shortcut finds the field by `data-agent-search`), no counter
 *   inside the field and no tooltip: the toolbar search needs all of them.
 * The caller gives the look (classes) and an accessible name. A field with a visible label is a FieldText.
 */
export function BareInput({ type = 'text', ...rest }: BareInputProps) {
  return (
    // The single exemption of the module for text inputs, see the doc above.
    // violations-suppress: react/no-raw-input the bare compact input of the module, see the doc above
    <input {...rest} type={type} />
  );
}
