import type { LucideIcon } from 'lucide-react';
import { Tooltip } from './Tooltip.js';

/** The focus ring of every interactive element of the page: one source. */
export const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/** One size for every icon button of the page (same role, same geometry). */
export const ICON_BUTTON_CLASS = `inline-flex h-am-hit w-am-hit shrink-0 items-center justify-center rounded text-muted hover:bg-muted-bg hover:text-content disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`;

export interface IconButtonProps {
  icon: LucideIcon;
  /** The accessible name AND the tooltip text. */
  label: string;
  onClick: () => void;
  /** Toggle buttons (pin): pressed state. */
  pressed?: boolean;
  disabled?: boolean;
  /** Why it is disabled, shown as the tooltip instead of the label. */
  disabledReason?: string;
  className?: string;
}

/** An icon-only button with a name and a tooltip. A disabled one explains why in its tooltip (the wrapper receives the pointer, not the button). */
export function IconButton({ icon: Icon, label, onClick, pressed, disabled = false, disabledReason, className = '' }: IconButtonProps) {
  return (
    <Tooltip content={disabled && disabledReason !== undefined ? `${label}: ${disabledReason}` : label}>
      <button type="button" aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick} className={`${ICON_BUTTON_CLASS} ${className}`}>
        <Icon aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
      </button>
    </Tooltip>
  );
}
