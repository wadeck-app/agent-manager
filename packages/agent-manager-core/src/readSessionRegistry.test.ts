import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readSessionRegistry, sortByStatusUpdatedDesc } from './readSessionRegistry.js';
import type { RegistryResult, Session } from './session.js';
import { deadPid, makeRegistryDir, registryEntry, removeDir } from './testFixtures.js';

const dirs: string[] = [];
function registry(files: Record<string, string | Record<string, unknown>>): string {
  const dir = makeRegistryDir(files);
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  dirs.splice(0).forEach(removeDir);
});

function sessionsOf(result: RegistryResult): Session[] {
  if (!result.ok) {
    throw new Error(`expected a readable registry, got ${result.error.code}`);
  }
  return result.sessions;
}

describe('readSessionRegistry', () => {
  it('reads a session with every observed field and derives folder, group, age and liveness', async () => {
    const dir = registry({ [`${process.pid}.json`]: registryEntry(process.pid, { cwd: '/work/machine/' }) });
    const result = await readSessionRegistry(dir, { now: 1_010_000 });
    expect(result).toMatchObject({ ok: true, dir, unreadable: [] });
    expect(sessionsOf(result)).toEqual([
      {
        file: `${process.pid}.json`,
        pid: process.pid,
        sessionId: expect.any(String),
        cwd: '/work/machine/',
        folder: 'machine',
        startedAt: 1_000_000,
        procStart: '134390780115574227',
        version: '2.1.323',
        peerProtocol: 1,
        kind: 'interactive',
        entrypoint: 'cli',
        name: 'shop-owner',
        nameSource: 'user',
        status: 'idle',
        statusGroup: 'idle',
        updatedAt: 1_005_000,
        statusUpdatedAt: 1_004_000,
        statusAgeMs: 6_000,
        messagingSocketPath: '\\\\.\\pipe\\LOCAL\\cc-msg-test',
        alive: true,
        livenessCheck: 'pid-only',
      },
    ]);
  });

  it('uses the real probe: this process is alive, a process that ended is dead', async () => {
    const dead = deadPid();
    const dir = registry({ [`${process.pid}.json`]: registryEntry(process.pid), [`${dead}.json`]: registryEntry(dead) });
    const byPid = new Map(sessionsOf(await readSessionRegistry(dir)).map((s) => [s.pid, s]));
    expect(byPid.get(process.pid)?.alive).toBe(true);
    expect(byPid.get(dead)?.alive).toBe(false);
    expect(byPid.get(dead)?.livenessCheck).toBe('pid-only');
  });

  it('ignores unknown fields and the .key files next to the registry entries', async () => {
    const dir = registry({
      '11.json': registryEntry(11, { somethingNew: { nested: true }, peerFeatures: ['x'] }),
      '11.0123abcd.key': 'secret material, not a registry entry',
    });
    const result = await readSessionRegistry(dir, { isAlive: () => true });
    expect(result).toMatchObject({ ok: true, unreadable: [] });
    expect(sessionsOf(result)).toHaveLength(1);
    expect(sessionsOf(result)[0]).not.toHaveProperty('somethingNew');
  });

  it('classifies the status: busy, idle, and anything else (waiting) is other, with its raw text and what it waits for', async () => {
    const dir = registry({
      '1.json': registryEntry(1, { status: 'busy' }),
      '2.json': registryEntry(2, { status: 'idle' }),
      '3.json': registryEntry(3, { status: 'waiting', waitingFor: 'permission prompt' }),
    });
    const sessions = sessionsOf(await readSessionRegistry(dir, { isAlive: () => true }));
    expect(sessions.map((s) => [s.status, s.statusGroup, s.waitingFor])).toEqual([
      ['busy', 'busy', undefined],
      ['idle', 'idle', undefined],
      ['waiting', 'other', 'permission prompt'],
    ]);
  });

  it('leaves the optional fields absent instead of inventing them, and reads a JSON null as absent', async () => {
    const dir = registry({ '5.json': { pid: 5, sessionId: 's', cwd: '/home/me/app', status: 'idle', name: null } });
    const [session] = sessionsOf(await readSessionRegistry(dir, { isAlive: () => false }));
    expect(session).toEqual({ file: '5.json', pid: 5, sessionId: 's', cwd: '/home/me/app', folder: 'app', status: 'idle', statusGroup: 'idle', alive: false, livenessCheck: 'pid-only' });
  });

  it('never gives a negative age (the clock of the registry writer is ahead)', async () => {
    const dir = registry({ '5.json': registryEntry(5, { statusUpdatedAt: 5_000 }) });
    const [session] = sessionsOf(await readSessionRegistry(dir, { now: 1_000, isAlive: () => true }));
    expect(session?.statusAgeMs).toBe(0);
  });

  describe('a bad file is reported, never thrown, and does not hide the others', () => {
    it('corrupt JSON, an empty file (mid-rewrite), a non-object, a missing field and a wrong type each give an unreadable entry with the reason', async () => {
      const dir = registry({
        '1.json': registryEntry(1),
        '2.json': '{"pid": 2, "sessionId": ',
        '3.json': '',
        '4.json': '[1, 2]',
        '5.json': { pid: 5, sessionId: 's', status: 'idle' },
        '6.json': registryEntry(6, { startedAt: 'yesterday' }),
        '7.json': registryEntry(7, { pid: -7 }),
      });
      const result = await readSessionRegistry(dir, { isAlive: () => true, retryDelayMs: 1 });
      expect(sessionsOf(result).map((s) => s.pid)).toEqual([1]);
      if (!result.ok) {
        throw new Error('unreachable');
      }
      const reasons = Object.fromEntries(result.unreadable.map((u) => [u.file, u.reason]));
      expect(Object.keys(reasons)).toEqual(['2.json', '3.json', '4.json', '5.json', '6.json', '7.json']);
      expect(reasons['2.json']).toContain('not valid JSON');
      expect(reasons['3.json']).toContain('the file is empty');
      expect(reasons['4.json']).toBe('the file does not hold a JSON object');
      expect(reasons['5.json']).toBe('field "cwd" must be a non-empty string, got nothing');
      expect(reasons['6.json']).toBe('field "startedAt" must be a number, got "yesterday"');
      expect(reasons['7.json']).toBe('field "pid" must be a positive integer, got -7');
    });

    it('a file that is complete on the second read (rewritten meanwhile) is a session, not an error', async () => {
      const dir = registry({ '9.json': '' });
      const pending = readSessionRegistry(dir, { isAlive: () => true, retryDelayMs: 200 });
      // The writer finishes during the wait before the second read
      setTimeout(() => writeFileSync(join(dir, '9.json'), JSON.stringify(registryEntry(9))), 50);
      const result = await pending;
      expect(result).toMatchObject({ ok: true, unreadable: [] });
      expect(sessionsOf(result).map((s) => s.pid)).toEqual([9]);
    });

    it('a .json file that is not named <pid>.json is reported, a directory with that name too', async () => {
      const dir = registry({ 'notes.json': '{}' });
      mkdirSync(join(dir, '12.json'));
      const result = await readSessionRegistry(dir, { isAlive: () => true, retryDelayMs: 1 });
      if (!result.ok) {
        throw new Error('unreachable');
      }
      expect(result.unreadable.map((u) => u.file)).toEqual(['12.json', 'notes.json']);
      expect(result.unreadable[1]?.reason).toContain('not <pid>.json');
      expect(result.unreadable[0]?.reason).toContain('cannot read the file');
    });

    it('a failing liveness probe is reported on that file, with its reason', async () => {
      const dir = registry({ '1.json': registryEntry(1), '2.json': registryEntry(2) });
      const result = await readSessionRegistry(dir, {
        isAlive: (pid) => {
          if (pid === 2) {
            throw new Error('probe exploded');
          }
          return true;
        },
      });
      expect(sessionsOf(result).map((s) => s.pid)).toEqual([1]);
      expect(result).toMatchObject({ unreadable: [{ file: '2.json', reason: 'liveness check failed: probe exploded' }] });
    });
  });

  describe('the folder', () => {
    it('a missing folder is an explicit error with a hint, never an empty list', async () => {
      const dir = join(registry({}), 'does-not-exist');
      const result = await readSessionRegistry(dir);
      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty('sessions');
      expect(result).toMatchObject({ dir, error: { code: 'missing-dir' } });
      if (result.ok) {
        throw new Error('unreachable');
      }
      const { message, hint } = result.error;
      expect(message).toContain(dir);
      expect(hint).toContain("AGENT_MANAGER_SESSIONS_DIR");
    });

    it('a path that is a file is an explicit error', async () => {
      const dir = registry({ 'a-file': 'x' });
      const result = await readSessionRegistry(join(dir, 'a-file'));
      expect(result).toMatchObject({ ok: false, error: { code: 'not-a-directory' } });
    });

    it('an existing empty folder is a successful, empty registry', async () => {
      expect(await readSessionRegistry(registry({}))).toMatchObject({ ok: true, sessions: [], unreadable: [] });
    });
  });
});

describe('sortByStatusUpdatedDesc', () => {
  it('puts the most recent status change first and the sessions without one last', async () => {
    const dir = registry({
      '1.json': registryEntry(1, { statusUpdatedAt: 100 }),
      '2.json': registryEntry(2, { statusUpdatedAt: 300 }),
      '3.json': { pid: 3, sessionId: 's', cwd: '/x', status: 'idle' },
      '4.json': registryEntry(4, { statusUpdatedAt: 200 }),
    });
    const sessions = sessionsOf(await readSessionRegistry(dir, { isAlive: () => true }));
    expect(sortByStatusUpdatedDesc(sessions).map((s) => s.pid)).toEqual([2, 4, 1, 3]);
  });
});

describe('readSessionRegistry: one session id in several files', () => {
  // Evidence (2026-11-22, real registry): 8332.json and 18532.json both held session 3b48318e... (the session was resumed in a new process); the old pid had been
  // reused by another program, so pid-only liveness reported both alive and the list showed the same agent twice.
  const SAME = '3b48318e-ae05-417f-95b1-5d1b964c8e86';
  it('keeps one session per id: the most recently started process', async () => {
    const dir = registry({
      '18532.json': registryEntry(process.pid, { sessionId: SAME, pid: 18532, startedAt: 1_000 }),
      '8332.json': registryEntry(process.pid, { sessionId: SAME.toUpperCase(), pid: 8332, startedAt: 2_000 }),
      '9.json': registryEntry(process.pid, { pid: 9 }),
    });
    const sessions = sessionsOf(await readSessionRegistry(dir, { isAlive: () => true }));
    expect(sessions.map((s) => s.pid)).toEqual([9, 8332]);
  });

  it('prefers an alive process over a newer dead one', async () => {
    const dir = registry({
      '100.json': registryEntry(100, { sessionId: SAME, startedAt: 1_000 }),
      '200.json': registryEntry(200, { sessionId: SAME, startedAt: 2_000 }),
    });
    const sessions = sessionsOf(await readSessionRegistry(dir, { isAlive: (pid) => pid === 100 }));
    expect(sessions.map((s) => s.pid)).toEqual([100]);
  });
});
