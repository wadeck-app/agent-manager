import { FolderSearch } from 'lucide-react';
import type { GuardrailsOverviewDto } from '../shared.js';
import { Section } from './Section.js';

/** What was looked at: the sources of the folder list and every folder, so an empty page can be told from a page that looked in the wrong place. */
export function ScanSection({ overview }: { overview: GuardrailsOverviewDto }) {
  return (
    <Section id="guardrails-scan" icon={FolderSearch} title="Scanned" count={overview.projects.length}>
      <div className="flex flex-col gap-2 p-3 text-sm">
        <ul aria-label="Sources of the folder list" className="flex flex-col gap-1 text-content">
          {overview.sourcesText.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
        <details>
          <summary className="cursor-pointer text-primary">{overview.projects.length} project folder(s)</summary>
          <ul aria-label="Scanned folders" className="mt-1 flex flex-col gap-0.5">
            {overview.projects.map((project) => (
              <li key={project.path} className="flex flex-wrap items-baseline gap-2">
                <span className="break-all font-mono text-am-mono">{project.path}</span>
                <span className="text-xs text-muted">
                  {project.sources.join(', ')}
                  {project.hasFiles ? '' : '; no plugin file'}
                </span>
              </li>
            ))}
          </ul>
        </details>
        <p className="text-xs text-muted">File formats read: version {overview.formatVersion} (w-guardrails 1.29.0). A file with another shape is reported above, never guessed.</p>
      </div>
    </Section>
  );
}
