import { GuardrailsPage as Body } from '../guardrails/GuardrailsPage.js';
import type { GuardrailsOverviewDto } from '../shared.js';
import { Scope } from '../ui/Scope.js';

export interface GuardrailsPageProps {
  /** `$sources.overview`: the answer of GET /guardrails/overview (the page owns the poll). Absent while loading; an answer with `ok: false` is shown by the page, not here. */
  overview?: GuardrailsOverviewDto | { ok: false; errorText: string };
}

/**
 * The Guardrails page body (nav "Guardrails", /guardrails): the bypasses the w-guardrails plugin granted, the sessions it blocked, the rules files, the
 * newest denials. Read-only. The overview comes from the page source; the denial timeline is fetched here (GET /guardrails/denials, on demand).
 *
 * @registryCategory composite
 * @registryTags guardrails bypass denials read-only
 */
export function GuardrailsPage({ overview }: GuardrailsPageProps) {
  return (
    <Scope>
      <Body overview={overview !== undefined && overview.ok ? overview : undefined} failed={overview !== undefined && !overview.ok} />
    </Scope>
  );
}
