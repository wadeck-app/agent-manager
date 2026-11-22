import { IconButton } from '@wadeck-app/dsl-ui';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import { bypassCommand, PAGE_BASE, useNow, type AgentRow } from '../deps.js';
import { CopyButton } from '../log/CopyButton.js';
import { DisabledWrite } from './DisabledWrite.js';
import { GrantList } from './GrantList.js';
import type { SessionGrantsFeed } from './useSessionGrants.js';

const NOTE = 'text-xs text-muted';
const WARN = 'border-b border-warning bg-warning-bg px-3 py-1.5 text-xs text-warning-text';

/**
 * The Permissions tab of the right rail. Read-only: the bypasses of this session and of the other sessions of its project (from the plugin files, through
 * GET /guardrails/overview), the categories that blocked the session with a button that copies the command to run in the session, and the write controls
 * disabled until the w-guardrails API exists (GUARDRAILS_WRITE_ENABLED). Every absence is said in words.
 */
export function PermissionsPanel({ session, feed }: { session: AgentRow; feed: SessionGrantsFeed }) {
  const now = useNow(15_000);
  const { overview, view, error, loading, reload } = feed;
  const blocks = session.guardrailBlocks;
  return (
    <div data-permissions-panel="" className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <a href={`${PAGE_BASE}/guardrails`} className="text-xs text-primary underline">
          Guardrails page
        </a>
        <IconButton size="icon-xs" aria-label="Refresh the permissions" disabled={loading} onClick={reload} icon={<RefreshCw aria-hidden="true" className={`h-3 w-3 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} />} />
      </div>
      {error !== '' ? (
        <p role="alert" className={WARN}>
          {overview === undefined ? `The bypasses could not be read: ${error}` : `The bypasses could not be refreshed, the list is the last one read: ${error}`}
        </p>
      ) : null}
      {overview === undefined && error === '' ? <p className={`px-3 py-2 ${NOTE}`}>Reading the guardrails files...</p> : null}
      {overview?.killSwitch.active === true ? <p className={WARN}>The guardrails emergency switch is on: no protection is active, bypass or not.</p> : null}
      {overview !== undefined && overview.problems.length > 0 ? (
        <p className={WARN}>{`${overview.problems.length} guardrails file${overview.problems.length === 1 ? '' : 's'} could not be read, so the list may be incomplete. The Guardrails page names them.`}</p>
      ) : null}
      {view !== undefined ? (
        <>
          <GrantList title="This session" grants={view.mine} empty="No active bypass for this session." now={now} showSession={false} />
          <GrantList
            title="Other sessions of this project"
            grants={view.project}
            empty={session.cwd === '' ? 'The folder of this session is unknown, so its project cannot be matched.' : 'No active bypass for the other sessions of this project.'}
            now={now}
            showSession
          />
        </>
      ) : null}
      <section aria-label="Blocked" className="border-b border-border px-3 py-2">
        <h4 className="flex items-center gap-1.5 text-xs font-medium text-content">
          <ShieldAlert aria-hidden="true" className="h-am-icon-sm w-am-icon-sm text-muted" />
          Blocked
          <span className="tabular-nums text-muted">{blocks?.total ?? 0}</span>
        </h4>
        {blocks === undefined ? (
          <p className={`mt-1 ${NOTE}`}>No guardrail blocked this session (the plugin has no counter for it).</p>
        ) : (
          <ul aria-label="Blocked by category" className="mt-1 flex flex-col gap-0.5">
            {blocks.categories.map((item) => (
              <li key={item.category} className="flex items-center gap-1 text-xs">
                <span className="min-w-0 flex-1 truncate text-content">{item.category}</span>
                <span className="tabular-nums text-muted">{item.count}</span>
                <CopyButton text={bypassCommand(item.category)} label={`Copy ${bypassCommand(item.category)}: run it in this session yourself, the module grants nothing`} />
              </li>
            ))}
          </ul>
        )}
        {view?.session !== undefined && view.session.refusedCount > 0 ? <p className={`mt-1 ${NOTE}`}>{`${view.session.refusedCount} bypass request${view.session.refusedCount === 1 ? ' was' : 's were'} refused or ignored.`}</p> : null}
        {blocks?.timeout === true ? <p className="mt-1 text-xs text-warning-text">Bypass requests are timed out for this session.</p> : null}
      </section>
      <section aria-label="Request a bypass" className="flex flex-col gap-2 px-3 py-2">
        <p className={NOTE}>To get a bypass today, copy a command above and run it in the session: the module grants nothing, you answer the plugin dialog there.</p>
        <div>
          <DisabledWrite label="Add bypass" icon="add" />
        </div>
      </section>
    </div>
  );
}
