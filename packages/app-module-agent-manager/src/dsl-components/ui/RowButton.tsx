import type { ButtonHTMLAttributes } from 'react';
import { FOCUS_RING } from './focusRing.js';

export type RowButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * The module's one bare button element, for the controls the dsl-ui buttons (2026.11.27-389) still cannot be: a full-width row that holds several elements (a list
 * row, a disclosure header with `aria-expanded`, an option of a picker), a radio or a segmented option (`role`, `aria-checked`), a chip-looking button that is not a toggle (ChipButton needs `active`), a button that must not
 * be a tab stop and must not bring its own tooltip (the icon buttons of a row, `RowIconButton`). It carries the focus ring and `type="button"` and NO look: the caller gives
 * the layout classes. A text link, a quiet text action, an icon, a tab, a switch use the base component: ButtonAction (`link`, `ghost`), IconButton, TabButton, ChipButton,
 * Switch. A button of this kind written inline anywhere else fails `violations check` (react/no-raw-button).
 */
export function RowButton({ className = '', type = 'button', ...rest }: RowButtonProps) {
  return (
    // The single exemption of the module: the dsl-ui base Button is internal (not exported) and none of the exported buttons has a row or disclosure geometry, takes a `role`, `aria-expanded` or `aria-checked`, or a children node.
    // violations-suppress: react/no-raw-button the bare row button of the module, see the doc above
    <button {...rest} type={type} className={`${FOCUS_RING} ${className}`.trim()} />
  );
}
