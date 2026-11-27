import type { InputHTMLAttributes } from 'react';

export type StyledRadioProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * The one radio of the module: the base dsl-ui Radio is a native input, which the module's own stylesheet does not restyle (its `border-border` has no border
 * width to color, so the browser draws its own ring: olive in the dark theme). This one draws the ring and the dot with the tokens of the base Radio and of the
 * StyledCheckbox (`border-muted-tint` unchecked, `primary-solid` checked, the primary focus ring), and keeps the native input on top (invisible) for the click,
 * the arrows, the label and the screen readers.
 */
export function StyledRadio({ className = '', checked, ...rest }: StyledRadioProps) {
  return (
    <span className={`relative inline-flex h-4 w-4 shrink-0 ${className}`}>
      <input type="radio" checked={checked} className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0" {...rest} />
      <span
        data-styled-radio=""
        aria-hidden="true"
        className={`pointer-events-none inline-flex h-4 w-4 items-center justify-center rounded-full border transition-colors peer-hover:border-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-1 ${checked === true ? 'border-primary-solid bg-primary-solid' : 'border-muted-tint bg-surface'}`}
      >
        {checked === true ? <span className="h-1.5 w-1.5 rounded-full bg-surface" /> : null}
      </span>
    </span>
  );
}
