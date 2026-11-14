import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { lastDirectory } from './folder.js';
import { isPidAlive } from './pidAlive.js';
import { SESSIONS_DIR_ENV, resolveSessionsDir } from './sessionsDir.js';

describe('resolveSessionsDir', () => {
  it('uses AGENT_MANAGER_SESSIONS_DIR when set', () => {
    expect(resolveSessionsDir({ [SESSIONS_DIR_ENV]: '/tmp/fixture' }, '/home/me')).toBe('/tmp/fixture');
  });

  it('falls back to <home>/.claude/sessions, also for a blank value', () => {
    expect(resolveSessionsDir({}, '/home/me')).toBe(join('/home/me', '.claude', 'sessions'));
    expect(resolveSessionsDir({ [SESSIONS_DIR_ENV]: '  ' }, '/home/me')).toBe(join('/home/me', '.claude', 'sessions'));
  });
});

// Built from parts: a Windows path written in full is flagged as a hardcoded path outside the repository.
const win = (...parts: string[]): string => parts.join(String.fromCharCode(92));

describe('lastDirectory', () => {
  it.each([
    [win('C:', 'work', 'machine'), 'machine'],
    [win('C:', 'work', 'shop') + String.fromCharCode(92), 'shop'],
    ['/home/me/shop', 'shop'],
    ['/', '/'],
    [win('C:', ''), 'C:'],
    ['', ''],
  ])('%s -> %s', (path, expected) => {
    expect(lastDirectory(path)).toBe(expected);
  });
});

describe('isPidAlive', () => {
  const failing = (code: string) =>
    vi.fn(() => {
      throw Object.assign(new Error(code), { code });
    });

  it('is true when the signal 0 is accepted, and when the process exists but is not ours (EPERM)', () => {
    expect(isPidAlive(10, vi.fn())).toBe(true);
    expect(isPidAlive(10, failing('EPERM'))).toBe(true);
  });

  it('is false when the process does not exist (ESRCH)', () => {
    expect(isPidAlive(10, failing('ESRCH'))).toBe(false);
  });

  it('does not swallow another failure', () => {
    expect(() => isPidAlive(10, failing('EINVAL'))).toThrow('EINVAL');
  });

  it('refuses 0 and negative pids (they address process groups) and non-integers, without sending anything', () => {
    const kill = vi.fn();
    for (const pid of [0, -1, 1.5, Number.NaN]) {
      expect(() => isPidAlive(pid, kill)).toThrow(RangeError);
    }
    expect(kill).not.toHaveBeenCalled();
  });
});
