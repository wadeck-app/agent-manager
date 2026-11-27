import { Check, Minus } from 'lucide-react';
import { useEffect, useRef, type InputHTMLAttributes } from 'react';

export interface StyledCheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Some but not all: a dash instead of the check (the native indeterminate flag is set too). */
  indeterminate?: boolean;
}

/**
 * The one checkbox of the module (rows, group headers, select all): a rounded box on the theme tokens, filled with the primary color and a check icon when
 * checked, a dash when indeterminate. The native input stays on top (invisible) for the click, the keyboard, the label and the screen readers; it is 24 px
 * wide and high, 4 px beyond the 16 px box on each side: the hit area of a small control (QA3 R14), the look is unchanged.
 */
export function StyledCheckbox({ indeterminate = false, className = '', checked, ...rest }: StyledCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current !== null) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);
  const on = checked === true || indeterminate;
  return (
    <span className={`relative inline-flex h-4 w-4 shrink-0 ${className}`}>
      <input ref={ref} type="checkbox" checked={checked} className="peer absolute -left-1 -top-1 z-10 m-0 h-6 w-6 cursor-pointer opacity-0" {...rest} />
      <span
        data-styled-checkbox=""
        aria-hidden="true"
        // The empty box border is the muted-tint token (3:1 or more against the surface, light and dark: the WCAG non-text contrast), not the faint divider color.
        className={`pointer-events-none inline-flex h-4 w-4 items-center justify-center rounded-sm border text-on-solid transition-colors peer-hover:border-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-1 ${on ? 'border-primary-solid bg-primary-solid' : 'border-muted-tint bg-surface'}`}
      >
        {indeterminate ? <Minus className="h-3 w-3" strokeWidth={3} /> : checked === true ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
      </span>
    </span>
  );
}
