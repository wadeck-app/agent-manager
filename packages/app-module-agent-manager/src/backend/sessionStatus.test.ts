import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activeBypasses, bypassesOf, cachedRoleOf, ROLE_CACHE_MS, clearStatusCaches, formatLeft, gitBranchOf, parseBypassFile, roleOf, statusOf } from './sessionStatus.js';
import type { Session } from '@wadeck-app/agent-manager-core';

const NOW = Date.UTC(2026, 10, 15, 12, 0, 0);
const SID = '287760ca-77b9-418b-bd68-c242d65b4d67';
const minutes = (n: number): string => new Date(NOW + n * 60_000).toISOString();

// The bypass file is the state of the guardrails hook: no test writes one (not even in a temp folder). The parsing is tested on text, the reading only for
// the file that does not exist.
describe('activeBypasses (shapes of the bypass overrides, rules of statusline-bypass-lib.js)', () => {
  const entry = (category: string, expiresInMin: number, extra: Record<string, unknown> = {}) => ({ session_id: SID, decision: 'allow', category, expires: minutes(expiresInMin), ...extra });

  it('keeps this session only, not expired, allow only; c&p with the time left, sorted by label', () => {
    const overrides = [
      entry('git-commit-push', 112),
      entry('kill', 10),
      { ...entry('rm', 30), session_id: 'someone-else' },
      entry('python', -5),
      { ...entry('npm', 30), decision: 'deny' },
      null,
    ];
    expect(activeBypasses(overrides, SID, NOW)).toEqual([
      { category: 'git-commit-push', label: 'c&p', left: '1h52m', leftMs: 112 * 60_000 },
      { category: 'kill', label: 'kill', left: '10m', leftMs: 10 * 60_000 },
    ]);
  });

  it('a commit and a push together are the combined c&p limited by the shorter one; the entry expiring last wins per category', () => {
    const combined = activeBypasses([entry('git-commit', 30), entry('git-push', 90), entry('git-commit', 60)], SID, NOW);
    expect(combined).toEqual([{ category: 'git-commit-push', label: 'c&p', left: '1h', leftMs: 60 * 60_000 }]);
  });

  it('a spent once bypass (used >= max_uses) is not active and does not hide a usable one; the count never goes below 0', () => {
    const once = (category: string, extra: Record<string, unknown>) => entry(category, 30, { mode: 'once', ...extra });
    expect(activeBypasses([once('kill', { max_uses: 1, used: 1 })], SID, NOW)).toEqual([]);
    expect(activeBypasses([once('kill', { max_uses: 2, used: 5 })], SID, NOW)).toEqual([]);
    // The spent entry expires later than the usable one: it must not win the category.
    const spent = { ...once('kill', { max_uses: 1, used: 1 }), expires: minutes(60) };
    expect(activeBypasses([spent, once('kill', { max_uses: 3, used: 1 })], SID, NOW)).toEqual([{ category: 'kill', label: 'kill', left: '2x' }]);
    expect(activeBypasses([once('kill', {})], SID, NOW)).toEqual([{ category: 'kill', label: 'kill', left: '1x' }]);
  });

  it('a "once" bypass counts uses', () => {
    expect(activeBypasses([entry('rm', 30, { mode: 'once', max_uses: 3, used: 1 })], SID, NOW)).toEqual([{ category: 'rm', label: 'rm', left: '2x' }]);
  });

  it('overrides that is not an array is an error, never an empty list', () => {
    expect(() => activeBypasses({}, SID, NOW)).toThrow('overrides is not an array');
    expect(() => activeBypasses(undefined, SID, NOW)).toThrow('overrides is not an array');
  });

  it('formats the time left like the status line', () => {
    expect(formatLeft(30_000)).toBe('<1m');
    expect(formatLeft(59 * 60_000)).toBe('59m');
    expect(formatLeft(2 * 3_600_000)).toBe('2h');
    expect(formatLeft(3_600_000 + 5 * 60_000)).toBe('1h5m');
  });

  it('the text of the file: a valid one gives the list, a malformed one or one without overrides gives an explicit error', () => {
    const file = '/w/bypass-file';
    expect(parseBypassFile(JSON.stringify({ overrides: [entry('git-commit-push', 112)] }), file, SID, NOW)).toEqual({ bypasses: [{ category: 'git-commit-push', label: 'c&p', left: '1h52m', leftMs: 112 * 60_000 }] });
    expect(parseBypassFile(JSON.stringify({ overrides: [entry('kill', 10)] }), file, 'another-session', NOW)).toEqual({ bypasses: [] });
    const truncated = parseBypassFile('{"overrides": [', file, SID, NOW);
    expect(truncated.bypasses).toBeUndefined();
    expect(truncated.error).toMatch(/^The bypass file \/w\/bypass-file cannot be read: .*Fix or delete it/);
    expect(parseBypassFile('{"overrides": 3}', file, SID, NOW).error).toContain('overrides is not an array');
    expect(parseBypassFile('null', file, SID, NOW).error).toContain('overrides is not an array');
  });
});

describe('files of the working directory', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agent-manager-status-'));
    clearStatusCaches();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });

  it('role: read from the folder or a parent, "role-" dropped; none is undefined; a broken file or id is a visible marker', async () => {
    const project = join(root, 'repo', 'sub');
    mkdirSync(project, { recursive: true });
    expect(await roleOf(project, SID)).toBeUndefined();
    const rolesDir = join(root, 'repo', '.claude', 'session', 'roles');
    mkdirSync(rolesDir, { recursive: true });
    writeFileSync(join(rolesDir, SID), 'role-autonomous-worker\n');
    expect(await roleOf(project, SID)).toBe('autonomous-worker');
    writeFileSync(join(rolesDir, SID), 'not a role');
    expect(await roleOf(project, SID)).toMatch(/^!role-err:.*does not hold a role name$/);
    expect(await roleOf(project, '../../etc')).toBe('!role-err:unexpected session id format');
    expect(await roleOf(project, 'a/b')).toBe('!role-err:unexpected session id format');
  });

  it('role is cached per folder and session for ROLE_CACHE_MS: a change is seen after the window, not before', async () => {
    const project = join(root, 'repo');
    const rolesDir = join(project, '.claude', 'session', 'roles');
    mkdirSync(rolesDir, { recursive: true });
    writeFileSync(join(rolesDir, SID), 'role-first\n');
    expect(await cachedRoleOf(project, SID, NOW)).toBe('first');
    writeFileSync(join(rolesDir, SID), 'role-second\n');
    // Inside the window nothing is read again (the file already says "second").
    expect(await cachedRoleOf(project, SID, NOW + ROLE_CACHE_MS - 1)).toBe('first');
    expect(await cachedRoleOf(project, SID, NOW + ROLE_CACHE_MS)).toBe('second');
  });

  it('bypasses: no file is "none" (undefined), not an error; a relative or empty working directory is not looked at', async () => {
    expect(await bypassesOf(root, SID, NOW)).toEqual({});
    expect(await bypassesOf('relative/dir', SID, NOW)).toEqual({});
    expect(await bypassesOf('', SID, NOW)).toEqual({});
  });

  it('git branch: the current branch of a real repository, nothing for a folder that is not one or does not exist, cached for 10 s', async () => {
    const repo = join(root, 'repo');
    mkdirSync(repo, { recursive: true });
    const git = (...args: string[]): void => {
      execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore', windowsHide: true });
    };
    git('init', '-q', '-b', 'feature-x');
    expect(await gitBranchOf(repo, NOW)).toEqual({ branch: 'feature-x' });
    git('checkout', '-q', '-b', 'other');
    // Still the cached answer inside the window, the new one after it.
    expect(await gitBranchOf(repo, NOW + 5_000)).toEqual({ branch: 'feature-x' });
    expect(await gitBranchOf(repo, NOW + 11_000)).toEqual({ branch: 'other' });
    const plain = join(root, 'plain');
    mkdirSync(plain);
    expect(await gitBranchOf(plain, NOW)).toEqual({});
    expect(await gitBranchOf(join(root, 'gone'), NOW)).toEqual({});
    expect(await gitBranchOf('relative/path', NOW)).toEqual({});
  });

  it('statusOf: the duration since startedAt, the role and the notes of what is missing', async () => {
    const rolesDir = join(root, '.claude', 'session', 'roles');
    mkdirSync(rolesDir, { recursive: true });
    writeFileSync(join(rolesDir, SID), 'role-project-manager');
    const session = { sessionId: SID, cwd: root, startedAt: NOW - 2 * 3_600_000 } as Session;
    const status = await statusOf(session, undefined, 'No transcript yet', NOW);
    expect(status).toMatchObject({ durationMs: 2 * 3_600_000, role: 'project-manager', statusNote: 'No transcript yet' });
    expect(status.bypasses).toBeUndefined();
    expect(status.model).toBeUndefined();
    expect('gitBranch' in status).toBe(false);
    const noStart = await statusOf({ sessionId: SID, cwd: root } as Session, undefined, '', NOW);
    expect(noStart.durationMs).toBeUndefined();
    expect(noStart.statusNote).toContain('No assistant message');
  });
});
