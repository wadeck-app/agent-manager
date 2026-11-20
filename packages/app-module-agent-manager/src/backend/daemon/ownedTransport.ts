import { getErrorMessage } from '@wadeck-app/agent-manager-core';
import type { Session } from '@wadeck-app/agent-manager-core';
import { OutcomeUnknownError, ReplyError } from '@wadeck-app/agent-manager-core/reply';
import type { ProbeCheck, ProbeResult, ReplyMessage, ReplyTransport, SendResult } from '@wadeck-app/agent-manager-core/reply';
import { DaemonError, START_COMMAND } from './daemonApi.js';
import type { OwnedView } from './daemonApi.js';
import { apiErrorOf } from './ownedSource.js';
import type { OwnedSource } from './ownedSource.js';

/*
 * The `owned` reply transport: the daemon writes the message into the stdin of the claude child it owns (stream-json frame). Only for a session launched by
 * agent-manager as `stream-json`; an owned `hc` session keeps the `hc` transport (the daemon does not observe its terminal).
 *
 * How the session sees the message (measured, research/session-launch-options.md round 1): `promptSource:"sdk"`, `turnOrigin:"sdk"`, no `origin` field, no
 * wrapper: a plain prompt from the user, so `deliveredAs: 'typed'` (it has the authority of the user: T-07 applies as for hc). How the auto-mode classifier
 * treats `promptSource:"sdk"`: UNKNOWN.
 * No origin marker (`marker: 'none'`, D-2026-11-19-a): the confirmation comes from the daemon (`command_lifecycle` of the message uuid) and, when the
 * link to that uuid is lost (the module restarted), from the transcript (a user line with the same text).
 * Priority: 'now' is the daemon interrupt (the running turn stops, queued messages stay), then the text is sent as the next message. There is no text hack.
 * 'next' and 'later' are the same here: the message is queued and runs when the turn ends (the stream has no lower lane).
 */

export const OWNED_TRANSPORT_ID = 'owned';

const stateText = (view: OwnedView): string => `${view.state}${view.status === 'live' ? '' : ` (${view.status})`}`;

/** The ReplyError of a daemon failure: its code, reason and fix, so that the reply route answers with the fix of the daemon. */
function replyErrorOf(error: DaemonError): ReplyError {
  const api = apiErrorOf(error);
  // A timeout or a lost connection on the send: the daemon may have queued the message. Not a failure to retry: look at the log first.
  if (error.outcomeUnknown) {
    return new OutcomeUnknownError(api.code, `${api.message} (the message may have been delivered)`, 'check the log of the session before sending it again; a second send would be a duplicate prompt if the first one arrived');
  }
  return new ReplyError(api.code, api.message, api.hint);
}

export function createOwnedTransport(source: OwnedSource): ReplyTransport {
  return {
    id: OWNED_TRANSPORT_ID,
    kind: 'direct',
    deliveredAs: 'typed',
    marker: 'none',
    describe: () => 'writes into the claude process owned by the agent-manager daemon (sessions launched by agent-manager as stream-json); confirmed by the daemon',
    async probe(session: Session): Promise<ProbeResult> {
      const found = await source.find(session.sessionId);
      if (!found.ok) {
        const { message, hint } = found.error;
        const checks: ProbeCheck[] = [{ name: 'daemon', ok: false, detail: message }];
        return { available: false, reason: `the agent-manager daemon cannot be asked: ${message}`, fix: hint, details: { checks } };
      }
      const checks: ProbeCheck[] = [{ name: 'daemon', ok: true, detail: 'the daemon answered' }];
      const { view } = found;
      if (view === undefined) {
        checks.push({ name: 'owned', ok: false, detail: 'the daemon has no session with this id' });
        return { available: false, reason: 'this session was not launched by agent-manager: the daemon does not know it', fix: 'use the socket or hc transport, or launch the session from agent-manager', details: { checks } };
      }
      checks.push({ name: 'owned', ok: true, detail: `owned, ${view.hostKind}` });
      if (view.hostKind !== 'stream-json') {
        checks.push({ name: 'host', ok: false, detail: `host ${view.hostKind}` });
        return { available: false, reason: `this owned session runs in a herdr-core terminal (${view.hostKind}): the daemon does not observe or write to it`, fix: 'use the hc transport', details: { checks, ownedState: view.state } };
      }
      if (view.state === 'exited' || view.state === 'interrupted') {
        checks.push({ name: 'live', ok: false, detail: stateText(view) });
        return { available: false, reason: view.state === 'interrupted' ? 'the daemon that owned this session ended while it was live: its claude process ended with it' : 'the claude process of this owned session ended', fix: 'resume the session (POST /owned/:id/resume); the conversation continues, the lost turn is not replayed', details: { checks, ownedState: view.state } };
      }
      checks.push({ name: 'live', ok: true, detail: stateText(view) });
      const warnings: string[] = [];
      if (view.state === 'requires_action') {
        warnings.push(`the session waits for ${view.pendingPermissions} permission decision(s): a message is queued until they are answered`);
      }
      return { available: true, reason: `the daemon owns this session (${view.state}) and writes into its stdin`, fix: '', details: { checks, ownedState: view.state, ...(warnings.length === 0 ? {} : { warnings }) } };
    },
    async send(session: Session, message: ReplyMessage): Promise<SendResult> {
      if (message.priority === 'now') {
        // The service required confirmNow for this: the user agreed that the running turn is stopped. The daemon interrupt, never a text.
        // A failure here is a plain failure whatever its kind: nothing was sent yet, so the message can be sent again (only the send below can be "maybe sent").
        try {
          await source.daemon.interrupt(session.sessionId);
        } catch (error) {
          if (error instanceof DaemonError) {
            const api = apiErrorOf(error);
            throw new ReplyError(api.code, `the interrupt before the message failed, nothing was sent: ${api.message}`, api.hint);
          }
          throw error;
        }
      }
      try {
        const sent = await source.daemon.send(session.sessionId, message.text);
        source.rememberDelivery(message.id, session.sessionId, sent.uuid);
        return { accepted: true, detail: `queued by the daemon (message ${sent.uuid})`, sentAt: Date.now(), handle: sent.uuid };
      } catch (error) {
        if (error instanceof DaemonError) {
          throw replyErrorOf(error);
        }
        throw new ReplyError('owned-send-failed', `the owned transport failed (${getErrorMessage(error)})`, `check that the daemon runs (\`agent-manager status\`), or run \`${START_COMMAND}\``);
      }
    },
  };
}
