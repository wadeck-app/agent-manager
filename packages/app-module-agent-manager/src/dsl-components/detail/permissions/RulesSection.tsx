import { ChevronDown, ChevronRight, ListChecks } from 'lucide-react';
import { useState } from 'react';
import { RowButton, decisionWords, sourceWords, FOCUS_RING } from '../deps.js';
import type { RulesState } from './useSessionRules.js';

const NOTE = 'text-xs text-muted';
const WARN = 'border-b border-warning bg-warning-bg px-3 py-1.5 text-xs text-warning-text';

/**
 * The rules of the plugin for the folder of the session, collapsed by default: each category with what it does now (denied, asks, allowed), where that comes from
 * (default, config, hardcoded) and whether a bypass can lift it. A configuration error the plugin reports is a notice that stays visible while the section is
 * collapsed: the rules shown are then not what the user wrote.
 */
export function RulesSection({ rules }: { rules: RulesState }) {
  const [open, setOpen] = useState(false);
  const count = rules.kind === 'ok' ? rules.data.categories.length : 0;
  const summary = rules.kind === 'loading' ? 'reading...' : rules.kind === 'error' ? 'could not be read' : String(count);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section aria-label="Rules" className="border-b border-border">
      {rules.kind === 'ok' && rules.data.configError !== '' ? (
        <p data-rules-config-error="" className={`${WARN} break-words`}>
          {`The guardrails configuration of this folder has an error: ${rules.data.configError}${rules.data.configPath === '' ? '' : ` (file: ${rules.data.configPath})`}. Fix the file, then refresh: the rules below may not be what you wrote.`}
        </p>
      ) : null}
      <RowButton type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={`flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-medium text-content ${FOCUS_RING}`}>
        <Chevron aria-hidden="true" className="h-3.5 w-3.5 text-muted" />
        <ListChecks aria-hidden="true" className="h-am-icon-sm w-am-icon-sm text-muted" />
        Rules
        <span className="tabular-nums text-muted">{summary}</span>
      </RowButton>
      {open ? (
        <div className="px-3 pb-2">
          {rules.kind === 'loading' ? <p className={NOTE}>Reading the rules from the plugin...</p> : null}
          {rules.kind === 'error' ? <p className={`${NOTE} break-words text-warning-text`}>{`The rules could not be read from the plugin: ${rules.text}`}</p> : null}
          {rules.kind === 'ok' ? (
            <>
              {rules.data.cwdNote === '' ? null : <p className={`mb-1 break-words ${NOTE}`}>{rules.data.cwdNote}</p>}
              <table aria-label="Guardrail rules of this folder" className="w-full text-xs">
                <thead>
                  <tr className="text-left text-muted">
                    <th scope="col" className="py-0.5 pr-2 font-medium">
                      Category
                    </th>
                    <th scope="col" className="py-0.5 pr-2 font-medium">
                      Now
                    </th>
                    <th scope="col" className="py-0.5 pr-2 font-medium">
                      Source
                    </th>
                    <th scope="col" className="py-0.5 font-medium">
                      Bypass
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rules.data.categories.map((rule) => (
                    <tr key={rule.name} className="border-t border-border">
                      <td className="break-all py-0.5 pr-2 text-content">{rule.name}</td>
                      <td className="py-0.5 pr-2">{decisionWords(rule.decision)}</td>
                      <td className="py-0.5 pr-2 text-muted">{sourceWords(rule.source)}</td>
                      <td className={`py-0.5 ${rule.bypassable ? '' : 'text-muted'}`}>{rule.bypassable ? 'bypassable' : 'no bypass'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
