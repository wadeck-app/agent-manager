import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getErrorMessage } from '../../errors.js';
import { removeDir } from '../../testFixtures.js';
import { LaunchError } from '../errors.js';
import { STATE_FILE_VERSION, ownedStatePath, readOwnedState, writeOwnedState } from './stateFile.js';
import type { OwnedSessionRecord } from './types.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    removeDir(dir);
  }
});

function configDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-manager-state-'));
  dirs.push(dir);
  return dir;
}

const record: OwnedSessionRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  hostKind: 'stream-json',
  cwd: '/work/project',
  model: 'haiku',
  claudeVersion: '2.1.328 (Claude Code)',
  startedAt: 1000,
  status: 'exited',
  exit: { cause: 'closed', code: 0, signal: null, by: 'user', stderrTail: '', at: 2000 },
};

async function failure(path: string): Promise<LaunchError> {
  try {
    await readOwnedState(path);
  } catch (error) {
    if (error instanceof LaunchError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the read to fail');
}

describe('owned-sessions.json', () => {
  it('reads a missing file as an empty list', async () => {
    expect(await readOwnedState(ownedStatePath(configDir()))).toEqual([]);
  });

  it('writes a versioned file atomically (no temp file left) and reads it back', async () => {
    const dir = configDir();
    const path = ownedStatePath(dir);
    await writeOwnedState(path, [record]);
    await writeOwnedState(path, [record, { ...record, id: '22222222-2222-4222-8222-222222222222', status: 'live', pid: 5 }]);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ version: STATE_FILE_VERSION });
    expect(readdirSync(dir)).toEqual(['owned-sessions.json']);
    const records = await readOwnedState(path);
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(record);
  });

  it.each([
    ['not JSON', '{"version":1,', 'not valid JSON'],
    ['not an object', '[]', 'not a JSON object'],
    ['another version', '{"version":2,"sessions":[]}', 'version 2'],
    ['no sessions array', '{"version":1}', '"sessions" is not an array'],
    ['a record that is not an object', '{"version":1,"sessions":[1]}', 'sessions[0] must be an object'],
    ['an unknown host kind', JSON.stringify({ version: 1, sessions: [{ ...record, hostKind: 'x' }] }), 'hostKind'],
    ['an unknown status', JSON.stringify({ version: 1, sessions: [{ ...record, status: 'weird' }] }), 'status'],
    ['a record without id', JSON.stringify({ version: 1, sessions: [{ ...record, id: undefined }] }), 'sessions[0].id'],
    ['a bad exit', JSON.stringify({ version: 1, sessions: [{ ...record, exit: { ...record.exit, cause: 'boom' } }] }), 'exit.cause'],
    ['a duplicate id', JSON.stringify({ version: 1, sessions: [record, record] }), 'appears twice'],
  ])('refuses %s loudly, with the path and a fix, and leaves the file untouched', async (_name, content, expected) => {
    const path = ownedStatePath(configDir());
    writeFileSync(path, content);
    const error = await failure(path);
    expect(error.code).toBe('state-file-unreadable');
    expect(getErrorMessage(error)).toContain(path);
    expect(getErrorMessage(error)).toContain(expected);
    expect(error.fix).toContain('never empties it by itself');
    expect(readFileSync(path, 'utf8')).toBe(content);
  });

  it('refuses a file that cannot be read (a folder in its place) with the path', async () => {
    const path = ownedStatePath(configDir());
    mkdirSync(path);
    const error = await failure(path);
    expect(error.code).toBe('state-file-unreadable');
    expect(getErrorMessage(error)).toContain(path);
  });

  it('fails a write loudly and leaves no temp file', async () => {
    const dir = configDir();
    const path = ownedStatePath(dir);
    mkdirSync(path);
    await expect(writeOwnedState(path, [record])).rejects.toMatchObject({ code: 'state-file-write-failed' });
    expect(readdirSync(dir)).toEqual(['owned-sessions.json']);
  });
});
