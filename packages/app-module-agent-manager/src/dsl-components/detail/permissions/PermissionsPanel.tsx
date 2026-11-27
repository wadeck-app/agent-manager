import { ButtonAction, IconButton } from '@wadeck-app/dsl-ui';
import { Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { failureText, MODE_CHOICES, PAGE_BASE, PageLink, requestJson, useNow, type AgentRow, type CliGrantDto, type GrantAddedDto, type GrantRevokedDto } from '../deps.js';
import { BlockedSection } from './BlockedSection.js';
import { CliGrantList } from './CliGrantList.js';
import { AddBypassDialog } from './AddBypassDialog.js';
import { GrantList } from './GrantList.js';
import { RulesSection } from './RulesSection.js';
import { SECTION } from './sectionSpacing.js';
import type { SessionGrantsFeed } from './useSessionGrants.js';
import { useSessionRules } from './useSessionRules.js';

const NOTE = 'text-xs text-muted';

const WARN = 'border-b border-warning bg-warning-bg px-3 py-1.5 text-xs text-warning-text';

/**
 * The Permissions tab of the right rail: the bypasses of this session as the plugin's own admin CLI lists them (GET /guardrails/sessions/:id/grants), each with a
 * Revoke button (confirmation, then the PIN-gated POST); the bypasses of the other sessions of its project (read from the plugin files, GET /guardrails/overview,
 * read-only); the categories that blocked the session with a button that copies the command to run in the session; Add bypass (a dialog, PIN-gated route, T-23);
 * the rules of the plugin for its folder, collapsed. Without the admin CLI the bypasses of this session are read from the files, Add and Revoke are off, and the
 * panel says so. Every absence is said in words.
 */
export function PermissionsPanel({ session, feed }: { session: AgentRow; feed: SessionGrantsFeed }) {
  const now = useNow(15_000);
  const { overview, view, error, loading, reload, cli } = feed;
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [rulesTick, setRulesTick] = useState(0);
  const rules = useSessionRules(session.sessionId, rulesTick);
  const [outcome, setOutcome] = useState({ done: '', warning: '', failed: '' });
  // The PIN dialog comes from the shell fetcher (the route is a sensitive route); the answer says what was removed, or why nothing was.
  const refresh = (): void => {
    reload();
    setRulesTick((value) => value + 1);
  };
  const added = (result: GrantAddedDto): void => {
    setAdding(false);
    const length = result.mode === 'once' ? 'for one use' : `for ${MODE_CHOICES.find((choice) => choice.value === result.mode)?.label ?? result.mode}`;
    setOutcome({ done: `Added a ${result.category} bypass ${length} (${result.id}). It is listed below.`, warning: result.auditError, failed: '' });
    refresh();
  };
  // True when the PIN-gated request went through (a group of bypasses stops at the first one that did not).
  const revoke = async (grant: CliGrantDto): Promise<boolean> => {
    setBusy(true);
    setOutcome({ done: '', warning: '', failed: '' });
    const result = await requestJson<GrantRevokedDto>(`/guardrails/grants/${grant.id}/revoke`, { method: 'POST', body: { sessionId: session.sessionId } });
    setBusy(false);
    if (!result.ok || !result.value.ok) {
      setOutcome({ done: '', warning: '', failed: `The ${grant.category} bypass ${grant.id} was not revoked. ${result.ok ? failureText(result.value, 200) : result.text}` });
      reload();
      return false;
    }
    setOutcome({ done: `Revoked the ${grant.category} bypass (${grant.id}). The guardrail applies again to this session.`, warning: result.value.auditError, failed: '' });
    reload();
    return true;
  };
  return (
    <div data-permissions-panel="" className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <PageLink to={`${PAGE_BASE}/guardrails`} label="Guardrails page" />
        <IconButton size="icon-xs" aria-label="Refresh the permissions" disabled={loading} onClick={refresh} icon={<RefreshCw aria-hidden="true" className={`h-3 w-3 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} />} />
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
      {outcome.done === '' ? null : (
        <p role="status" className="border-b border-border bg-surface px-3 py-1.5 text-xs text-content">
          {outcome.done}
        </p>
      )}
      {outcome.warning === '' ? null : (
        <p role="alert" className={WARN}>
          {outcome.warning}
        </p>
      )}
      {outcome.failed === '' ? null : (
        <p role="alert" className={WARN}>
          {outcome.failed}
        </p>
      )}
      {cli.kind === 'loading' ? <p className={`px-3 py-2 ${NOTE}`}>Reading the bypasses of this session from the plugin...</p> : null}
      {cli.kind === 'ok' ? <CliGrantList grants={cli.data.grants} cwdNote={cli.data.cwdNote} busy={busy} onRevoke={revoke} /> : null}
      {cli.kind === 'error' ? (
        <section aria-label="This session" className={SECTION}>
          <p role="alert" className={WARN}>
            {`The bypasses of this session could not be read from the plugin: ${cli.text}`}
          </p>
          {cli.cwdNote === '' ? null : <p className={`px-3 py-1 break-words ${NOTE}`}>{cli.cwdNote}</p>}
        </section>
      ) : null}
      {cli.kind === 'missing' ? (
        <p className={`border-b border-border px-3 py-1.5 ${NOTE}`}>
          <span className="font-medium text-warning-text">read from files (admin CLI not found)</span>
          {` ${cli.text} Revoke needs the w-guardrails admin CLI (plugin 1.29.0 or later): install or update the plugin, then refresh.`}
        </p>
      ) : null}
      {view !== undefined ? (
        <>
          {cli.kind === 'missing' ? <GrantList title="This session" grants={view.mine} empty="No active bypass for this session." now={now} showSession={false} /> : null}
          <GrantList
            title="Other sessions of this project"
            grants={view.project}
            empty={session.cwd === '' ? 'The folder of this session is unknown, so its project cannot be matched.' : 'No active bypass for the other sessions of this project.'}
            now={now}
            showSession
          />
        </>
      ) : null}
      <BlockedSection session={session} view={view} />
      <section aria-label="Request a bypass" className={`${SECTION} flex flex-col gap-2 px-3`}>
        <p className={NOTE}>Add a bypass for this session here (your PIN is asked), or copy a command above and run it in the session: you then answer the plugin dialog there.</p>
        <div>
          <ButtonAction variant="secondary" size="sm" disabled={cli.kind !== 'ok'} icon={<Plus aria-hidden="true" className="h-3.5 w-3.5" />} label="Add bypass" onClick={() => setAdding(true)} />
        </div>
        {cli.kind === 'missing' ? <p className={NOTE}>Add bypass needs the w-guardrails admin CLI (plugin 1.29.0 or later): install or update the plugin, then refresh.</p> : null}
        {cli.kind === 'error' ? <p className={NOTE}>Add bypass is off while the plugin answers with an error (see the alert above): fix it, then refresh.</p> : null}
      </section>
      <RulesSection rules={rules} />
      {adding && cli.kind === 'ok' ? <AddBypassDialog session={session} folder={cli.data.cwd === '' ? session.cwd : cli.data.cwd} rules={rules} onClose={() => setAdding(false)} onAdded={added} /> : null}
    </div>
  );
}
