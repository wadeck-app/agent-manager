import type { ReactNode } from 'react';

/** The message of an empty list or an empty filter, with what the user can do. */
export function EmptyNote({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div role="status" className="flex flex-col items-start gap-2 p-4 text-sm">
      <p className="font-medium text-content">{title}</p>
      {hint !== undefined ? <p className="text-muted">{hint}</p> : null}
      {action}
    </div>
  );
}
