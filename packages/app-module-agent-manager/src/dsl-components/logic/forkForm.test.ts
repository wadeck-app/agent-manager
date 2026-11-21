import { describe, expect, it } from 'vitest';
import { forkBlockedReason, forkBody, forkBusyWarning, forkNameDefault, modelAliasOf } from './forkForm.js';

describe('fork form helpers', () => {
  it('names the fork "fork of <name>" and cuts it to the 64 characters the daemon accepts', () => {
    expect(forkNameDefault({ displayName: 'shop' })).toBe('fork of shop');
    const long = forkNameDefault({ displayName: 'y'.repeat(100) });
    expect(long).toHaveLength(64);
    expect(long.endsWith('...')).toBe(true);
  });

  it('maps a model to the alias of its family, and to nothing when the family is not an alias of the dialog', () => {
    expect(modelAliasOf({ id: 'anthropic.claude-haiku-4-5-20251001-v1:0', displayName: 'Haiku 4.5' })).toBe('haiku');
    expect(modelAliasOf({ displayName: 'Opus 5.5 (1M context)' })).toBe('opus');
    expect(modelAliasOf({ displayName: 'Sonnet 5.5' })).toBe('sonnet');
    expect(modelAliasOf({ id: 'some-other-model', displayName: 'some-other-model' })).toBe('');
    expect(modelAliasOf(undefined)).toBe('');
  });

  it('blocks a session without message (no transcript) with the reason, and a session without folder', () => {
    expect(forkBlockedReason({ registryPending: true, cwd: '/work' })).toContain('no message yet');
    expect(forkBlockedReason({ cwd: '' })).toContain('no working folder');
    expect(forkBlockedReason({ cwd: '/work' })).toBeUndefined();
  });

  it('warns for a working or waiting source only', () => {
    expect(forkBusyWarning({ state: 'working' })).toContain('as written so far');
    expect(forkBusyWarning({ state: 'needs-you' })).toContain('permission request');
    expect(forkBusyWarning({ state: 'idle', ownedState: 'running' })).toBeDefined();
    expect(forkBusyWarning({ state: 'idle' })).toBeUndefined();
    expect(forkBusyWarning({ state: 'ended' })).toBeUndefined();
  });

  it('builds the body with the fields that have a value', () => {
    expect(forkBody({ sourceSessionId: 'a', name: ' ', model: '', permissionMode: '' })).toEqual({ sourceSessionId: 'a' });
    expect(forkBody({ sourceSessionId: 'a', name: ' try B ', model: 'haiku', permissionMode: 'plan' })).toEqual({ sourceSessionId: 'a', name: 'try B', model: 'haiku', permissionMode: 'plan' });
  });
});
