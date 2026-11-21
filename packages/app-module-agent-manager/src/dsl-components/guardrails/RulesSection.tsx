import { ScrollText } from 'lucide-react';
import type { ProjectConfigDto } from '../shared.js';
import { Banner } from '../ui/Banner.js';
import { Empty } from './Empty.js';
import { Section } from './Section.js';

/**
 * The rules files as written, one block per project that has one. The plugin defaults are NOT shown: they live in the plugin code (request A2 of the study),
 * so the note says it. A malformed file is an error with the parse text: the hook silently ignores such a file.
 */
export function RulesSection({ configs, projects, note }: { configs: readonly ProjectConfigDto[]; projects: number; note: string }) {
  const without = projects - configs.length;
  return (
    <Section id="guardrails-rules" icon={ScrollText} title="Project rules" count={configs.length}>
      <div className="flex flex-col gap-3 p-3">
        <Banner tone="info">{note}</Banner>
        {configs.length === 0 ? <Empty title="No project has a rules file" hint="Every scanned project uses the plugin defaults." /> : null}
        {configs.map((config) => (
          <article key={config.project} aria-label={`Rules of ${config.project}`} className="rounded border border-border p-3">
            <h3 className="break-all font-mono text-am-mono font-medium text-content">{config.project}</h3>
            {config.state === 'malformed' || config.state === 'unreadable' ? (
              <div className="mt-2">
                <Banner tone="error">
                  {config.state === 'malformed' ? 'The plugin IGNORES this file and uses its defaults. ' : 'This file cannot be read. '}
                  {config.errorText} ({config.file})
                </Banner>
              </div>
            ) : null}
            {config.warnings.length > 0 ? (
              <ul aria-label="Warnings" className="mt-2 flex flex-col gap-1">
                {config.warnings.map((warning) => (
                  <li key={warning}>
                    <Banner tone="warning">{warning}</Banner>
                  </li>
                ))}
              </ul>
            ) : null}
            {config.categories.length > 0 ? (
              <ul aria-label="Category decisions" className="mt-2 flex flex-wrap gap-1.5">
                {config.categories.map((category) => (
                  <li key={category.name} className="rounded-full bg-muted-bg px-2 py-0.5 text-sm text-content">
                    {category.name}: <span className="font-medium">{category.decision}</span>
                  </li>
                ))}
              </ul>
            ) : config.state === 'ok' ? (
              <p className="mt-2 text-sm text-muted">No category decision in this file.</p>
            ) : null}
            {config.protectedFiles.length > 0 ? (
              <ul aria-label="Protected files" className="mt-2 flex flex-col gap-0.5 text-sm">
                {config.protectedFiles.map((item) => (
                  <li key={`${item.glob}|${item.decision}`}>
                    <span className="font-mono text-am-mono">{item.glob}</span> <span className="text-muted">{item.decision}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {config.state === 'ok' ? (
              <p className="mt-2 text-xs text-muted">
                {config.categoryMessages} custom message(s), {config.hasSecrets ? 'a secrets block is configured' : 'no secrets block'}.
              </p>
            ) : null}
          </article>
        ))}
        {without > 0 ? <p className="text-sm text-muted">{without} scanned project(s) have no rules file (plugin defaults apply).</p> : null}
      </div>
    </Section>
  );
}
