import { ShieldOff } from 'lucide-react';
import { Banner } from '../ui/Banner.js';
import { useNow } from '../ui/hooks.js';
import { BlockedSessionsSection } from './BlockedSessionsSection.js';
import { DenialsSection } from './DenialsSection.js';
import { GrantsSection } from './GrantsSection.js';
import { RulesSection } from './RulesSection.js';
import { ScanSection } from './ScanSection.js';
import type { GuardrailsOverviewDto } from '../shared.js';

/**
 * The Guardrails page (phase 1, read-only): what the w-guardrails plugin granted, blocked and is configured to do, for the projects of this machine.
 * Everything is read from the plugin's files; nothing here can change them. A file it cannot read or whose shape it does not know is a banner naming the
 * file and what to do, never an empty section.
 */
export function GuardrailsPage({ overview, failed = false }: { overview: GuardrailsOverviewDto | undefined; /** The page source answered an error (the page shows it): do not claim to be loading. */ failed?: boolean }) {
  const now = useNow(1000);
  const data = overview;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {data === undefined && !failed ? (
        <div role="status" aria-busy="true" className="p-3 text-sm text-muted">
          Reading the plugin files...
        </div>
      ) : null}
      {data?.killSwitch.active ? (
        <div role="alert" className="flex items-start gap-2 rounded border border-danger bg-danger-bg px-3 py-2 text-sm text-danger-text">
          <ShieldOff aria-hidden="true" className="mt-0.5 h-am-icon w-am-icon shrink-0" />
          <div>
            <p className="font-semibold">The guardrails kill switch is ON: every protection is off.</p>
            <p>
              The file {data.killSwitch.path} exists. Delete it in a terminal (an agent may not) to turn the protection back on.
            </p>
          </div>
        </div>
      ) : null}
      {data !== undefined && data.killSwitch.errorText !== '' ? <Banner tone="error">{data.killSwitch.errorText}</Banner> : null}
      {data?.problems.map((item) => (
        <Banner key={`${item.file}|${item.message}`} tone="warning">
          <span className="break-all font-mono text-am-mono">{item.file}</span> {item.message}. {item.hint}
        </Banner>
      ))}
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
