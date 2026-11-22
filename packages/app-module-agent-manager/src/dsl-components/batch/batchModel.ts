import type { AgentRow } from '../data/types.js';
import { MAX_BATCH_RECIPIENTS, type BatchRecipientResult, type BatchRecipientState, type ReplyStatusResponse } from '../shared.js';

/*
 * The rules of the batch send dialog: who can receive the message, whether it can be sent, how the results read. Pure.
 */

export { MAX_BATCH_RECIPIENTS };

/** Whether a recipient can get the message: still asking the server, yes, or skipped with the reason (unchecked in the dialog, listed, never silent). */
export type Eligibility = { state: 'checking' } | { state: 'ok' } | { state: 'skipped'; reason: string };

/**
 * From the row (is the process alive) and the reply status of the session (the existing GET /sessions/:id/reply/status: the selected transport and its probe).
 * `failure` is why the status could not be read at all (network, server): the recipient is skipped with it, not guessed available.
 */
export function eligibilityOf(row: AgentRow, status: ReplyStatusResponse | undefined, failure: string | undefined): Eligibility {
  if (!row.alive) {
    return { state: 'skipped', reason: 'The session is not running, so it cannot receive a message. Resume it first.' };
  }
  if (failure !== undefined) {
    return { state: 'skipped', reason: `Its transport could not be checked: ${failure}` };
  }
  if (status === undefined) {
    return { state: 'checking' };
  }
  if (!status.ok) {
    const { message, hint } = status.error;
    return { state: 'skipped', reason: `${message.replace(/\.$/, '')}. ${hint}` };
  }
  if (!status.sessionAlive) {
    return { state: 'skipped', reason: 'The session is not running, so it cannot receive a message. Resume it first.' };
  }
  const selected = status.transports.find((transport) => transport.selected);
  if (selected === undefined) {
    return { state: 'skipped', reason: `The selected transport '${status.selectedTransportId}' is not one the module offers: ${status.warnings[0] ?? 'check transports.json'}` };
  }
  if (!selected.available) {
    return { state: 'skipped', reason: `The ${selected.transportId} transport is not available: ${selected.reason}${selected.fix === '' ? '' : `. Fix: ${selected.fix}`}` };
  }
  return { state: 'ok' };
}

/** Why the Send button is off, in words; empty when the batch can be sent. */
export function sendBlockText(text: string, included: number, checking: boolean): string {
  if (included > MAX_BATCH_RECIPIENTS) {
    return `A batch has at most ${MAX_BATCH_RECIPIENTS} recipients: untick ${included - MAX_BATCH_RECIPIENTS}, then send the rest in a second batch.`;
  }
  if (checking) {
    return 'Checking which sessions can receive the message...';
  }
  if (included === 0) {
    return 'No recipient is ticked: nobody would receive it.';
  }
  if (text.trim() === '') {
    return 'Write the message first.';
  }
  return '';
}

/** "3 will receive it". */
export function previewText(included: number, skipped: number): string {
  const head = included === 0 ? 'Nobody will receive it' : `${included} will receive it`;
  return skipped === 0 ? head : `${head}, ${skipped} skipped`;
}

export const STATE_WORDS: Record<BatchRecipientState, string> = {
  sent: 'Sent',
  queued: 'Queued',
  refused: 'Refused, nothing sent',
  'maybe-sent': 'Maybe sent',
  failed: 'Failed',
};

/** The one-line summary of the answer: "2 sent, 1 refused, 1 maybe sent". */
export function summaryText(results: readonly BatchRecipientResult[]): string {
  const order: BatchRecipientState[] = ['sent', 'queued', 'refused', 'maybe-sent', 'failed'];
  const parts = order.flatMap((state) => {
    const count = results.filter((result) => result.state === state).length;
    return count === 0 ? [] : [`${count} ${state.replace('-', ' ')}`];
  });
  return parts.join(', ');
}

/** The results as plain text, one line per recipient (the Copy results button). */
export function resultsText(results: readonly BatchRecipientResult[]): string {
  return results.map((result) => `${result.name} (${result.id}): ${STATE_WORDS[result.state]}${result.reason === '' ? '' : `. ${result.reason}`}`).join('\n');
}

/** The recipients a second batch may retry: refused or failed ones, NEVER a maybe-sent one (the message may have arrived: the user looks at its log first). */
export function retryableIds(results: readonly BatchRecipientResult[]): string[] {
  return results.filter((result) => result.state === 'refused' || result.state === 'failed').map((result) => result.id);
}
