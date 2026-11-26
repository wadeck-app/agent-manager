import { ButtonAction, Tooltip } from '@wadeck-app/dsl-ui';
import { CircleAlert, CircleCheck, CircleX, LoaderCircle, ShieldOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { requestJson } from '../data/http.js';
import type { AgentRow } from '../data/types.js';
import { CopyButton } from '../detail/log/CopyButton.js';
import type { BatchRevokeOk, BatchRevokeResult, BatchRevokeStatus, CliGrantDto } from '../shared.js';
import { Banner } from '../ui/Banner.js';
import { DialogActions } from '../ui/DialogActions.js';
import { Modal } from '../ui/Modal.js';
import { StyledCheckbox } from '../ui/StyledCheckbox.js';
import { bypassesOf, groupGrants, MAX_BATCH_GRANT_SESSIONS, MAX_BATCH_REVOKE_ITEMS, revokeConfirmLine, revokeResultsText, revokeSummaryText, sessionsOf, type GrantEntry } from './batchBypass.js';
import { useBatchGrants } from './useBatchReads.js';

const STATUS_LOOK: Record<BatchRevokeStatus, { icon: typeof CircleCheck; tone: string; words: string }> = {
  revoked: { icon: CircleCheck, tone: 'text-success-text', words: 'Revoked' },
  refused: { icon: CircleX, tone: 'text-danger-text', words: 'Refused, nothing revoked' },
  failed: { icon: CircleAlert, tone: 'text-danger-text', words: 'Failed' },
};

function newRequestId(): string {
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const keyOf = (entry: GrantEntry): string => `${entry.sessionId}|${entry.grant.id}`;

/** "once, 1 use left" or "30 min mode, 12 min left" in few words: what tells two bypasses of one category apart. */
function grantWords(grant: CliGrantDto): string {
  const uses = grant.usesLeft === null ? '' : `, ${grant.usesLeft} use${grant.usesLeft === 1 ? '' : 's'} left`;
  return `${grant.mode === 'once' ? 'once' : 'time-boxed'}, ${grant.remainingText} left${uses}`;
}

export interface BatchRemoveBypassDialogProps {
  /** The selected sessions, in the order of the list. */
  rows: readonly AgentRow[];
  onClose: () => void;
}

/**
 * Remove bypasses of the selected sessions (threat-model T-24). It reads the active bypasses of every selected session (one read each, with progress), groups them
 * by category, and revokes the ones the user ticks, nothing ticked at first. The route is PIN-gated; each bypass is proven to be its session's by the plugin's list.
 */
export function BatchRemoveBypassDialog({ rows, onClose }: BatchRemoveBypassDialogProps) {
  const grants = useBatchGrants(rows);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [requestId, setRequestId] = useState(newRequestId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<BatchRevokeResult[] | undefined>(undefined);

  const groups = useMemo(() => groupGrants(grants.entries), [grants.entries]);
  const chosen = grants.entries.filter((entry) => ticked.has(keyOf(entry)));
  const tooMany = rows.length > MAX_BATCH_GRANT_SESSIONS;
  const block = tooMany
    ? `A batch has at most ${MAX_BATCH_GRANT_SESSIONS} sessions: untick ${rows.length - MAX_BATCH_GRANT_SESSIONS}, then do the rest in a second batch.`
    : grants.loading
      ? 'Reading the bypasses of the sessions...'
      : chosen.length === 0
        ? 'Tick the bypasses to remove.'
        : chosen.length > MAX_BATCH_REVOKE_ITEMS
          ? `A batch removes at most ${MAX_BATCH_REVOKE_ITEMS} bypasses: untick ${chosen.length - MAX_BATCH_REVOKE_ITEMS}.`
          : '';

  // A new choice is a new request: the same id would make the server answer the previous results.
  const setTick = (keys: readonly string[], on: boolean): void => {
    setTicked((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (on) {
          next.add(key);
        } else {
          next.delete(key);
        }
      }
      return next;
    });
    setRequestId(newRequestId());
  };

  const submit = async (): Promise<void> => {
    if (block !== '' || busy) {
      return;
    }
    setBusy(true);
    setError('');
    const result = await requestJson<BatchRevokeOk>('/guardrails/batch/revoke', { method: 'POST', body: { requestId, items: chosen.map((entry) => ({ sessionId: entry.sessionId, grantId: entry.grant.id })) } });
    setBusy(false);
    if (!result.ok) {
      // The same requestId makes the next click safe: the server answers the earlier results, nothing is revoked twice.
      setError(result.text === '' ? '' : `${result.text.replace(/\.$/, '')}. If some bypasses were removed before the failure, pressing the button again is safe.`);
      return;
    }
    if (result.value.ok !== true || !Array.isArray(result.value.results)) {
      setError('The answer of the server has no results. Reload the page; if it persists, update agent-manager and restart app-core.');
      return;
    }
    setResults(result.value.results);
  };

  const title = `Remove bypasses from ${sessionsOf(rows.length)}`;

  if (results !== undefined) {
    return (
      <Modal title={title} size="wide" onClose={onClose}>
        <div className="flex flex-col gap-3" data-batch-results="">
          <p role="status" data-batch-summary="" className="text-sm font-medium text-content">
            {revokeSummaryText(results)}
          </p>
          <ul aria-label="Results" className="flex flex-col divide-y divide-border rounded border border-border">
            {results.map((result) => {
              const look = STATUS_LOOK[result.status];
              const Icon = look.icon;
              return (
                <li key={`${result.sessionId}|${result.grantId}`} data-result-status={result.status} className="flex items-start gap-2 px-3 py-2 text-sm">
                  <Icon aria-hidden="true" className={`mt-0.5 h-am-icon-sm w-am-icon-sm shrink-0 ${look.tone}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-content">{`${result.name}${result.category === '' ? '' : `: ${result.category}`}`}</p>
                    <p className={`text-xs ${look.tone}`}>{look.words}</p>
                    {result.text === '' ? null : <p className="break-words text-xs text-muted">{result.text}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
          <DialogActions>
            <CopyButton text={revokeResultsText(results)} label="Copy the results" />
            <ButtonAction variant="primary" label="Close" onClick={onClose} />
          </DialogActions>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={title} size="wide" onClose={onClose} dismissible={!busy}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="text-sm text-content">Tick the bypasses to remove: the guardrail applies again to that session at once. You are asked for your PIN once, when you confirm.</p>
        {grants.loading ? (
          <p role="status" className="text-sm text-muted">
            {`Reading the bypasses: ${grants.done} of ${grants.total} sessions...`}
          </p>
        ) : null}
        {grants.problems.map((item) => (
          <Banner key={item.names.join('|')} tone="error">{`${item.names.join(', ')}: ${item.text} Its bypasses are not listed below.`}</Banner>
        ))}
        {grants.loading || grants.empty.length === 0 ? null : <p className="text-sm text-muted">{`${grants.empty.join(', ')} ${grants.empty.length === 1 ? 'has' : 'have'} no active bypass.`}</p>}
        {!grants.loading && grants.entries.length === 0 && grants.problems.length === 0 ? <Banner tone="info">None of the selected sessions has an active bypass: there is nothing to remove.</Banner> : null}
        {groups.map((group) => {
          const keys = group.entries.map(keyOf);
          const all = keys.every((key) => ticked.has(key));
          const some = keys.some((key) => ticked.has(key));
          return (
            <section key={group.category} role="group" aria-label={group.category} className="rounded border border-border">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <StyledCheckbox aria-label={`Select all ${group.category} bypasses`} checked={all} indeterminate={some && !all} disabled={busy} onChange={() => setTick(keys, !all)} />
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-content">{group.category}</p>
                <p className="text-xs text-muted">{bypassesOf(group.entries.length)}</p>
              </div>
              <ul className="flex flex-col divide-y divide-border">
                {group.entries.map((entry) => (
                  <li key={keyOf(entry)} data-grant={entry.grant.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                    <StyledCheckbox aria-label={`Remove ${group.category} of ${entry.name}`} checked={ticked.has(keyOf(entry))} disabled={busy} onChange={() => setTick([keyOf(entry)], !ticked.has(keyOf(entry)))} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-content">{entry.name}</p>
                      <p className="break-words text-xs text-muted">{grantWords(entry.grant)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {chosen.length === 0 ? null : <p className="text-sm font-medium text-content">{revokeConfirmLine(chosen)}</p>}
        {tooMany || (block !== '' && !grants.loading && chosen.length > MAX_BATCH_REVOKE_ITEMS) ? <p className="text-xs text-warning-text">{block}</p> : null}
        {error === '' ? null : <Banner tone="error">{error}</Banner>}
        {busy ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircle aria-hidden="true" className="h-am-icon-sm w-am-icon-sm animate-spin motion-reduce:animate-none" />
            Waiting for the PIN and the plugin...
          </p>
        ) : null}
        <DialogActions>
          <ButtonAction variant="secondary" label="Cancel" onClick={onClose} disabled={busy} />
          <Tooltip content={block === '' ? 'Asks the PIN once for the whole batch' : block}>
            <span className="inline-flex">
              <ButtonAction variant="danger" type="submit" icon={<ShieldOff aria-hidden="true" className="h-4 w-4" />} label={chosen.length === 0 ? 'Remove bypasses' : `Remove ${bypassesOf(chosen.length)}`} disabled={block !== '' || busy} />
            </span>
          </Tooltip>
        </DialogActions>
      </form>
    </Modal>
  );
}
