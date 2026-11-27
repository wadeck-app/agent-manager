import { ShieldOff } from 'lucide-react';
import { useNow } from '../ui/hooks.js';
import { BlockedSessionsSection } from './BlockedSessionsSection.js';
import { DenialsSection } from './DenialsSection.js';
import { GrantsSection } from './GrantsSection.js';
import { RulesSection } from './RulesSection.js';
import { ScanSection } from './ScanSection.js';
import type { GuardrailsOverviewDto } from '../shared.js';

const PAGE_ERROR = 'flex items-start gap-2 rounded border border-danger bg-danger-bg px-3 py-2 text-sm text-danger-text';

/**
 * The Guardrails page (phase 1, read-only): what the w-guardrails plugin granted, blocked and is configured to do, for the projects of this machine.
 * Everything is read from the plugin's files; nothing here can change them. A file it cannot read or whose shape it does not know is a banner naming the
 * file and what to do, never an empty section.
 */
export function GuardrailsPage({ overview, failed = false }: { overview: GuardrailsOverviewDto | undefined; /** The page source answered an error (the notices button of the page header says it): do not claim to be loading. */ failed?: boolean }) {
  const now = useNow(1000);
  const data = overview;
  return (
    // pt-4 = the space-y-4 of PageContent: the host wrapper of a custom component does not get that margin (the header line touched the first card).
    <div className="flex min-w-0 flex-col gap-3 pt-4">
      {data === undefined && !failed ? (
        <div role="status" aria-busy="true" className="p-3 text-sm text-muted">
          Reading the plugin files...
        </div>
      ) : null}
      {data?.killSwitch.active ? (
        <div role="alert" className={PAGE_ERROR}>
          <ShieldOff aria-hidden="true" className="mt-0.5 h-am-icon w-am-icon shrink-0" />
          <div>
            <p className="font-semibold">The guardrails kill switch is ON: every protection is off.</p>
            <p>
              The file {data.killSwitch.path} exists. Delete it in a terminal (an agent may not) to turn the protection back on.
            </p>
          </div>
        </div>
      ) : null}
      {data !== undefined ? (
        <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
          <GrantsSection grants={data.grants} hiddenEntries={data.hiddenEntries} now={now} scanned={data.projects.length} />
          <BlockedSessionsSection sessions={data.sessions} now={now} />
        </div>
      ) : null}
      <DenialsSection />
      {data !== undefined ? <RulesSection configs={data.configs} projects={data.projects.length} note={data.rulesNote} /> : null}
      {data !== undefined ? <ScanSection overview={data} /> : null}
    </div>
  );
}
