import { guardrailsNoticesOf, registryNotices } from '../logic/notices.js';
import type { GuardrailsOverviewDto } from '../shared.js';
import { NoticesButton } from '../ui/Notices.js';
import { Scope } from '../ui/Scope.js';

export interface PageTitleProps {
  /** The one h1 of the page. */
  title: string;
  /** One sentence under it. Absent: none. */
  subtitle?: string;
  /** `$sources.sessions.errorText`: the registry could not be listed (the answer is `ok: false`, answered as data). Empty or absent: none. */
  errorText?: string;
  /** `$sources.sessions.unreadableText`: registry files that could not be read (their sessions are not shown). Empty or absent: none. */
  unreadableText?: string;
  /** `$sources.overview` of the Guardrails page: its problems (or its failure) become notices. Absent while loading. */
  guardrails?: GuardrailsOverviewDto | { ok: false; errorText: string };
}

/**
 * The title of a page of this module (Table, Guardrails) at the size of the Agents page title (16 px, semibold), so the pages of one module do not open with
 * a 24 px heading next to a 16 px one. The base PageHeader has only the 24 px page size, and a 16 px section size that is an h2 without a sentence. The
 * problems of the page are behind a notices button at the right end of the title line (nothing is drawn when there are none).
 *
 * @registryCategory atomic
 * @registryTags header title notices
 */
export function PageTitle({ title, subtitle, errorText, unreadableText, guardrails }: PageTitleProps) {
  const items = [...registryNotices({ errorText: errorText ?? '', unreadableText: unreadableText ?? '' }), ...guardrailsNoticesOf(guardrails)];
  return (
    <Scope>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-base font-semibold leading-none text-content">{title}</h1>
          {subtitle === undefined || subtitle === '' ? null : <p className="text-sm text-muted">{subtitle}</p>}
        </div>
        <div className="ml-auto shrink-0 empty:hidden">
          <NoticesButton items={items} />
        </div>
      </div>
    </Scope>
  );
}
