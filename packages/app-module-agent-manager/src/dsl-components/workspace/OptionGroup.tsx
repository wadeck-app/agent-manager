import type { ReactNode } from 'react';

/** A titled set of choices of a view option. */
export function OptionGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-0.5">
      <legend className="px-2 pb-1 text-xs font-medium text-muted">{label}</legend>
      {children}
    </fieldset>
  );
}
