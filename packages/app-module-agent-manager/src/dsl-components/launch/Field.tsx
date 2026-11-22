import type { ReactNode } from 'react';

/** A labelled form field: the label, the control, and a hint (or an error) under it. */
export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium text-content">
        {label}
      </label>
      {children}
      {hint === undefined ? null : <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}
