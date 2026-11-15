import type { SessionRowDto } from '../shared.js';

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
    seen: true,
    reason: '',
    lastActivity: '',
    activityNote: '',
    subagentCount: 0,
    harness: 'Claude Code 2.1.325',
    harnessVariant: 'success',
    version: '2.1.325',
    ...overrides,
  };
}
