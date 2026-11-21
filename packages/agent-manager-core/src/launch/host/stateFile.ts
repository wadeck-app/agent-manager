import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getErrorMessage } from '../../errors.js';
import { LaunchError } from '../errors.js';
import { HOST_KINDS } from './types.js';
import type { ExitBy, HostKind, OwnedExit, OwnedSessionRecord, PersistedStatus } from './types.js';

/*
 * `<config dir>/owned-sessions.json`: the sessions the daemon launched, so that a restart can list them and resume them. Versioned; written
 * atomically (temp file in the same folder, then rename). A file that cannot be read or understood is NEVER replaced silently: reading it throws a
 * LaunchError with the path and what to do, and the daemon does not start on it.
 */

export const STATE_FILE_NAME = 'owned-sessions.json';
export const STATE_FILE_VERSION = 1;

export function ownedStatePath(configDir: string): string {
  return join(configDir, STATE_FILE_NAME);
}

const STATUSES: readonly string[] = ['live', 'exited', 'interrupted'];
const EXIT_BY: readonly string[] = ['self', 'user', 'daemon-shutdown'];
const EXIT_CAUSES: readonly string[] = ['closed', 'killed', 'exited', 'crashed', 'spawn-failed'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHostKind(value: string): value is HostKind {
  return HOST_KINDS.some((kind) => kind === value);
}

class Reader {
  constructor(
    private readonly record: Record<string, unknown>,
    private readonly where: string,
  ) {}

  string(key: string): string {
    const value = this.record[key];
    if (typeof value !== 'string' || value === '') {
      throw new Error(`${this.where}.${key} must be a non-empty string`);
    }
    return value;
  }

  optionalString(key: string): string | undefined {
    const value = this.record[key];
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== 'string') {
      throw new Error(`${this.where}.${key} must be a string`);
    }
    return value;
  }

  number(key: string): number {
    const value = this.record[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${this.where}.${key} must be a number`);
    }
    return value;
  }

  optionalNumber(key: string): number | undefined {
    return this.record[key] === undefined ? undefined : this.number(key);
  }
}

function parseExit(value: unknown, where: string): OwnedExit {
  if (!isRecord(value)) {
    throw new Error(`${where} must be an object`);
  }
  const reader = new Reader(value, where);
  const cause = reader.string('cause');
  const by = reader.string('by');
  if (!EXIT_CAUSES.includes(cause)) {
    throw new Error(`${where}.cause ${JSON.stringify(cause)} is not one of ${EXIT_CAUSES.join(', ')}`);
  }
  if (!EXIT_BY.includes(by)) {
    throw new Error(`${where}.by ${JSON.stringify(by)} is not one of ${EXIT_BY.join(', ')}`);
  }
  const code = value['code'];
  const signal = value['signal'];
  if (code !== null && typeof code !== 'number') {
    throw new Error(`${where}.code must be a number or null`);
  }
  if (signal !== null && typeof signal !== 'string') {
    throw new Error(`${where}.signal must be a string or null`);
  }
  const stderrTail = value['stderrTail'];
  if (typeof stderrTail !== 'string') {
    throw new Error(`${where}.stderrTail must be a string`);
  }
  return { cause: cause as OwnedExit['cause'], code, signal, by: by as ExitBy, stderrTail, at: reader.number('at') };
}

function parseRecord(value: unknown, index: number): OwnedSessionRecord {
  const where = `sessions[${index}]`;
  if (!isRecord(value)) {
    throw new Error(`${where} must be an object`);
  }
  const reader = new Reader(value, where);
  const hostKind = reader.string('hostKind');
  if (!isHostKind(hostKind)) {
    throw new Error(`${where}.hostKind ${JSON.stringify(hostKind)} is not one of ${HOST_KINDS.join(', ')}`);
  }
  const status = reader.string('status');
  if (!STATUSES.includes(status)) {
    throw new Error(`${where}.status ${JSON.stringify(status)} is not one of ${STATUSES.join(', ')}`);
  }
  const model = reader.optionalString('model');
  const permissionMode = reader.optionalString('permissionMode');
  const name = reader.optionalString('name');
  const pid = reader.optionalNumber('pid');
  const daemonPid = reader.optionalNumber('daemonPid');
  const hcAddress = reader.optionalString('hcAddress');
  const jobId = reader.optionalString('jobId');
  if (hostKind === 'bg' && jobId === undefined) {
    throw new Error(`${where}.jobId is required for a bg session`);
  }
  const interruptedAt = reader.optionalNumber('interruptedAt');
  const resumedAt = reader.optionalNumber('resumedAt');
  const forkedFrom = reader.optionalString('forkedFrom');
  return {
    id: reader.string('id'),
    hostKind,
    cwd: reader.string('cwd'),
    ...(model === undefined ? {} : { model }),
    ...(permissionMode === undefined ? {} : { permissionMode }),
    ...(name === undefined ? {} : { name }),
    claudeVersion: reader.string('claudeVersion'),
    startedAt: reader.number('startedAt'),
    status: status as PersistedStatus,
    ...(pid === undefined ? {} : { pid }),
    ...(daemonPid === undefined ? {} : { daemonPid }),
    ...(hcAddress === undefined ? {} : { hcAddress }),
    ...(jobId === undefined ? {} : { jobId }),
    ...(value['exit'] === undefined ? {} : { exit: parseExit(value['exit'], `${where}.exit`) }),
    ...(interruptedAt === undefined ? {} : { interruptedAt }),
    ...(resumedAt === undefined ? {} : { resumedAt }),
    ...(forkedFrom === undefined ? {} : { forkedFrom }),
  };
}

function unreadable(path: string, reason: string): LaunchError {
  return new LaunchError(
    'state-file-unreadable',
    `the file of owned sessions ${path} cannot be used (${reason})`,
    `fix the file, or move it aside (e.g. rename it to ${STATE_FILE_NAME}.bad) to start with an empty list; agent-manager never empties it by itself. The sessions listed in it cannot be resumed from agent-manager until then (their ids are in the file)`,
  );
}

/** The records of the file. A missing file is an empty list; anything else wrong (unreadable, not JSON, wrong version or shape) throws a LaunchError. */
export async function readOwnedState(path: string): Promise<OwnedSessionRecord[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw unreadable(path, getErrorMessage(error));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw unreadable(path, `not valid JSON: ${getErrorMessage(error)}`);
  }
  if (!isRecord(parsed)) {
    throw unreadable(path, 'the content is not a JSON object');
  }
  if (parsed['version'] !== STATE_FILE_VERSION) {
    throw unreadable(path, `version ${JSON.stringify(parsed['version'])} is not the version ${STATE_FILE_VERSION} this agent-manager reads (another agent-manager version wrote it)`);
  }
  const sessions = parsed['sessions'];
  if (!Array.isArray(sessions)) {
    throw unreadable(path, '"sessions" is not an array');
  }
  try {
    const records = sessions.map((entry, index) => parseRecord(entry, index));
    const seen = new Set<string>();
    for (const record of records) {
      if (seen.has(record.id)) {
        throw new Error(`the session id ${record.id} appears twice`);
      }
      seen.add(record.id);
    }
    return records;
  } catch (error) {
    throw unreadable(path, getErrorMessage(error));
  }
}

const RENAME_RETRY_CODES = ['EPERM', 'EBUSY', 'EACCES'];

/** Writes the records atomically. Throws a LaunchError (the file is left as it was) when the write fails. */
export async function writeOwnedState(path: string, records: readonly OwnedSessionRecord[]): Promise<void> {
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temp, `${JSON.stringify({ version: STATE_FILE_VERSION, sessions: records }, null, 2)}\n`, 'utf8');
    // Windows refuses a rename onto a file that another process (antivirus, an indexer) holds open for a moment.
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(temp, path);
        return;
      } catch (error) {
        if (attempt >= 10 || !RENAME_RETRY_CODES.includes((error as NodeJS.ErrnoException).code ?? '')) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw new LaunchError('state-file-write-failed', `the file of owned sessions ${path} could not be written (${getErrorMessage(error)})`, `check the permissions and the free space of ${dirname(path)}`);
  }
}
