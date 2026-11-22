import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Session } from '@wadeck-app/agent-manager-core';
import { getErrorMessage } from '@wadeck-app/agent-manager-core';
import type { ModelRef, ModelUsageRollup } from '@wadeck-app/agent-manager-core/transcript';
import type { BypassDto, ContextUsedDto, ModelDto, SessionStatusDto } from '../commons/api.js';

/**
 * The data of the Claude Code status line (C:\Users\<user>\.claude\statusline*.js) for a registry session. Read-only. The working directory ALWAYS comes
 * from the registry (never from the browser): the routes pass `session.cwd`, nothing a client sent becomes a path here except the session id, which is
 * validated against the registry first and checked again below before it becomes a file name.
 */

/** A branch is cached per working directory this long: ten sessions in one repository spawn git once. */
export const GIT_CACHE_MS = 10_000;
const GIT_TIMEOUT_MS = 2_000;
/** Working directories remembered; beyond it the cache restarts (it only saves work). */
const MAX_GIT_CACHED = 200;
/** The bypass file is a few KB; a bigger one is not read (it would be read at every poll). */
const MAX_BYPASS_BYTES = 1024 * 1024;

type GitAnswer = { branch?: string; error?: string };
const gitCache = new Map<string, { at: number; answer: GitAnswer }>();
const gitInFlight = new Map<string, Promise<GitAnswer>>();

/** A role is cached this long per working directory + session: the roles folder walk is a handful of reads at every 5 s poll otherwise. */
export const ROLE_CACHE_MS = 8_000;
/** Roles and bypass files remembered; beyond it the cache restarts (it only saves work). */
const MAX_CACHED = 200;
const roleCache = new Map<string, { at: number; role: string | undefined }>();
/** The parsed bypass file per path, valid while its mtime and size are unchanged (the file is rewritten by the guardrails hook, rarely). */
type BypassFileAnswer = { overrides: unknown } | { error: string };
const bypassCache = new Map<string, { mtimeMs: number; size: number; answer: BypassFileAnswer }>();

/** Resets the caches (tests). */
export function clearStatusCaches(): void {
  gitCache.clear();
  gitInFlight.clear();
  roleCache.clear();
  bypassCache.clear();
}

/** A usable working directory: an absolute path without a NUL byte that is a folder on disk. Anything else is not looked at (a gone folder is not an error). */
async function existingFolder(cwd: string): Promise<boolean> {
  if (typeof cwd !== 'string' || cwd === '' || cwd.includes('\0') || !isAbsolute(cwd)) {
    return false;
  }
  try {
    return (await stat(cwd)).isDirectory();
  } catch {
    return false;
  }
}

function runGit(cwd: string): Promise<GitAnswer> {
  return new Promise((done) => {
    // argv array, no shell: the folder is one argument whatever it contains.
    execFile('git', ['-C', cwd, 'branch', '--show-current'], { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
      if (error === null) {
        const branch = stdout.trim();
        // Empty = detached HEAD (or an unborn branch with no name): there is no branch to show.
        done(branch === '' ? {} : { branch });
        return;
      }
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        done({ error: 'git is not installed or not on the PATH of the app-core process, so the branch cannot be shown. Install git or add it to the PATH.' });
        return;
      }
      if ((error as { killed?: boolean }).killed === true) {
        done({ error: `git did not answer within ${GIT_TIMEOUT_MS} ms for ${cwd}, so the branch is not shown. A slow disk or a locked repository can cause this; it is tried again at the next refresh.` });
        return;
      }
      const message = String(stderr).trim();
      // Exit 128 "not a git repository" is the normal case of a folder without git: no branch, no error.
      if (/not a git repository/i.test(message)) {
        done({});
        return;
      }
      done({ error: `git failed in ${cwd}: ${message.split('\n')[0] ?? getErrorMessage(error)}` });
    });
  });
}

/** The branch of a working directory (read-only `git branch --show-current`), cached per directory for GIT_CACHE_MS; never runs on a folder that does not exist. */
export async function gitBranchOf(cwd: string, now: number = Date.now()): Promise<GitAnswer> {
  if (!(await existingFolder(cwd))) {
    return {};
  }
  const cached = gitCache.get(cwd);
  if (cached !== undefined && now - cached.at < GIT_CACHE_MS) {
    return cached.answer;
  }
  let pending = gitInFlight.get(cwd);
  if (pending === undefined) {
    pending = runGit(cwd).then((answer) => {
      if (gitCache.size >= MAX_GIT_CACHED) {
        gitCache.clear();
      }
      gitCache.set(cwd, { at: now, answer });
      return answer;
    });
    gitInFlight.set(cwd, pending);
    void pending.finally(() => gitInFlight.delete(cwd));
  }
  return pending;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Role: as statusline-role-lib.js
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * undefined = no role for this session, 'autonomous-worker' = the role (the file holds `role-autonomous-worker`), '!role-err:<cause>' = something is wrong
 * (visible, never an empty slot). The role skills write <repo>/.claude/session/roles/<sessionId>; the lookup walks up from the working directory.
 */
export async function roleOf(cwd: string, sessionId: string): Promise<string | undefined> {
  if (typeof cwd !== 'string' || cwd === '' || sessionId === '') {
    return undefined;
  }
  // The id becomes a file name: refuse anything that could leave the roles folder.
  if (!/^[A-Za-z0-9-]+$/.test(sessionId)) {
    return '!role-err:unexpected session id format';
  }
  if (cwd.includes('\0')) {
    return '!role-err:the working directory of the registry holds a NUL byte';
  }
  let dir = resolve(cwd);
  for (;;) {
    const file = join(dir, '.claude', 'session', 'roles', sessionId);
    let text: string | undefined;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // A missing file or a missing folder on the way is normal: look in the parent. Anything else is shown.
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        return `!role-err:${getErrorMessage(error)}`;
      }
    }
    if (text !== undefined) {
      const role = text.trim();
      return /^role-[a-z0-9-]+$/.test(role) ? role.replace(/^role-/, '') : `!role-err:${file} does not hold a role name`;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/** roleOf cached for ROLE_CACHE_MS per working directory and session (a role skill writing the file shows up within that delay). */
export async function cachedRoleOf(cwd: string, sessionId: string, now: number): Promise<string | undefined> {
  const key = `${cwd}\0${sessionId}`;
  const cached = roleCache.get(key);
  if (cached !== undefined && now - cached.at < ROLE_CACHE_MS) {
    return cached.role;
  }
  const role = await roleOf(cwd, sessionId);
  if (roleCache.size >= MAX_CACHED) {
    roleCache.clear();
  }
  roleCache.set(key, { at: now, role });
  return role;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Bypasses: as statusline-bypass-lib.js
// ---------------------------------------------------------------------------------------------------------------------------------------------------

const ALIAS: Readonly<Record<string, string>> = { 'git-commit-push': 'c&p' };

/** "1h52m", "2h", "10m", "<1m": the format of the status line. */
export function formatLeft(ms: number): string {
  if (ms >= 3_600_000) {
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    return `${hours}h${minutes > 0 ? `${minutes}m` : ''}`;
  }
  return ms >= 60_000 ? `${Math.floor(ms / 60_000)}m` : '<1m';
}

type Override = { session_id?: unknown; decision?: unknown; expires?: unknown; category?: unknown; mode?: unknown; max_uses?: unknown; used?: unknown };

/**
 * The active bypasses of a session from the `overrides` array of guardrails.bypass.json: allow decisions of this session that are not expired, the best
 * (latest expiry) per category; a commit and a push together are shown as the combined c&p limited by the shorter one. Throws when `overrides` is not an array.
 */
export function activeBypasses(overrides: unknown, sessionId: string, now: number): BypassDto[] {
  if (!Array.isArray(overrides)) {
    throw new Error('overrides is not an array');
  }
  type Best = { entry: Override; expMs: number };
  const best = new Map<string, Best>();
  for (const raw of overrides as unknown[]) {
    const entry = raw as Override | null;
    if (entry === null || typeof entry !== 'object' || entry.session_id !== sessionId || entry.decision !== 'allow' || typeof entry.category !== 'string') {
      continue;
    }
    const expMs = new Date(String(entry.expires)).getTime();
    if (!(expMs > now)) {
      continue;
    }
    // A 'once' bypass whose uses are gone is spent: it is not active, and must not hide a usable entry of the same category. (statusline-bypass-lib.js would
    // print "(0x)" or a negative count for it: not intended, a spent bypass allows nothing.)
    if (entry.mode === 'once') {
      const max = typeof entry.max_uses === 'number' ? entry.max_uses : 1;
      const used = typeof entry.used === 'number' ? entry.used : 0;
      if (used >= max) {
        continue;
      }
    }
    const previous = best.get(entry.category);
    if (previous === undefined || expMs > previous.expMs) {
      best.set(entry.category, { entry, expMs });
    }
  }
  const commit = best.get('git-commit');
  const push = best.get('git-push');
  if (commit !== undefined && push !== undefined) {
    const shorter = commit.expMs <= push.expMs ? commit : push;
    const combined = best.get('git-commit-push');
    best.delete('git-commit');
    best.delete('git-push');
    if (combined === undefined || shorter.expMs > combined.expMs) {
      best.set('git-commit-push', shorter);
    }
  }
  return [...best.entries()]
    .map(([category, { entry, expMs }]): BypassDto => {
      const label = ALIAS[category] ?? category;
      if (entry.mode === 'once') {
        const left = Math.max(0, (typeof entry.max_uses === 'number' ? entry.max_uses : 1) - (typeof entry.used === 'number' ? entry.used : 0));
        return { category, label, left: `${left}x` };
      }
      return { category, label, left: formatLeft(expMs - now), leftMs: expMs - now };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The text of the bypass file to the active bypasses of the session; a text that is not JSON or has no `overrides` array is an `error` (never an empty list). */
export function parseBypassFile(text: string, file: string, sessionId: string, now: number): { bypasses?: BypassDto[]; error?: string } {
  return bypassesFromAnswer(parseOverrides(text, file), file, sessionId, now);
}

function parseOverrides(text: string, file: string): BypassFileAnswer {
  try {
    const parsed: unknown = JSON.parse(text);
    return { overrides: parsed !== null && typeof parsed === 'object' ? (parsed as { overrides?: unknown }).overrides : undefined };
  } catch (error) {
    return { error: `The bypass file ${file} cannot be read: ${getErrorMessage(error)}. Fix or delete it (the guardrails hook reads the same file).` };
  }
}

function bypassesFromAnswer(answer: BypassFileAnswer, file: string, sessionId: string, now: number): { bypasses?: BypassDto[]; error?: string } {
  if ('error' in answer) {
    return { error: answer.error };
  }
  try {
    return { bypasses: activeBypasses(answer.overrides, sessionId, now) };
  } catch (error) {
    return { error: `The bypass file ${file} cannot be read: ${getErrorMessage(error)}. Fix or delete it (the guardrails hook reads the same file).` };
  }
}

/** The bypasses of the session in <cwd>/.claude/w-guardrails/guardrails.bypass.json (read only): absent file = none (undefined); unreadable or malformed = `error`. */
export async function bypassesOf(cwd: string, sessionId: string, now: number): Promise<{ bypasses?: BypassDto[]; error?: string }> {
  if (typeof cwd !== 'string' || cwd === '' || cwd.includes('\0') || !isAbsolute(cwd) || sessionId === '') {
    return {};
  }
  const file = join(cwd, '.claude', 'w-guardrails', 'guardrails.bypass.json');
  let answer: BypassFileAnswer;
  try {
    const info = await stat(file);
    if (info.size > MAX_BYPASS_BYTES) {
      return { error: `${file} is ${info.size} bytes, more than the ${MAX_BYPASS_BYTES} bytes this page reads. Remove the expired entries from it.` };
    }
    // The file is read and parsed again only when its mtime or size changed; the expiry of each entry is still judged against `now` at every call.
    const cached = bypassCache.get(file);
    if (cached !== undefined && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
      answer = cached.answer;
    } else {
      answer = parseOverrides(await readFile(file, 'utf8'), file);
      if (bypassCache.size >= MAX_CACHED) {
        bypassCache.clear();
      }
      bypassCache.set(file, { mtimeMs: info.mtimeMs, size: info.size, answer });
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return {};
    }
    return { error: `The bypass file ${file} cannot be read: ${getErrorMessage(error)}. Fix or delete it (the guardrails hook reads the same file).` };
  }
  return bypassesFromAnswer(answer, file, sessionId, now);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The whole status
// ---------------------------------------------------------------------------------------------------------------------------------------------------

const modelDto = (model: ModelRef): ModelDto => ({ ...(model.id !== undefined ? { id: model.id } : {}), displayName: model.displayName, known: model.known });

/** The model, context and token fields of a rollup (the transcript part of the status). */
export function usageStatus(rollup: ModelUsageRollup | undefined): SessionStatusDto {
  if (rollup === undefined) {
    return {};
  }
  const out: SessionStatusDto = {};
  if (rollup.currentModel !== undefined) {
    out.model = modelDto(rollup.currentModel);
  }
  if (rollup.previousModels.length > 0) {
    out.previousModels = rollup.previousModels.map(modelDto);
  }
  if (rollup.lastUsage !== undefined && rollup.window !== undefined && rollup.compactPct !== undefined) {
    const contextUsedPct: ContextUsedDto = { value: rollup.compactPct, basis: 'estimate', note: rollup.window.note, windowTokens: rollup.window.tokens, compactAtTokens: rollup.window.compactAtTokens, usedTokens: rollup.lastUsage.contextTokens };
    out.contextUsedPct = contextUsedPct;
    out.tokensIn = rollup.lastUsage.contextTokens;
    out.tokensOut = rollup.lastUsage.outputTokens;
  }
  return out;
}

/**
 * The status of a session: the transcript figures (`rollup`, `note` from the digest) plus the duration, branch, role and bypasses read from the folder of the
 * registry session. Never throws: each part that fails says so in its own field.
 */
export async function statusOf(session: Session, rollup: ModelUsageRollup | undefined, transcriptNote: string, now: number): Promise<SessionStatusDto> {
  const [git, role, bypass] = await Promise.all([gitBranchOf(session.cwd, now), cachedRoleOf(session.cwd, session.sessionId, now), bypassesOf(session.cwd, session.sessionId, now)]);
  const status = usageStatus(rollup);
  const notes: string[] = [];
  if (status.model === undefined) {
    notes.push(transcriptNote !== '' ? transcriptNote : 'No assistant message in the transcript yet, so the model is not known.');
  } else if (status.contextUsedPct === undefined) {
    notes.push('No usage in the part of the transcript that was read, so the context size is not known.');
  }
  return {
    ...status,
    ...(session.startedAt !== undefined ? { durationMs: Math.max(0, now - session.startedAt) } : {}),
    ...(git.branch !== undefined ? { gitBranch: git.branch } : {}),
    ...(git.error !== undefined ? { gitBranchError: git.error } : {}),
    ...(role !== undefined ? { role } : {}),
    ...(bypass.bypasses !== undefined ? { bypasses: bypass.bypasses } : {}),
    ...(bypass.error !== undefined ? { bypassError: bypass.error } : {}),
    ...(notes.length > 0 ? { statusNote: notes.join(' ') } : {}),
  };
}
