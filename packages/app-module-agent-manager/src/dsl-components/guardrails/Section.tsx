import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** A titled block of the page: icon, title, a count, and the actions of the block at the right. What an empty block says is the child's job (Empty). */
export function Section({ id, icon: Icon, title, count, actions, children }: { id: string; icon: LucideIcon; title: string; count?: number; actions?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col rounded-lg border border-border bg-surface">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Icon aria-hidden="true" className="h-am-icon w-am-icon text-muted" />
        <h2 id={id} className="text-base font-semibold text-content">
          {title}
        </h2>
        {count === undefined ? null : <span className="rounded-full bg-muted-bg px-2 text-xs tabular-nums text-muted">{count}</span>}
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </header>
      {children}
    </section>
  );
}
