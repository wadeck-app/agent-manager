import type { HTMLAttributes, ReactNode } from 'react';

/** The look of a chip: a status colour, never the only signal (the text, and often an icon, say it too). */
export type ChipVariant = 'neutral' | 'info' | 'warning' | 'danger' | 'success';

/** The one skin of every chip of the module: 20 px high, 8 px side padding, 12 px text (the density scale), soft fill and a subtle border. */
export const CHIP_BASE = 'inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-xs leading-none';

/** Classes are written in full: a class built at run time generates no CSS rule. */
const VARIANT: Record<ChipVariant, string> = {
  neutral: 'border-border bg-muted-bg text-muted-tint',
  info: 'border-hue-blue/30 bg-hue-blue-bg text-hue-blue',
  warning: 'border-warning/30 bg-warning-bg text-warning-text',
  danger: 'border-hue-red/30 bg-hue-red-bg text-hue-red',
  success: 'border-hue-green/30 bg-hue-green-bg text-hue-green',
};

/** The classes of a chip, for an element that needs its own tag or ref (a button, a focusable span). */
export function chipClass(variant: ChipVariant): string {
  return `${CHIP_BASE} ${VARIANT[variant]}`;
}

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: ChipVariant;
  /** A decorative icon before the text (hidden from the accessible name: the text says it). */
  icon?: ReactNode;
  children: ReactNode;
}

/** A small label of a fact or a state: host, state, program. One component so that every chip has the same height, padding and weight. */
export function Chip({ variant = 'neutral', icon, className, children, ...rest }: ChipProps) {
  return (
    <span {...rest} className={`${chipClass(variant)}${className === undefined ? '' : ` ${className}`}`}>
      {icon === undefined ? null : (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}
