import { ButtonAction, FieldSelect, FieldText, TabButton } from '@wadeck-app/dsl-ui';
import { CircleAlert, CircleCheck, CircleX, Clock, LoaderCircle, ShieldPlus } from 'lucide-react';
import { useState } from 'react';
import { requestJson } from '../data/http.js';
import type { AgentRow } from '../data/types.js';
import { CopyButton } from '../detail/log/CopyButton.js';
import { categoryOptions, MODE_CHOICES, rationaleProblem } from '../logic/grantForm.js';
import type { BatchGrantResult, BatchGrantStatus, BatchGrantsOk, GrantModeDto } from '../shared.js';
import { Banner } from '../ui/Banner.js';
import { DialogActions } from '../ui/DialogActions.js';
import { Modal } from '../ui/Modal.js';
import { Tooltip } from '../ui/Tooltip.js';
import { grantBlockText, grantConfirmLine, grantResultsText, grantSummaryText, retryableGrantIds, sessionsOf } from './batchBypass.js';
import { SessionNames } from './SessionNames.js';
import { useBatchRules } from './useBatchReads.js';

const STATUS_LOOK: Record<BatchGrantStatus, { icon: typeof CircleCheck; tone: string; words: string }> = {
  granted: { icon: CircleCheck, tone: 'text-success-text', words: 'Granted' },
  refused: { icon: CircleX, tone: 'text-danger-text', words: 'Refused, nothing granted' },
  failed: { icon: CircleAlert, tone: 'text-danger-text', words: 'Failed' },
  'not-attempted': { icon: Clock, tone: 'text-warning-text', words: 'Not attempted' },
};

/** A new id for one request (a click on the same button again after a failure reuses it: the server then never grants twice). */
function newRequestId(): string {
  return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface BatchAddBypassDialogProps {
  /** The selected sessions, in the order of the list. */
  rows: readonly AgentRow[];
  onClose: () => void;
}

/**
 * Add the same bypass to the selected sessions (threat-model T-24). The categories offered are the ones a bypass can lift in EVERY selected folder (one rules read per
 * distinct folder); the server checks each session against its own folder again and refuses one by one. One PIN prompt covers the batch (the route is sensitive), and
 * the PIN token lives 10 minutes: when it expires the server stops, the rest is listed as not attempted, and Retry the rest is a click of the user, never automatic.
 */
export function BatchAddBypassDialog({ rows, onClose }: BatchAddBypassDialogProps) {
  const rules = useBatchRules(rows);
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<GrantModeDto>('once');
  const [reason, setReason] = useState('');
  const [requestId, setRequestId] = useState(newRequestId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<BatchGrantResult[] | undefined>(undefined);

  const category = chosen !== undefined && rules.categories.some((rule) => rule.name === chosen) ? chosen : (rules.categories[0]?.name ?? '');
  const problem = reason === '' ? '' : rationaleProblem(reason);
  const structural = grantBlockText({ count: rows.length, category, reasonProblem: '', loading: rules.loading });
  const block = structural !== '' ? structural : rationaleProblem(reason);

  // A new choice is a new request: the same id would make the server answer the previous results.
  const change = <T,>(set: (value: T) => void) => (value: T): void => {
    set(value);
    setRequestId(newRequestId());
  };

  const send = async (ids: readonly string[], id: string): Promise<void> => {
    setBusy(true);
    setError('');
    const result = await requestJson<BatchGrantsOk>('/guardrails/batch/grants', { method: 'POST', body: { requestId: id, category, mode, rationale: reason.trim(), sessions: ids } });
    setBusy(false);
    if (!result.ok) {
      // No answer: the batch may have been done in part. The same requestId makes the next click safe (the server answers the earlier results, nothing is granted twice).
      setError(result.text === '' ? '' : `${result.text.replace(/\.$/, '')}. If some bypasses were made before the failure, pressing the button again is safe: nothing is granted twice.`);
      return;
    }
    if (result.value.ok !== true || !Array.isArray(result.value.results)) {
      setError('The answer of the server has no results. Reload the page; if it persists, update agent-manager and restart app-core.');
      return;
    }
    const answered = result.value.results;
    setResults((previous) => (previous === undefined ? answered : previous.map((old) => answered.find((fresh) => fresh.sessionId.toLowerCase() === old.sessionId.toLowerCase()) ?? old)));
  };

  const retry = (): void => {
    if (results === undefined) {
      return;
    }
    const ids = retryableGrantIds(results);
    const next = newRequestId();
    setRequestId(next);
    void send(ids, next);
  };

  const names = rows.map((row) => row.displayName);
  const title = `Add a bypass to ${sessionsOf(rows.length)}`;

  if (results !== undefined) {
    const retryable = retryableGrantIds(results);
    const onlyNotAttempted = results.filter((result) => retryable.includes(result.sessionId)).every((result) => result.status === 'not-attempted');
    return (
      <Modal title={title} size="wide" onClose={onClose} dismissible={!busy}>
        <div className="flex flex-col gap-3" data-batch-results="">
          <p role="status" data-batch-summary="" className="text-sm font-medium text-content">
            {grantSummaryText(results)}
          </p>
          {error === '' ? null : <Banner tone="error">{error}</Banner>}
          <ul aria-label="Results" className="flex flex-col divide-y divide-border rounded border border-border">
            {results.map((result) => {
              const look = STATUS_LOOK[result.status];
              const Icon = look.icon;
              return (
                <li key={result.sessionId} data-result-status={result.status} className="flex items-start gap-2 px-3 py-2 text-sm">
                  <Icon aria-hidden="true" className={`mt-0.5 h-am-icon-sm w-am-icon-sm shrink-0 ${look.tone}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-content">{result.name}</p>
                    <p className={`text-xs ${look.tone}`}>{look.words}</p>
                    {result.text === '' ? null : <p className="break-words text-xs text-muted">{result.text}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
          {busy ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted">
              <LoaderCircle aria-hidden="true" className="h-am-icon-sm w-am-icon-sm animate-spin motion-reduce:animate-none" />
              Waiting for the PIN and the plugin...
            </p>
          ) : null}
          <DialogActions>
            <CopyButton text={grantResultsText(results)} label="Copy the results" />
            {retryable.length > 0 ? <ButtonAction variant="secondary" disabled={busy} label={`Retry the ${retryable.length} ${onlyNotAttempted ? 'not attempted' : 'stopped by the PIN'}`} onClick={retry} /> : null}
            <ButtonAction variant="primary" label="Close" disabled={busy} onClick={onClose} />
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
          if (block === '' && !busy) {
            void send(
              rows.map((row) => row.sessionId),
              requestId,
            );
          }
        }}
      >
        <p className="text-sm text-content">Lift one guardrail for these sessions only. You are asked for your PIN once, when you confirm.</p>
        <SessionNames names={names} />
        {rules.loading ? (
          <p role="status" className="text-sm text-muted">
            Reading the categories from the plugin...
          </p>
        ) : null}
        {rules.problems.map((item) => (
          <Banner key={item.names.join('|')} tone="warning">{`The categories could not be read for ${item.names.join(', ')}: ${item.text} They are not part of the list below; the server refuses them one by one if they stay in the batch.`}</Banner>
        ))}
        <FieldSelect label="Category" value={category} onChange={change(setChosen)} options={categoryOptions(rules.categories)} disabled={busy || rules.categories.length === 0} description="Only categories that can be bypassed in every selected folder are listed." />
        <div role="group" aria-label="Duration" className="flex flex-wrap items-center gap-1.5">
          {MODE_CHOICES.map((choice) => (
            <Tooltip key={choice.value} content={choice.meaning}>
              {/* The chosen duration is a filled button: the base tab underline alone is too faint to tell which one is on. */}
              <TabButton size="sm" type="button" variant={mode === choice.value ? 'primary' : 'ghost'} active={mode === choice.value} aria-pressed={mode === choice.value} disabled={busy} onClick={() => change(setMode)(choice.value)}>
                {choice.label}
              </TabButton>
            </Tooltip>
          ))}
        </div>
        <FieldText label="Reason" value={reason} onChange={change(setReason)} disabled={busy} autoComplete="off" required error={problem} description="It is stored as plain text and shown in the plugin journal of every session." />
        {category === '' ? null : <p className="text-sm font-medium text-content">{grantConfirmLine(category, mode, rows.length)}</p>}
        {structural === '' || rules.loading ? null : <p className="text-xs text-warning-text">{structural}</p>}
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
              <ButtonAction variant="primary" type="submit" icon={<ShieldPlus aria-hidden="true" className="h-4 w-4" />} label="Add bypass" disabled={block !== '' || busy} />
            </span>
          </Tooltip>
        </DialogActions>
      </form>
    </Modal>
  );
}
