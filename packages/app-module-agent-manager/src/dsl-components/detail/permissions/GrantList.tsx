import { KeyRound } from 'lucide-react';
import type { GrantDto } from '../deps.js';
import { fromFile } from './grantModel.js';
import { GrantRows } from './GrantRows.js';
import { SECTION, SECTION_BODY } from './sectionSpacing.js';

const NOTE = 'text-xs text-muted';

/** Bypasses read from the plugin files (the other sessions, or this one without the admin CLI): read-only, nothing here can revoke them. */
export function GrantList({ title, grants, empty, now, showSession }: { title: string; grants: readonly GrantDto[]; empty: string; now: number; showSession: boolean }) {
  return (
    <section aria-label={title} className={SECTION}>
      <h4 className="flex items-center gap-1.5 px-3 text-xs font-medium text-content">
        <KeyRound aria-hidden="true" className="h-am-icon-sm w-am-icon-sm text-muted" />
        {title}
        <span className="tabular-nums text-muted">{grants.length}</span>
      </h4>
      {grants.length === 0 ? <p className={`px-3 ${SECTION_BODY} ${NOTE}`}>{empty}</p> : <div className={SECTION_BODY}><GrantRows grants={grants.map((grant) => fromFile(grant, showSession))} now={now} busy={false} /></div>}
    </section>
  );
}
