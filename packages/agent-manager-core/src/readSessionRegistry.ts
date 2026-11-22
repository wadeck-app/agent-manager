import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getErrorMessage } from './errors.js';
import { isPidAlive } from './pidAlive.js';
import { SessionFormatError, parseSession } from './parseSession.js';
import type { RegistryError, RegistryResult, Session, UnreadableFile } from './session.js';

export interface ReadOptions {
  /** Epoch ms used for `statusAgeMs`. Default: now. */
  now?: number;
  /** Liveness probe. Default: `isPidAlive` (process.kill(pid, 0), EPERM counts as alive). */
  isAlive?: (pid: number) => boolean;
  /** A file that does not parse (Claude Code may be rewriting it) is read once more after this delay, then reported. Default 50 ms. */
  retryDelayMs?: number;
}

const REGISTRY_FILE = /^\d+\.json$/;

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function directoryError(dir: string, error: unknown): RegistryError {
  const code = errorCode(error);
  if (code === 'ENOENT') {
    return {
      code: 'missing-dir',
      message: `the Claude Code session registry folder does not exist: ${dir}`,
      hint: 'Claude Code creates it when a session starts; start one, or set AGENT_MANAGER_SESSIONS_DIR to the folder that holds the <pid>.json files.',
    };
  }
  if (code === 'ENOTDIR') {
    return { code: 'not-a-directory', message: `the session registry path is not a folder: ${dir}`, hint: 'Fix AGENT_MANAGER_SESSIONS_DIR, or remove the file that sits at that path.' };
  }
  return { code: 'unreadable-dir', message: `cannot read the session registry folder ${dir} (${getErrorMessage(error)})`, hint: 'Check the permissions of the folder.' };
}

type FileRead = { kind: 'gone' } | { kind: 'json'; value: unknown } | { kind: 'bad'; reason: string };

/** Reads and parses one file. A file removed since the listing is `gone` (the session ended). A file that does not parse is read once more: it may be mid-rewrite. */
async function readJsonFile(path: string, retryDelayMs: number): Promise<FileRead> {
  let reason = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        return { kind: 'gone' };
      }
      return { kind: 'bad', reason: `cannot read the file (${getErrorMessage(error)})` };
    }
    try {
      return { kind: 'json', value: JSON.parse(text) as unknown };
    } catch (error) {
      reason = `not valid JSON (${getErrorMessage(error)})${text === '' ? ': the file is empty' : ''}`;
    }
  }
  return { kind: 'bad', reason };
}

/**
 * Reads the Claude Code session registry (`<dir>/<pid>.json`, one file per running or recently running session).
 *
 * - The folder missing or unreadable is `{ ok: false, error }`, never an empty list.
 * - One bad file never fails the read: it is listed in `unreadable` with its name and the reason. Files that are not `*.json` (Claude Code also
 *   leaves `<pid>.<hash>.key` files here) are not registry entries and are ignored; a `*.json` whose name is not `<pid>.json` is reported.
 * - A file that vanishes between the listing and the read is a session that just ended: it is not an error and not reported.
 * - Liveness is `pid-only` (see LivenessCheck in session.ts). NOT implemented yet: the `procStart` pid-reuse check of decision 30; a dead session
 *   whose pid was taken by another program is reported alive.
 *
 * Sessions are returned sorted by pid; the presentation order is the caller's (see sortByStatusUpdatedDesc).
 */
export async function readSessionRegistry(dir: string, options: ReadOptions = {}): Promise<RegistryResult> {
  const now = options.now ?? Date.now();
  const isAlive = options.isAlive ?? ((pid: number) => isPidAlive(pid));
  const retryDelayMs = options.retryDelayMs ?? 50;

  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    return { ok: false, dir, error: directoryError(dir, error) };
  }

  const sessions: Session[] = [];
  const unreadable: UnreadableFile[] = [];
  for (const file of names.filter((name) => name.endsWith('.json')).sort()) {
    if (!REGISTRY_FILE.test(file)) {
      unreadable.push({ file, reason: 'the name is not <pid>.json, so this is not a session registry entry' });
      continue;
    }
    const read = await readJsonFile(join(dir, file), retryDelayMs);
    if (read.kind === 'gone') {
      continue;
    }
    if (read.kind === 'bad') {
      unreadable.push({ file, reason: read.reason });
      continue;
    }
    try {
      sessions.push(parseSession(file, read.value, { now, isAlive }));
    } catch (error) {
      unreadable.push({ file, reason: error instanceof SessionFormatError ? getErrorMessage(error) : `liveness check failed: ${getErrorMessage(error)}` });
    }
  }
  const unique = oneBySessionId(sessions);
  unique.sort((a, b) => a.pid - b.pid);
  return { ok: true, dir, sessions: unique, unreadable };
}

/**
 * One session per session id (case-insensitive). Claude Code leaves the file of an old process behind when a session is resumed in a new one, and with pid-only
 * liveness a reused pid makes the old file look alive: the list would show the same agent several times. Kept: an alive process over a dead one, then the most
 * recently started, then the highest pid.
 */
function oneBySessionId(sessions: readonly Session[]): Session[] {
  const better = (a: Session, b: Session): boolean => (Number(a.alive) - Number(b.alive) || (a.startedAt ?? 0) - (b.startedAt ?? 0) || a.pid - b.pid) > 0;
  const byId = new Map<string, Session>();
  for (const session of sessions) {
    const key = session.sessionId.toLowerCase();
    const current = byId.get(key);
    if (current === undefined || better(session, current)) {
      byId.set(key, session);
    }
  }
  return [...byId.values()];
}

/** Most recent status change first; sessions without `statusUpdatedAt` last, by pid. */
export function sortByStatusUpdatedDesc(sessions: readonly Session[]): Session[] {
  return [...sessions].sort((a, b) => (b.statusUpdatedAt ?? 0) - (a.statusUpdatedAt ?? 0) || a.pid - b.pid);
}
