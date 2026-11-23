import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { FOCUS_RING } from '../ui/focusRing.js';

/** The two sizes of an icon button: 28 px and 36 px, the `icon-sm` and `icon` sizes of the dsl-ui IconButton. */
const SIZE = { sm: 'h-7 w-7', md: 'h-9 w-9' } as const;

export interface RowIconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick' | 'aria-label'> {
  /** The accessible name (the tooltip is the caller's: a row already wraps its buttons in the page Tooltip). */
  label: string;
  icon: ReactNode;
  /** 28 px (default) or 36 px. */
  size?: keyof typeof SIZE;
  /** The click, after it was stopped from reaching the row under the button. The event is given to place a popup under the button. */
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * A small button on a list row or a group header (move, menu, settings, sub-agents). It is not a tab stop (the row is: its own keys do the same), and its click
 * never selects the row. One component, so every row button has the same size, hover and focus ring.
 */
export function RowIconButton({ label, icon, size = 'sm', onClick, className, ...rest }: RowIconButtonProps) {
  return (
    <button
      {...rest}
      type="button"
      tabIndex={-1}
      data-row-icon-button=""
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick(event);
      }}
      className={`inline-flex ${SIZE[size]} shrink-0 items-center justify-center rounded text-muted-tint hover:bg-muted-bg hover:text-content ${FOCUS_RING}${className === undefined ? '' : ` ${className}`}`}
    >
      {icon}
    </button>
  );
}
