import { describe, expect, it } from 'vitest';
import type { Session } from '@wadeck-app/agent-manager-core';
import { ownedView } from './fakeDaemon.js';
import { overlayOwned } from './ownedJoin.js';

const ID = '00000000-0000-4000-8000-000000000321';

function registrySession(over: Partial<Session>): Session {
  return {
    file: '321.json',
    pid: 321,
    sessionId: ID,
    cwd: '/work/am-real1',
    folder: 'am-real1',
    startedAt: 1_000_000,
    status: 'idle',
    statusGroup: 'idle',
    updatedAt: 1_000_000,
    statusUpdatedAt: 1_000_000,
    statusAgeMs: 0,
    alive: true,
    livenessCheck: 'pid-only',
    ...over,
  } as Session;
}

describe('overlayOwned name precedence', () => {
  const view = ownedView({ id: ID, name: 'real-x1-test' });

  it('shows the launch name when the registry has no name', () => {
    expect(overlayOwned(registrySession({}), view).name).toBe('real-x1-test');
  });

  it('replaces the name Claude Code derived (folder name plus a suffix)', () => {
    expect(overlayOwned(registrySession({ name: 'am-real1-b7', nameSource: 'derived' }), view).name).toBe('real-x1-test');
  });

  it('keeps a name set by the user in Claude Code', () => {
    expect(overlayOwned(registrySession({ name: 'renamed', nameSource: 'user' }), view).name).toBe('renamed');
  });

  it('keeps a name set by a peer, or from a source this version does not know', () => {
    expect(overlayOwned(registrySession({ name: 'by-peer', nameSource: 'peer' }), view).name).toBe('by-peer');
    expect(overlayOwned(registrySession({ name: 'other', nameSource: 'future-source' }), view).name).toBe('other');
  });

  it('keeps the derived name when the record has no name', () => {
    expect(overlayOwned(registrySession({ name: 'am-real1-b7', nameSource: 'derived' }), ownedView({ id: ID })).name).toBe('am-real1-b7');
  });
});
