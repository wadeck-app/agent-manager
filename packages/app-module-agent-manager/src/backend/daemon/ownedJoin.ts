import type { Session, StatusGroup } from '@wadeck-app/agent-manager-core';
// violations-suppress: ts/no-deep-relative the module's own commons/ contract, one level above this subfolder
import type { ApiError } from '../../commons/api.js';
import type { OwnedView } from './daemonApi.js';
import type { OwnedSource } from './ownedSource.js';

/** The fields a row of GET /sessions gets from the daemon (see SessionRowDto). */
export interface OwnedRowFields {
  launchedBy: 'agent-manager' | 'discovered';
  ownedId?: string;
  host: 'stream-json' | 'hc' | 'bg' | null;
  ownedState?: OwnedView['state'];
  /** The state the daemon sent when this module does not know it (ownedState is then 'unknown'). */
  ownedRawState?: string;
  pendingPermissions: number;
  forkedFrom?: string;
  registryPending?: true;
}

export const DISCOVERED: OwnedRowFields = { launchedBy: 'discovered', host: null, pendingPermissions: 0 };

/** The registry file name a session made from an owned record alone reports. */
export const NO_REGISTRY_FILE = '(no registry file yet)';

function folderOf(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter((part) => part !== '');
  return parts[parts.length - 1] ?? cwd;
}

/** The last moment something happened to the owned session: the "status updated" time of a row made from the record. */
function lastChangeOf(view: OwnedView): number {
  return Math.max(view.startedAt, view.exit?.at ?? 0, view.interruptedAt ?? 0, view.resumedAt ?? 0, view.lastResult?.at ?? 0, ...view.messages.map((message) => message.at));
}

function statusOf(view: OwnedView): { status: string; statusGroup: StatusGroup; waitingFor?: string } {
  const { state } = view;
  if (state === 'idle') {
    return { status: 'idle', statusGroup: 'idle' };
  }
  if (state === 'running') {
    return { status: 'busy', statusGroup: 'busy' };
  }
  if (state === 'requires_action') {
    return { status: 'waiting', statusGroup: 'other', waitingFor: view.waitingFor ?? 'permission prompt' };
  }
  // An hc terminal that has no registry file yet is booting: the daemon does not see it, so no state is invented.
  if (state === 'unobserved') {
    return { status: 'starting', statusGroup: 'other' };
  }
  if (state === 'exited' || state === 'interrupted') {
    return { status: state, statusGroup: 'other' };
  }
  // A state of a newer daemon ('unknown', the raw value is in the row): shown as such, never an exception that would blank the list.
  return { status: 'unknown', statusGroup: 'other' };
}

/**
 * A Session for an owned record that has no registry file (a stream-json child writes it with its first message). It carries what the record knows; the
 * registry-only fields (procStart, peer protocol, socket) are absent, and `file` says why. `alive` is the daemon's word (the child is live), not a pid check.
 */
export function sessionFromOwned(view: OwnedView, now: number): Session {
  const changed = lastChangeOf(view);
  const { status, statusGroup, waitingFor } = statusOf(view);
  return {
    file: NO_REGISTRY_FILE,
    pid: view.pid ?? 0,
    sessionId: view.id,
    cwd: view.cwd,
    folder: folderOf(view.cwd),
    startedAt: view.startedAt,
    version: view.claudeVersion,
    ...(view.hostKind === 'stream-json' ? { kind: 'interactive', entrypoint: 'sdk-cli' } : view.hostKind === 'bg' ? { kind: 'bg', entrypoint: 'cli' } : {}),
    ...(view.name === undefined ? {} : { name: view.name }),
    status,
    statusGroup,
    ...(waitingFor === undefined ? {} : { waitingFor }),
    updatedAt: changed,
    statusUpdatedAt: changed,
    statusAgeMs: Math.max(0, now - changed),
    alive: view.status === 'live',
    livenessCheck: 'pid-only',
  };
}

/**
 * The registry row of an owned session, corrected where the daemon knows better: a permission request is answered `waiting` at once (the registry still
 * said `busy` when read at the request, measured in round 2), and the name given at launch shows when the registry has none or only the one Claude Code derived.
 */
export function overlayOwned(session: Session, view: OwnedView): Session {
  const waiting = view.state === 'requires_action' && session.status !== 'waiting';
  return {
    ...session,
    ...(waiting ? { status: 'waiting', statusGroup: 'other' as const, waitingFor: view.waitingFor ?? 'permission prompt' } : {}),
    ...(view.name !== undefined && registryNameYields(session) ? { name: view.name } : {}),
  };
}

/**
 * True when the name chosen at launch (the daemon record) wins over the registry name: the registry has none, or Claude Code derived it itself
 * (`nameSource: 'derived'`, measured for a stream-json child: the folder name plus a suffix). Any other source (`user`, `peer`, a value of a newer
 * Claude Code) is a deliberate rename made later, so the registry name stays.
 */
function registryNameYields(session: Session): boolean {
  return session.name === undefined || session.nameSource === 'derived';
}

export function rowFieldsOf(view: OwnedView, registryPending: boolean): OwnedRowFields {
  return {
    launchedBy: 'agent-manager',
    ownedId: view.id,
    host: view.hostKind,
    ownedState: view.state,
    ...(view.rawState === undefined ? {} : { ownedRawState: view.rawState }),
    pendingPermissions: view.pendingPermissions,
    ...(view.forkedFrom === undefined ? {} : { forkedFrom: view.forkedFrom }),
    ...(registryPending ? { registryPending: true as const } : {}),
  };
}

/** Stays in the default list although its process is gone: an interrupted session, and an exited one that can be resumed (a stop by the user or the end of the daemon: the stop dialog promises it). */
function staysListed(view: OwnedView): boolean {
  return view.state === 'interrupted' || (view.state === 'exited' && view.resumable);
}

export interface JoinedSessions {
  /** The registry sessions (corrected) followed by the owned sessions that have no registry file. */
  sessions: Session[];
  /** The owned fields of each session, by lower-case session id; a session of the registry that is not owned is absent. */
  fields: Map<string, OwnedRowFields>;
  /** Sessions that stay in the list even when dead (`show=alive`): the ones a resume brings back (interrupted, or exited and resumable). */
  keep: Set<string>;
  /** Set when the daemon could not be asked: every row is then 'discovered' and the owned sessions without a registry file are missing. */
  ownedError: ApiError | null;
}

/** Joins the registry sessions with the owned records by session id. One daemon call (cached by the client); a daemon error is data (`ownedError`), the registry rows stay. */
export async function joinOwned(registry: readonly Session[], source: OwnedSource, now: number): Promise<JoinedSessions> {
  const listed = await source.list();
  if (!listed.ok) {
    return { sessions: [...registry], fields: new Map(), keep: new Set(), ownedError: listed.error };
  }
  const byId = new Map(listed.sessions.map((view) => [view.id.toLowerCase(), view]));
  const fields = new Map<string, OwnedRowFields>();
  const keep = new Set<string>();
  const sessions: Session[] = [];
  const seen = new Set<string>();
  for (const session of registry) {
    const id = session.sessionId.toLowerCase();
    seen.add(id);
    const view = byId.get(id);
    if (view === undefined) {
      sessions.push(session);
      continue;
    }
    sessions.push(overlayOwned(session, view));
    fields.set(id, rowFieldsOf(view, false));
    if (staysListed(view)) {
      keep.add(id);
    }
  }
  for (const view of listed.sessions) {
    const id = view.id.toLowerCase();
    if (seen.has(id)) {
      continue;
    }
    // An owned record with no registry file: listed from the record alone while it is live or can be resumed; another exited one only when the dead are asked for.
    sessions.push(sessionFromOwned(view, now));
    fields.set(id, rowFieldsOf(view, true));
    if (view.status === 'live' || staysListed(view)) {
      keep.add(id);
    }
  }
  return { sessions, fields, keep, ownedError: null };
}
