import type { ButtonHTMLAttributes } from 'react';
import { FOCUS_RING } from './focusRing.js';

export type RowButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * The module's one bare button element, for the controls whose geometry the dsl-ui base buttons do not offer: a full-width row that holds several elements (a list
 * row, a disclosure header, an option of a picker), a segmented option, an inline text toggle ("Show full"). It carries the focus ring and `type="button"` and
 * NO look: the caller gives the layout classes. Anything that reads as a button (a label, an icon, a tab, a chip, a switch) uses the base component:
 * ButtonAction, IconButton, TabButton, ChipButton, Switch. A button of this kind written inline anywhere else fails `violations check` (react/no-raw-button).
 */
export function RowButton({ className = '', type = 'button', ...rest }: RowButtonProps) {
  return (
    // The single exemption of the module: the dsl-ui base Button is internal (not exported) and none of the exported buttons has a row or text-toggle geometry.
    // violations-suppress: react/no-raw-button the bare row button of the module, see the doc above
    <button {...rest} type={type} className={`${FOCUS_RING} ${className}`.trim()} />
  );
}
