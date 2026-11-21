import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LAUNCH_PREFS, LAUNCH_STORAGE_KEY, cwdProblem, launchBody, nameProblem, readLaunchPrefs, saveLaunchPrefs } from './launchForm.js';

afterEach(() => window.localStorage.clear());

describe('cwdProblem', () => {
  it('accepts Windows drive, UNC and POSIX absolute paths, and an empty text (the button waits instead)', () => {
    // violations-suppress: shared/no-out-of-repo-path a Windows path as the user types it, never read from disk
    for (const ok of ['C:\\Projects\\shop', 'c:/projects/shop', '\\\\server\\share\\shop', '/home/me/shop', '']) {
      expect(cwdProblem(ok)).toBe('');
    }
  });

  it('refuses a relative path with the reason and what to give', () => {
    expect(cwdProblem('shop')).toMatch(/absolute path/);
    expect(cwdProblem('..\\shop')).toMatch(/absolute path/);
    expect(cwdProblem('~/shop')).toMatch(/absolute path/);
  });

  it('refuses control characters and a path over the limit', () => {
    // violations-suppress: shared/no-out-of-repo-path a Windows path as the user types it, never read from disk
    expect(cwdProblem('C:\\a\nb')).toMatch(/single line/);
    // violations-suppress: shared/no-out-of-repo-path a Windows path as the user types it, never read from disk
    expect(cwdProblem(`C:\\${'a'.repeat(1030)}`)).toMatch(/limit is 1024/);
  });
});

describe('nameProblem', () => {
  it('accepts any short single-line name for a Web session, and nothing', () => {
    expect(nameProblem('', 'stream-json')).toBe('');
    expect(nameProblem('Billing fix (urgent)', 'stream-json')).toBe('');
  });

  it('holds a Terminal session name to the shape of an hc terminal name', () => {
    expect(nameProblem('billing-fix_2', 'hc')).toBe('');
    expect(nameProblem('Billing fix', 'hc')).toMatch(/1 to 32 characters/);
    expect(nameProblem('a'.repeat(33), 'hc')).toMatch(/1 to 32 characters/);
    expect(nameProblem('x'.repeat(65), 'stream-json')).toMatch(/limit is 64/);
  });
});

describe('launchBody', () => {
  it('sends only the fields that have a value, trimmed', () => {
    // violations-suppress: shared/no-out-of-repo-path a Windows path as the user types it, never read from disk
    expect(launchBody({ hostKind: 'stream-json', cwd: '  C:\\shop ', model: '', permissionMode: '', name: ' ' })).toEqual({ hostKind: 'stream-json', cwd: 'C:\\shop' });
    expect(launchBody({ hostKind: 'hc', cwd: '/shop', model: 'haiku', permissionMode: 'plan', name: 'fix' })).toEqual({ hostKind: 'hc', cwd: '/shop', model: 'haiku', permissionMode: 'plan', name: 'fix' });
  });
});


describe('remembered choices', () => {
  it('start with the defaults, keep what was saved, and survive a reload', () => {
    expect(readLaunchPrefs()).toEqual(DEFAULT_LAUNCH_PREFS);
    expect(saveLaunchPrefs({ hostKind: 'hc', model: 'haiku', permissionMode: 'plan' })).toBe('');
    expect(JSON.parse(window.localStorage.getItem(LAUNCH_STORAGE_KEY) ?? '{}')).toEqual({ hostKind: 'hc', model: 'haiku', permissionMode: 'plan' });
    expect(readLaunchPrefs()).toEqual({ hostKind: 'hc', model: 'haiku', permissionMode: 'plan' });
  });

  it('replaces a field it does not know, and ignores corrupt storage, instead of breaking the dialog', () => {
    window.localStorage.setItem(LAUNCH_STORAGE_KEY, JSON.stringify({ hostKind: 'carrier-pigeon', model: 'haiku', permissionMode: 'bypass-everything' }));
    expect(readLaunchPrefs()).toEqual({ hostKind: 'stream-json', model: 'haiku', permissionMode: '' });
    window.localStorage.setItem(LAUNCH_STORAGE_KEY, '{not json');
    expect(readLaunchPrefs()).toEqual(DEFAULT_LAUNCH_PREFS);
  });
});
