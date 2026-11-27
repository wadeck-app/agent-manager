import { ButtonAction, FieldTextarea, Tooltip } from '@wadeck-app/dsl-ui';
import { CircleAlert, CircleCheck, CircleHelp, CircleX, Clock, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { requestJson } from '../data/http.js';
import type { AgentRow } from '../data/types.js';
import { CopyButton } from '../detail/log/CopyButton.js';
import { agentId } from '../logic/states.js';
import type { BatchRecipientResult, BatchRecipientState, BatchReplyResponse } from '../shared.js';
import { Banner } from '../ui/Banner.js';
import { DialogActions } from '../ui/DialogActions.js';
import { prose } from '../logic/prose.js';
import { Modal } from '../ui/Modal.js';
import { StyledCheckbox } from '../ui/StyledCheckbox.js';
import { MAX_BATCH_RECIPIENTS, previewText, resultsText, retryableIds, sendBlockText, STATE_WORDS, summaryText } from './batchModel.js';
import { useRecipientChecks } from './useRecipientChecks.js';

const RECIPIENTS_LIST = 'flex max-h-64 flex-col divide-y divide-border overflow-y-auto rounded border border-border';

const STATE_ICON: Record<BatchRecipientState, { icon: typeof CircleCheck; tone: string }> = {
  sent: { icon: CircleCheck, tone: 'text-success-text' },
  queued: { icon: Clock, tone: 'text-success-text' },
  refused: { icon: CircleX, tone: 'text-danger-text' },
  'maybe-sent': { icon: CircleHelp, tone: 'text-warning-text' },
  failed: { icon: CircleAlert, tone: 'text-danger-text' },
};

/** A new id for one send of the batch (a retry of the SAME send reuses it: the server then never messages a recipient twice). */
function newRequestId(): string {
  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface BatchSendDialogProps {
  /** The selected sessions, in the order of the list. */
  rows: readonly AgentRow[];
  onClose: () => void;
}

/**
 * Send one message to the selected sessions. Each recipient shows whether its transport can receive it (read from the existing reply status): the ones that
 * cannot are listed unticked with the reason. One PIN prompt covers the whole batch (the route is sensitive). The per-recipient answer replaces the form and
 * stays until the user closes it: sent, refused, maybe sent (never retried by the module) or failed, each with its reason, with a button that copies them.
 */
export function BatchSendDialog({ rows, onClose }: BatchSendDialogProps) {
  const checks = useRecipientChecks(rows);
  const [text, setText] = useState('');
  // The recipients the user unticked among the ones that can receive it.
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [phase, setPhase] = useState<'compose' | 'sending' | 'done'>('compose');
  const [requestId, setRequestId] = useState(newRequestId);
  const [results, setResults] = useState<BatchRecipientResult[] | undefined>(undefined);
  const [error, setError] = useState('');

  const eligibleOf = (row: AgentRow): 'checking' | 'ok' | 'skipped' => checks.get(agentId(row))?.state ?? 'checking';
  const included = useMemo(() => rows.filter((row) => eligibleOf(row) === 'ok' && !unticked.has(agentId(row))), [rows, checks, unticked]); // eslint-disable-line react-hooks/exhaustive-deps
  const skipped = rows.filter((row) => eligibleOf(row) === 'skipped').length;
  const checking = rows.some((row) => eligibleOf(row) === 'checking');
  const block = sendBlockText(text, included.length, checking);

  // A new text or a new set of recipients is a new send: a new request id (the same id would make the server answer "already sent" for the old text).
  const changeText = (value: string): void => {
    setText(value);
    setRequestId(newRequestId());
  };
  const toggleTick = (id: string): void => {
    setUnticked((current) => (current.has(id) ? new Set([...current].filter((other) => other !== id)) : new Set([...current, id])));
    setRequestId(newRequestId());
  };

  const send = async (ids: readonly string[], id: string): Promise<void> => {
    setPhase('sending');
    setError('');
    const result = await requestJson<BatchReplyResponse>('/sessions/batch/reply', { method: 'POST', body: { ids, text, requestId: id } });
    if (!result.ok) {
      // No answer: the batch may have been sent in part. The same request id makes a second try safe (a recipient that got it is not messaged again).
      setError(`${result.text} Some recipients may already have the message: sending again with the same button is safe, a recipient that got it is not messaged twice.`);
      setPhase('compose');
      return;
    }
    if (!result.value.ok) {
      const { message, hint } = result.value.error;
      setError(`${message.replace(/\.$/, '')}. ${hint}`);
      setPhase('compose');
      return;
    }
    setResults(result.value.results);
    setPhase('done');
  };

  const retry = (): void => {
    if (results === undefined) {
      return;
    }
    const ids = retryableIds(results);
    const next = newRequestId();
    setRequestId(next);
    void send(ids, next);
  };

  if (phase === 'done' && results !== undefined) {
    const retryable = retryableIds(results).length;
    const maybe = results.filter((result) => result.state === 'maybe-sent').length;
    return (
      <Modal title="Message sent to the selection" size="wide" onClose={onClose}>
        <div className="flex flex-col gap-3" data-batch-results="">
          <p role="status" data-batch-summary="" className="text-sm font-medium text-content">
            {summaryText(results)}
          </p>
          {maybe > 0 ? <Banner tone="warning">{maybe === 1 ? '1 recipient may' : `${maybe} recipients may`} have the message: the connection ended before the answer. Open their logs to check before sending it again, the module never retries them by itself.</Banner> : null}
          <ul aria-label="Results" className="flex flex-col divide-y divide-border rounded border border-border">
            {results.map((result) => {
              const look = STATE_ICON[result.state];
              const Icon = look.icon;
              return (
                <li key={result.id} data-result-state={result.state} className="flex items-start gap-2 px-3 py-2 text-sm">
                  <Icon aria-hidden="true" className={`mt-0.5 h-am-icon-sm w-am-icon-sm shrink-0 ${look.tone}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-content">{result.name}</p>
                    <p className={`text-xs ${look.tone}`}>{STATE_WORDS[result.state]}</p>
                    {result.reason === '' ? null : <p className="break-words text-xs text-muted">{prose(result.reason)}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
          <DialogActions>
            <CopyButton text={resultsText(results)} label="Copy the results" />
            {retryable > 0 ? <ButtonAction variant="secondary" label={`Retry the ${retryable} refused or failed`} onClick={retry} /> : null}
            <ButtonAction variant="primary" label="Close" onClick={onClose} />
          </DialogActions>
        </div>
      </Modal>
    );
  }

  const sending = phase === 'sending';
  return (
    <Modal title={`Send a message to ${rows.length} selected`} size="wide" onClose={onClose} dismissible={!sending}>
      <div className="flex flex-col gap-3">
        <FieldTextarea label="Message" value={text} onChange={changeText} rows={5} placeholder="The same text is sent to every ticked session" disabled={sending} />
        <div>
          <p className="mb-1 text-sm font-medium text-content">Recipients</p>
          <ul aria-label="Recipients" className={RECIPIENTS_LIST}>
            {rows.map((row) => {
              const id = agentId(row);
              const eligibility = checks.get(id) ?? { state: 'checking' as const };
              const ticked = eligibility.state === 'ok' && !unticked.has(id);
              return (
                <li key={id} data-recipient={id} data-eligibility={eligibility.state} className="flex items-start gap-2 px-3 py-2 text-sm">
                  <StyledCheckbox
                    aria-label={`Send to ${row.displayName}`}
                    checked={ticked}
                    disabled={eligibility.state !== 'ok' || sending}
                    onChange={() => toggleTick(id)}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-content">{row.displayName}</p>
                    {eligibility.state === 'checking' ? <p className="text-xs text-muted">Checking its transport...</p> : null}
                    {eligibility.state === 'skipped' ? (
                      <p className="break-words text-xs text-warning-text">
                        <span className="font-medium">Skipped. </span>
                        {prose(eligibility.reason)}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <p data-batch-preview="" className="text-sm text-content">
          {previewText(included.length, skipped)}
          <span className="text-muted">{` (at most ${MAX_BATCH_RECIPIENTS} per batch)`}</span>
        </p>
        {error === '' ? null : <Banner tone="error">{error}</Banner>}
        {block === '' || text.trim() === '' ? null : <p className="text-xs text-warning-text">{block}</p>}
        <DialogActions>
          <ButtonAction variant="secondary" label="Cancel" disabled={sending} onClick={onClose} />
          <Tooltip content={block === '' ? 'Asks the PIN once for the whole batch' : block}>
            <span className="inline-flex">
              <ButtonAction variant="primary" loading={sending} disabled={block !== ''} icon={<Send aria-hidden="true" className="h-4 w-4" />} label={included.length > 0 ? `Send to ${included.length}` : 'Send'} onClick={() => void send(included.map((row) => row.sessionId.toLowerCase()), requestId)} />
            </span>
          </Tooltip>
        </DialogActions>
      </div>
    </Modal>
  );
}
