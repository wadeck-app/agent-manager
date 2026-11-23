import type { HTMLAttributes, ReactNode } from 'react';

export type CountTone = 'primary' | 'neutral' | 'danger' | 'warning' | 'info';

/** The one shape of a count: a circle for one digit, a pill for more, at least 16 px high, digits of equal width. */
export const COUNT_BADGE_BASE = 'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[11px] font-semibold leading-none tabular-nums';

/** Classes are written in full: a class built at run time generates no CSS rule. */
const TONE: Record<CountTone, string> = {
  primary: 'bg-primary text-white',
  neutral: 'bg-muted-bg text-muted-tint',
  danger: 'border border-danger bg-danger-bg text-danger-text',
  warning: 'border border-warning bg-warning-bg text-warning-text',
  info: 'border border-border bg-info-bg text-info-text',
};

export interface CountBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: CountTone;
  children: ReactNode;
}

/** A number on a button, a section or a tab. Position it with `className` (a corner badge adds `absolute`); the badge itself never decides where it sits. */
export function CountBadge({ tone = 'neutral', className, children, ...rest }: CountBadgeProps) {
  return (
    <span {...rest} className={`${COUNT_BADGE_BASE} ${TONE[tone]}${className === undefined ? '' : ` ${className}`}`}>
      {children}
    </span>
  );
}
