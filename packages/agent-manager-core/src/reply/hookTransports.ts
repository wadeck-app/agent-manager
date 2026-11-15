import type { Session } from '../session.js';
import { NotImplementedError } from './errors.js';
import type { DeliveredAs, ProbeResult, ReplyMessage, ReplyTransport, SendResult, TransportKind } from './types.js';

const PLAN = '.claude/plans/2026-11-14_agent-manager-v1.md';
const MILESTONE = `planned in milestone M4 (reply transports) of ${PLAN}`;

/**
 * An interface-complete transport that is not built yet. probe() says so (available: false, with the milestone); send() throws NotImplementedError:
 * nothing can look sent when it was not (no silent success, no silent fallback).
 */
function stubTransport(id: string, kind: TransportKind, deliveredAs: DeliveredAs, description: string): ReplyTransport {
  return {
    id,
    kind,
    // UNVERIFIED for a transport that is not built: the value is the expectation, not a measurement.
    deliveredAs,
    describe: () => `${description} (NOT IMPLEMENTED YET)`,
    probe(_session: Session): Promise<ProbeResult> {
      return Promise.resolve({
        available: false,
        reason: 'not implemented yet',
        fix: `${MILESTONE}; switch this session to the 'socket' transport meanwhile`,
        details: { implemented: false, milestone: 'M4', plan: PLAN },
      });
    },
    send(_session: Session, _message: ReplyMessage): Promise<SendResult> {
      return Promise.reject(new NotImplementedError(id, MILESTONE));
    },
  };
}

/** A hook that exits with an asyncRewake code wakes the session when a reply is waiting (measured 3/3, first event about 117 ms). */
export const asyncRewakeTransport: ReplyTransport = stubTransport('async-rewake', 'mailbox', 'peer', 'asyncRewake hook: a background hook wakes the session when a reply is waiting in the daemon mailbox');

/** A blocking Stop hook waits for the reply while the turn is open (does not wake an idle session). */
export const hotWaitTransport: ReplyTransport = stubTransport('hot-wait', 'mailbox', 'peer', 'hot-wait: a blocking Stop hook holds the turn open and hands the reply over');

/** w-agent-wake style queue mod (agent.message). */
export const queueModTransport: ReplyTransport = stubTransport('queue-mod', 'mailbox', 'peer', 'queue mod: w-agent-wake delivers an agent.message into the session');

/** herdr pane.send_text, for sessions inside a herdr pane only. */
export const herdrTransport: ReplyTransport = stubTransport('herdr', 'direct', 'typed', 'herdr adapter: types the reply into the pane of the session with pane.send_text');
