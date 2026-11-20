import { getErrorMessage } from '@wadeck-app/agent-manager-core';
import type { HostKind } from '@wadeck-app/agent-manager-core/launch';
// violations-suppress: ts/no-deep-relative the module's own commons/ contract, one level above this subfolder
import type { ApiError } from '../../commons/api.js';
import { DaemonError } from './daemonApi.js';
import type { OwnedView } from './daemonApi.js';
import type { DaemonApi } from './daemonApi.js';

/** The answer of a question to the daemon: the data, or the error as data (the routes show it, they never turn it into an empty list). */
export type OwnedResult<T> = ({ ok: true } & T) | { ok: false; error: ApiError };

/** `message. hint` in one line: the `errorText` of the answers and the sentence of a 404 that names the daemon. */
export const errorTextOf = ({ message, hint }: { message: string; hint: string }): string => `${message}. ${hint}`;

/** The error object of the routes for a failed daemon call: the daemon's reason as `message`, its fix as `hint`. */
export function apiErrorOf(error: DaemonError): ApiError {
  return { code: error.code, message: error.reason, hint: error.fix };
}

/** Delivery links remembered at most this many (the daemon keeps 50 messages per session anyway). */
const MAX_DELIVERIES = 500;

/**
 * What the routes know about the sessions of the daemon: the list (one daemon call per cache window, see DaemonApi.list), the host kinds seen at the last
 * successful list (so that a session whose daemon just died still says "owned: the daemon is not running" instead of falling back to another transport), and
 * which daemon message belongs to which reply (for the delivery state).
 */
export interface OwnedSource {
  readonly daemon: DaemonApi;
  list(): Promise<OwnedResult<{ sessions: OwnedView[] }>>;
  /** `view` is undefined when the daemon does not know the session. */
  find(sessionId: string): Promise<OwnedResult<{ view: OwnedView | undefined }>>;
  /** The host kind of a session at the last successful list; undefined when it was never seen as owned. */
  lastKnownHost(sessionId: string): HostKind | undefined;
  rememberDelivery(messageId: string, sessionId: string, uuid: string): void;
  deliveryOf(messageId: string): { sessionId: string; uuid: string } | undefined;
}

export function createOwnedSource(daemon: DaemonApi): OwnedSource {
  const known = new Map<string, HostKind>();
  const deliveries = new Map<string, { sessionId: string; uuid: string }>();
  const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
  // A local function, not a method of the returned object: the source can be destructured or passed as a callback.
  async function list(): Promise<OwnedResult<{ sessions: OwnedView[] }>> {
    try {
      const sessions = await daemon.list();
      known.clear();
      for (const view of sessions) {
        known.set(view.id.toLowerCase(), view.hostKind);
      }
      return { ok: true, sessions };
    } catch (error) {
      if (error instanceof DaemonError) {
        return { ok: false, error: apiErrorOf(error) };
      }
      // Not a daemon problem: a bug of this module. It is data like the others (the page keeps working, the list says why owned sessions are missing).
      return { ok: false, error: { code: 'daemon-client-error', message: `the module failed while asking the daemon (${getErrorMessage(error)})`, hint: 'This is a bug of the agent-manager module: report it with the app-core log.' } };
    }
  }
  return {
    daemon,
    list,
    async find(sessionId) {
      const listed = await list();
      return listed.ok ? { ok: true, view: listed.sessions.find((view) => same(view.id, sessionId)) } : listed;
    },
    lastKnownHost: (sessionId) => known.get(sessionId.toLowerCase()),
    rememberDelivery(messageId, sessionId, uuid) {
      if (deliveries.size >= MAX_DELIVERIES) {
        // Oldest first (Map keeps the insertion order).
        const oldest = deliveries.keys().next();
        if (oldest.done !== true) {
          deliveries.delete(oldest.value);
        }
      }
      deliveries.set(messageId, { sessionId, uuid });
    },
    deliveryOf: (messageId) => deliveries.get(messageId),
  };
}
