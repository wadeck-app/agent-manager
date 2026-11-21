import type { OwnedSessionDto, SessionRowDto } from '../shared.js';

let counter = 0;

/** One row of GET /sessions for tests and stories: every field filled, the given ones overridden. Ids are unique per call. */
export function row(overrides: Partial<SessionRowDto> = {}): SessionRowDto {
  counter += 1;
  const hex = counter.toString(16).padStart(12, '0');
  const folder = overrides.folder ?? 'shop';
  return {
    sessionId: `00000000-0000-4000-8000-${hex}`,
    displayName: folder,
    folder,
    cwd: `/work\\${folder}`,
    pid: 1000 + counter,
    status: 'idle',
    alive: true,
    statusUpdatedAt: 1_000_000,
    state: 'idle',
    pinned: false,
    pinOrder: -1,
    customGroupId: null,
    customGroupOrder: -1,
    seen: true,
    reason: '',
    lastActivity: '',
    activityNote: '',
    subagentCount: 0,
    launchedBy: 'discovered',
    host: null,
    pendingPermissions: 0,
    harness: 'Claude Code 2.1.325',
    harnessVariant: 'success',
    version: '2.1.325',
    ...overrides,
  };
}

/** One owned session record as the daemon reports it (GET /owned), for tests and stories. */
export function ownedDto(overrides: Partial<OwnedSessionDto> = {}): OwnedSessionDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    hostKind: 'stream-json',
    cwd: '/work/shop',
    claudeVersion: '2.1.325 (Claude Code)',
    startedAt: 1_000_000,
    status: 'live',
    state: 'idle',
    resumable: false,
    pendingPermissions: 0,
    messages: [],
    ...overrides,
  };
}

/** A row of a session launched from agent-manager: a live Web session unless the overrides say otherwise. */
export function ownedRow(overrides: Partial<SessionRowDto> = {}): SessionRowDto {
  return row({ launchedBy: 'agent-manager', host: 'stream-json', ownedState: 'idle', ...overrides });
}
