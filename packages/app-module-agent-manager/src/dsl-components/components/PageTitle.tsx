import { Scope } from '../ui/Scope.js';

export interface PageTitleProps {
  /** The one h1 of the page. */
  title: string;
  /** One sentence under it. Absent: none. */
  subtitle?: string;
}

/**
 * The title of a page of this module (Table, Guardrails) at the size of the Agents page title (16 px, semibold), so the pages of one module do not open with
 * a 24 px heading next to a 16 px one. The base PageHeader has only the 24 px page size, and a 16 px section size that is an h2 without a sentence.
 *
 * @registryCategory atomic
 * @registryTags header title
 */
export function PageTitle({ title, subtitle }: PageTitleProps) {
  return (
    <Scope>
      <div className="flex flex-col gap-1">
        <h1 className="text-base font-semibold leading-none text-content">{title}</h1>
        {subtitle === undefined || subtitle === '' ? null : <p className="text-sm text-muted">{subtitle}</p>}
      </div>
    </Scope>
  );
}
