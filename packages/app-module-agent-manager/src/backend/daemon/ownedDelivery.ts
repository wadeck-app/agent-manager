import type { AuditRecord, DeliveryStatus, ReplyTranscriptEntry } from '@wadeck-app/agent-manager-core/reply';
import type { OwnedMessage } from './daemonApi.js';

/** A transcript line this much before the send still counts (the clocks of the daemon, Claude Code and this process differ a little). */
const CLOCK_TOLERANCE_MS = 1000;

function textOf(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : typeof (part as { text?: unknown })?.text === 'string' ? (part as { text: string }).text : '')).join('\n');
  }
  return '';
}

function timeOf(entry: ReplyTranscriptEntry): number | undefined {
  const value = entry.timestamp;
  const time = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : undefined;
}

/** Line endings and the spaces around the lines do not make a different message. */
function normalize(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

/** The text the session received: the text, then one line per image (see composeMessageText, here without a marker). */
function composedText(record: AuditRecord): string {
  return [record.text, ...record.imagePaths.map((path) => `The user attached an image: ${path}. Read it.`)].filter((part) => part !== '').join('\n');
}

/**
 * The delivery state of a reply sent through the `owned` transport, from the evidence there is; undefined when there is none (the caller then uses the generic
 * state: 'sent', and the "probably not delivered" hint after a while). Order of the evidence:
 *  1. the message the daemon tracks for this reply (`command_lifecycle`: started / completed confirm, cancelled and lost do not; a state this module does not
 *     know is said, not guessed);
 *  2. a user line of the transcript whose WHOLE text equals the reply (normalized) or the composed reply with its image lines, written at or after the send
 *     (1 s of clock tolerance), without an `origin` (a prompt of the stream is `promptSource:"sdk"` with no origin; a line with an origin was typed by a person
 *     or sent by a peer). Each line confirms one reply: `claimed` holds the lines already used, so two identical replies ("ok", "ok") need two lines.
 */
export function ownedDeliveryStatus(record: AuditRecord, daemonMessage: OwnedMessage | undefined, transcript: readonly ReplyTranscriptEntry[], claimed: Set<ReplyTranscriptEntry> = new Set()): DeliveryStatus | undefined {
  if (daemonMessage !== undefined) {
    const { state } = daemonMessage;
    if (state === 'started' || state === 'completed') {
      return { state: 'confirmed', reason: `the daemon reports that Claude Code ${state === 'started' ? 'started' : 'completed'} the message (command_lifecycle)` };
    }
    if (state === 'cancelled') {
      return { state: 'unconfirmed', reason: 'an interrupt dropped the message before it started (command_lifecycle: cancelled)', hint: 'The message did not run. Send it again if it is still wanted.' };
    }
    if (state === 'lost') {
      return { state: 'unconfirmed', reason: 'the claude process ended before it started the message', hint: 'The message did not run. Resume the session, then send it again if it is still wanted.' };
    }
    // A state of a newer daemon: said as it is, the delivery is neither confirmed nor failed. ('queued' falls through to the transcript.)
    if (state !== 'queued') {
      return { state: 'sent', reason: `the daemon reports a message state this module does not know (${JSON.stringify(daemonMessage.rawState ?? state)}): the delivery is not confirmed` };
    }
  }
  const wanted = new Set([normalize(record.text), normalize(composedText(record))]);
  wanted.delete('');
  if (wanted.size === 0) {
    return undefined;
  }
  for (const entry of transcript) {
    if (entry.type !== 'user' || claimed.has(entry) || entry.origin?.kind !== undefined) {
      continue;
    }
    const time = timeOf(entry);
    if (time !== undefined && time >= record.time - CLOCK_TOLERANCE_MS && wanted.has(normalize(textOf(entry.message?.content ?? entry.content)))) {
      claimed.add(entry);
      return { state: 'confirmed', reason: 'a user line with the exact text of the reply is in the transcript (no marker on this transport: matched by the whole text and the time)' };
    }
  }
  return undefined;
}
