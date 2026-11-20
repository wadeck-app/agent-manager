import type { AgentState, OwnedHostKind, OwnedSessionDto, OwnedStateDto, SessionRowDto } from '../shared.js';

/** The label of a host, the same word everywhere (rows, header, dialog). */
export const HOST_LABEL: Record<OwnedHostKind, string> = { 'stream-json': 'Web', hc: 'Terminal' };

/** What the host means, for the tooltip of its badge. */
export const HOST_MEANING: Record<OwnedHostKind, string> = {
  'stream-json': 'Web session: started from agent-manager as a child of its daemon. Structured log, permission requests are answered in this page.',
  hc: 'Terminal session: started from agent-manager in a herdr-core terminal. The real Claude Code screen, permission requests are answered in that terminal.',
};

export function isOwned(session: Pick<SessionRowDto, 'launchedBy'>): boolean {
  return session.launchedBy === 'agent-manager';
}

/** An owned session the daemon hosts itself (stream-json): the one that has permission cards, Stop, Resume and a permission mode. */
export function isWebOwned(session: Pick<SessionRowDto, 'launchedBy' | 'host'>): boolean {
  return session.launchedBy === 'agent-manager' && session.host === 'stream-json';
}

/** A live stream-json child: it can be interrupted and stopped, its mode changed. */
export function isLiveWeb(session: Pick<SessionRowDto, 'launchedBy' | 'host' | 'ownedState'>): boolean {
  return isWebOwned(session) && (session.ownedState === 'idle' || session.ownedState === 'running' || session.ownedState === 'requires_action');
}

export type ChipTone = 'attention' | 'working' | 'warning' | 'muted';

export interface OwnedStateChip {
  label: string;
  tone: ChipTone;
  meaning: string;
  /** True for a state the state icon of the row already says (running, ready): the list leaves it out, the header shows it. */
  quiet: boolean;
}

/**
 * The owned-state chip of a session, undefined when there is nothing to add (a discovered session, an hc terminal the daemon does not observe, a ready
 * session). A session with no registry file yet reads "Starting" until its first message creates it.
 */
export function ownedStateChip(session: Pick<SessionRowDto, 'launchedBy' | 'ownedState' | 'ownedRawState' | 'registryPending' | 'pendingPermissions'>): OwnedStateChip | undefined {
  if (session.launchedBy !== 'agent-manager' || session.ownedState === undefined) {
    return undefined;
  }
  switch (session.ownedState) {
    case 'requires_action': {
      const count = session.pendingPermissions;
      return { label: count > 1 ? `Waiting for permission (${count})` : 'Waiting for permission', tone: 'attention', meaning: 'The agent asks to use a tool and waits for your Allow or Deny.', quiet: false };
    }
    case 'running':
      return { label: 'Running', tone: 'working', meaning: 'The agent is working on a turn.', quiet: true };
    case 'interrupted':
      return { label: 'Interrupted', tone: 'warning', meaning: 'The daemon that ran this session ended while it was live. Resume restores the conversation; the turn that was running is not replayed.', quiet: false };
    case 'exited':
      return { label: 'Exited', tone: 'muted', meaning: 'The claude process of this session ended.', quiet: false };
    case 'idle':
    case 'unobserved':
      return session.registryPending === true ? { label: 'Starting...', tone: 'muted', meaning: 'The session has no registry file yet: Claude Code writes it with the first message.', quiet: false } : undefined;
    case 'unknown':
      break;
  }
  // 'unknown' is a state of a newer daemon, and a value outside the contract is one this page does not know either: shown with its raw text, never guessed, never thrown
  // (a render that throws blanks the whole page).
  return { label: `unknown: ${session.ownedRawState ?? String(session.ownedState)}`, tone: 'warning', meaning: 'The daemon reports a state this page does not know (a newer daemon?). Update the module, or check agent-manager status.', quiet: false };
}

/** The registry-like state a row of an owned session gets from the daemon's state (what the backend derives for a row it builds from the record alone). */
function stateFromOwned(state: OwnedStateDto, live: boolean): AgentState {
  if (state === 'unknown') {
    return 'other';
  }
  if (!live) {
    return 'ended';
  }
  switch (state) {
    case 'requires_action':
      return 'needs-you';
    case 'running':
      return 'working';
    case 'idle':
      return 'idle';
    case 'exited':
    case 'interrupted':
      return 'ended';
    case 'unobserved':
      return 'other';
  }
  // Any state this page does not know: the list shows it in its own group with the raw status, never an exception.
  return 'other';
}

function folderOf(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter((part) => part !== '');
  return parts[parts.length - 1] ?? cwd;
}

function versionOf(claudeVersion: string): string | undefined {
  return /\d+(?:\.\d+)+/.exec(claudeVersion)?.[0];
}

/**
 * A row for a session the user just launched, made from the daemon's answer, shown until the next poll of GET /sessions brings the real one (the backend then
 * builds the same kind of row from the owned record: registryPending). Nothing is invented: no transcript yet, no model, the status follows the owned state.
 */
export function rowFromOwned(dto: OwnedSessionDto, now: number): SessionRowDto {
  const live = dto.status === 'live';
  const folder = folderOf(dto.cwd);
  const version = versionOf(dto.claudeVersion);
  return {
    sessionId: dto.id,
    displayName: dto.name ?? folder,
    folder,
    cwd: dto.cwd,
    pid: dto.pid ?? 0,
    harness: version === undefined ? 'Claude Code' : `Claude Code ${version}`,
    harnessVariant: 'default',
    ...(version === undefined ? {} : { version }),
    status: dto.state === 'running' ? 'busy' : dto.state === 'requires_action' ? 'waiting' : dto.state === 'idle' ? 'idle' : dto.state === 'unobserved' ? 'starting' : dto.state,
    alive: live,
    statusUpdatedAt: now,
    state: stateFromOwned(dto.state, live),
    pinned: false,
    pinOrder: -1,
    seen: true,
    reason: dto.state === 'requires_action' ? 'permission prompt' : '',
    lastActivity: '',
    activityNote: 'No transcript yet: Claude Code writes it with the first message.',
    subagentCount: 0,
    launchedBy: 'agent-manager',
    ownedId: dto.id,
    host: dto.hostKind,
    ownedState: dto.state,
    ...(dto.rawState === undefined ? {} : { ownedRawState: dto.rawState }),
    pendingPermissions: dto.pendingPermissions,
    registryPending: true,
  };
}

/** The row with what the daemon just said about the session (the answer of Stop or Resume), until the next poll says the same. */
export function applyOwnedDto(row: SessionRowDto, dto: OwnedSessionDto): SessionRowDto {
  const live = dto.status === 'live';
  return {
    ...row,
    alive: live,
    ownedState: dto.state,
    ...(dto.rawState === undefined ? {} : { ownedRawState: dto.rawState }),
    pendingPermissions: dto.pendingPermissions,
    state: stateFromOwned(dto.state, live),
    status: dto.state === 'running' ? 'busy' : dto.state === 'requires_action' ? 'waiting' : dto.state === 'idle' ? 'idle' : dto.state,
  };
}
