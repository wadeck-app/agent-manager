import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ownedDto, ownedRow, row } from '../logic/fixtures.js';
import { rowFromOwned } from '../logic/owned.js';
import { OWNED_TTL_MS, reflectedByPoll, useOwnedRows } from './useOwnedRows.js';

const ID = '22222222-2222-4222-8222-222222222222';

describe('rowFromOwned', () => {
  it('builds a starting row from the daemon record alone: no transcript, no invented fields', () => {
    // violations-suppress: shared/no-out-of-repo-path a Windows path as the user types it, never read from disk
    const made = rowFromOwned(ownedDto({ id: ID, cwd: 'C:\\Projects\\shop', name: 'Billing', claudeVersion: '2.1.325 (Claude Code)', pid: 77 }), 5000);
    expect(made).toMatchObject({
      sessionId: ID,
      displayName: 'Billing',
      folder: 'shop',
      pid: 77,
      harness: 'Claude Code 2.1.325',
      state: 'idle',
      alive: true,
      launchedBy: 'agent-manager',
      host: 'stream-json',
      ownedState: 'idle',
      registryPending: true,
      lastActivity: '',
    });
    expect(made.activityNote).toMatch(/No transcript yet/);
    expect(made.model).toBeUndefined();
  });

  it('maps the owned states to the list states', () => {
    expect(rowFromOwned(ownedDto({ state: 'requires_action', pendingPermissions: 1 }), 0).state).toBe('needs-you');
    expect(rowFromOwned(ownedDto({ state: 'running' }), 0).state).toBe('working');
    expect(rowFromOwned(ownedDto({ state: 'interrupted', status: 'interrupted' }), 0)).toMatchObject({ state: 'ended', alive: false });
  });
});

describe('useOwnedRows', () => {
  it('lists a launched session before its registry file exists, and drops the local copy when the poll has it', () => {
    const polled = [row({ folder: 'other' })];
    const { result, rerender } = renderHook(({ rows }) => useOwnedRows(rows), { initialProps: { rows: polled } });
    act(() => result.current.apply({ kind: 'launched', session: ownedDto({ id: ID }) }));
    expect(result.current.rows.map((candidate) => candidate.sessionId)).toEqual([ID, polled[0]!.sessionId]);
    expect(result.current.rows[0]?.registryPending).toBe(true);
    const real = ownedRow({ sessionId: ID, registryPending: undefined, lastActivity: 'Bash: npm test' });
    rerender({ rows: [...polled, real] });
    // The poll's row wins, once.
    expect(result.current.rows.filter((candidate) => candidate.sessionId === ID)).toEqual([real]);
    rerender({ rows: polled });
    expect(result.current.rows.map((candidate) => candidate.sessionId)).toEqual([polled[0]!.sessionId]);
  });

  it('shows the state a Stop or Resume returned until the poll says the same, and hides a forgotten row', () => {
    const base = ownedRow({ sessionId: ID, ownedState: 'idle' });
    const { result, rerender } = renderHook(({ rows }) => useOwnedRows(rows), { initialProps: { rows: [base] } });
    act(() => result.current.apply({ kind: 'updated', session: ownedDto({ id: ID, state: 'exited', status: 'exited' }) }));
    expect(result.current.rows[0]).toMatchObject({ ownedState: 'exited', alive: false, state: 'ended' });
    rerender({ rows: [{ ...base, ownedState: 'exited', alive: false, state: 'ended' }] });
    rerender({ rows: [{ ...base, ownedState: 'idle' }] });
    // Reflected once: a later change of the server is no longer hidden by the local copy.
    expect(result.current.rows[0]?.ownedState).toBe('idle');
    act(() => result.current.apply({ kind: 'forgotten', id: ID }));
    expect(result.current.rows).toHaveLength(0);
  });

  it('knows what the poll reflects, and the local change expires', () => {
    expect(reflectedByPoll([], { kind: 'forgotten', id: ID })).toBe(true);
    expect(reflectedByPoll([ownedRow({ sessionId: ID })], { kind: 'forgotten', id: ID })).toBe(false);
    expect(reflectedByPoll([ownedRow({ sessionId: ID, ownedState: 'idle' })], { kind: 'updated', session: ownedDto({ id: ID, state: 'running' }) })).toBe(false);
    expect(OWNED_TTL_MS).toBeGreaterThan(5000);
  });
});
