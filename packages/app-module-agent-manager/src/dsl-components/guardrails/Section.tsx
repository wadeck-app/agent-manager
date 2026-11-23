import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { CountBadge } from '../ui/CountBadge.js';

/** A titled block of the page: icon, title, a count, and the actions of the block at the right. What an empty block says is the child's job (Empty). */
export function Section({ id, icon: Icon, title, count, actions, children }: { id: string; icon: LucideIcon; title: string; count?: number; actions?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col rounded-lg border border-border bg-surface">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-2">
        <Icon aria-hidden="true" className="h-am-icon w-am-icon text-muted" />
        <h2 id={id} className="text-sm font-semibold text-content">
          {title}
        </h2>
        {count === undefined ? null : <CountBadge>{count}</CountBadge>}
        <div className="ml-auto flex flex-wrap items-center gap-1">{actions}</div>
      </header>
      {children}
    </section>
  );
}
