import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import * as fs from 'node:fs/promises';
import { getErrorMessage, readSessionRegistry, resolveSessionsDir } from '@wadeck-app/agent-manager-core';
import { FolderError, checkAbsolutePath, isFilesystemRoot, isInside, parentOf, pathKey, readLaunchRoots } from '@wadeck-app/agent-manager-core/folders';
import type { OwnedSource } from './daemon/ownedSource.js';

/**
 * WHERE THE PAGE MAY LOOK. The folder routes answer to any page that can reach app-core on this machine and have no PIN (a PIN on every click of a tree would make
 * it unusable), so what they may show is bounded by construction, not by trust:
 *
 *  1. the roots the user wrote in config.yml (`launchRoots`, managed by `agent-manager launch-roots add|remove|show`), and
 *  2. the PARENT of every folder a session or a launch already ran in (so the siblings of a project are offered, the usual place of the next one).
 *
 * Deliberately NOT roots, however many sessions ran there: the home folder, a drive root, `/`, and a parent that contains the home folder (the folder of all the users).
 * A session started directly under the home folder or under a drive root contributes ITSELF, never that parent; a session started in the home folder or at a drive root
 * contributes nothing. Someone who keeps projects there says so once with `launch-roots add`.
 * A path outside the roots can still be TYPED in the Folder field; it is not listed, and the daemon checks it when the session is launched.
 *
 * What a root gives: the names of the folders below it (never a file, never a content), so the worst case of this surface is the disclosure of folder names
 * inside folders the user already works in or chose.
 */

/** Distinct folders looked at to derive roots (the most recent ones first): a registry with hundreds of dead sessions must not mean hundreds of roots. */
const MAX_DERIVED_ROOTS = 20;

export interface FolderRoot {
  /** The path as configured, or the parent of the cwd. */
  path: string;
  /** The same folder with links resolved: what a request is compared with, so that a link inside a root cannot lead out of it. */
  real: string;
  name: string;
  source: 'config' | 'sessions';
}

export interface KnownFolder {
  path: string;
  /** Epoch ms of the most recent session or launch. */
  lastUsedAt: number;
  uses: number;
}

export interface Known {
  /** By pathKey. Only absolute local paths: see readKnownFolders. */
  folders: Map<string, KnownFolder>;
  /** How many working directories were left out because they are not an absolute local path (a UNC path, a relative one, control characters). */
  ignored: number;
  /** What could not be read, in words (never silently an empty list). */
  warnings: string[];
}

/**
 * The distinct working directories of the registry sessions (alive or not) and of the launches (the daemon's records), with their last use.
 * A registry file is written by whoever can write in the registry folder, so a working directory is TEXT FROM OUTSIDE: it goes through checkAbsolutePath before
 * anything else, and one that is not an absolute local path (a UNC path would make this process open a connection to another machine, a relative one means
 * something else per process) is never kept, never opened, and counted in `ignored` and said in a warning.
 */
export async function readKnownFolders(owned: OwnedSource): Promise<Known> {
  const folders = new Map<string, KnownFolder>();
  const warnings: string[] = [];
  let ignored = 0;
  let example = '';
  const add = (raw: string, at: number): void => {
    if (raw.trim() === '') {
      return;
    }
    let path: string;
    try {
      path = checkAbsolutePath(raw, 'the working directory');
    } catch (error) {
      ignored += 1;
      example = example === '' ? `${JSON.stringify(raw.slice(0, 80))}: ${error instanceof FolderError ? error.reason : getErrorMessage(error)}` : example;
      return;
    }
    const key = pathKey(path);
    const current = folders.get(key);
    folders.set(key, { path: current?.path ?? path, lastUsedAt: Math.max(current?.lastUsedAt ?? 0, at), uses: (current?.uses ?? 0) + 1 });
  };
  const registry = await readSessionRegistry(resolveSessionsDir(process.env));
  if (registry.ok) {
    for (const session of registry.sessions) {
      add(session.cwd, session.statusUpdatedAt ?? session.updatedAt ?? session.startedAt ?? 0);
    }
  } else {
    const { message, hint } = registry.error;
    warnings.push(`The session registry cannot be read, so the folders of the sessions are not offered: ${message}. ${hint}`);
  }
  const listed = await owned.list();
  if (listed.ok) {
    for (const view of listed.sessions) {
      add(view.cwd, view.startedAt);
    }
  } else if (listed.error.code !== 'daemon-not-running') {
    // A daemon that is not running is not repeated here: the New session dialog already says so, with its fix, and the registry above still gives every session that registered.
    const { message, hint } = listed.error;
    warnings.push(`The folders of the sessions launched here are not offered: ${message}. ${hint}`);
  }
  if (ignored > 0) {
    warnings.push(`${ignored} working director${ignored === 1 ? 'y' : 'ies'} of the sessions ${ignored === 1 ? 'was' : 'were'} ignored and never opened: not an absolute local path (first one: ${example}). Fix the session registry entry, or ignore this.`);
  }
  return { folders, warnings, ignored };
}

async function realDirectory(path: string): Promise<string | undefined> {
  try {
    const real = await fs.realpath(path);
    return (await fs.stat(real)).isDirectory() ? real : undefined;
  } catch {
    return undefined;
  }
}

/** The folders that hold the accounts of a machine: listing one would show every account name. Besides the parent of the home folder, the usual ones. */
// violations-suppress: shared/no-out-of-repo-path the names of the folders that hold accounts, compared with paths, never read from disk
const ACCOUNT_PARENTS = ['/home', '/Users', 'C:\\Users'];

function accountParents(home: string): Set<string> {
  const parents = new Set(ACCOUNT_PARENTS.map(pathKey));
  const above = parentOf(home);
  if (above !== null) {
    parents.add(pathKey(above));
  }
  return parents;
}

/**
 * The root a cwd contributes: its parent, except where that parent is a drive root, the home folder or holds it (then the cwd itself).
 * Undefined, never a root, for a cwd that is a drive root or `/`, equals or CONTAINS the home folder, is a folder of accounts (the Windows and Unix folders of accounts) or sits
 * directly in one (the home folder of another account). See the comment at the top.
 */
export function derivedRootOf(cwd: string, home: string = homedir()): string | undefined {
  const parent = parentOf(cwd);
  const accounts = accountParents(home);
  if (parent === null || isInside(cwd, home) || accounts.has(pathKey(cwd)) || accounts.has(pathKey(parent))) {
    return undefined;
  }
  // The parent is the home folder of another account when it sits directly in a folder of accounts: not a root either.
  const above = parentOf(parent);
  if (isFilesystemRoot(parent) || isInside(parent, home) || (above !== null && accounts.has(pathKey(above)))) {
    return cwd;
  }
  return parent;
}

export interface Scope {
  roots: FolderRoot[];
  known: Known;
  /** Configured roots that do not exist (or are not folders) any more. */
  missing: string[];
  configFile: string;
  /** Why launchRoots of config.yml was not used (file, line and fix, one text), '' when it was. The roots are then the ones derived from the sessions only. */
  configProblem: string;
}

function rootName(path: string): string {
  return basename(path) === '' ? path : basename(path);
}

/**
 * The roots in force now (see ScopeCache for how often this runs). A config.yml whose launchRoots cannot be read or understood does NOT stop the folder routes:
 * the roots are then the ones derived from the sessions only, and `configProblem` (also the first warning) says which file, which line and the fix. It is never an
 * empty scope that looks like "nothing to browse".
 */
export async function buildScope(configDir: string, owned: OwnedSource): Promise<Scope> {
  let configured: { roots: string[]; file: string } = { roots: [], file: join(configDir, 'config.yml') };
  let configProblem = '';
  try {
    configured = await readLaunchRoots(configDir);
  } catch (error) {
    configProblem = `The launchRoots of ${configured.file} are not used: ${getErrorMessage(error)}. Only the parents of the folders your sessions ran in can be browsed until it is fixed ('agent-manager launch-roots show' prints this too).`;
  }
  const known = await readKnownFolders(owned);
  if (configProblem !== '') {
    known.warnings.unshift(configProblem);
  }
  const candidates: { path: string; source: FolderRoot['source'] }[] = configured.roots.map((path) => ({ path, source: 'config' as const }));
  const recent = [...known.folders.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, MAX_DERIVED_ROOTS * 3);
  for (const folder of recent) {
    try {
      const root = derivedRootOf(checkAbsolutePath(folder.path));
      if (root !== undefined) {
        candidates.push({ path: root, source: 'sessions' });
      }
    } catch {
      // A cwd that is not an absolute local path (a UNC path, a relative one) is never a root; it stays a recent folder.
    }
  }
  const roots: FolderRoot[] = [];
  const missing: string[] = [];
  let derived = 0;
  for (const candidate of candidates) {
    if (roots.some((root) => pathKey(root.path) === pathKey(candidate.path))) {
      continue;
    }
    if (candidate.source === 'sessions' && derived >= MAX_DERIVED_ROOTS) {
      continue;
    }
    const real = await realDirectory(candidate.path);
    if (real === undefined) {
      if (candidate.source === 'config') {
        missing.push(candidate.path);
      }
      continue;
    }
    roots.push({ path: candidate.path, real, name: rootName(candidate.path), source: candidate.source });
    derived += candidate.source === 'sessions' ? 1 : 0;
  }
  // A root inside another one adds nothing to what can be browsed: the list the user sees is the outermost ones.
  const outermost = roots.filter((root) => !roots.some((other) => other !== root && pathKey(other.real) !== pathKey(root.real) && isInside(other.real, root.real)));
  const unique = outermost.filter((root, index) => outermost.findIndex((other) => pathKey(other.real) === pathKey(root.real)) === index);
  return { roots: unique, known, missing, configFile: configured.file, configProblem };
}

/** The root that holds `path`, by name (the path as written, or with links resolved when the root itself is a link); the deepest one wins. */
export function rootOf(scope: Scope, path: string): FolderRoot | undefined {
  const holding = scope.roots.filter((root) => isInside(root.path, path) || isInside(root.real, path));
  return holding.sort((a, b) => b.real.length - a.real.length)[0];
}

/** The sentence for the picker when the roots are empty or some are gone: what to do, in the words of the CLI. */
export function scopeNote(scope: Scope): string {
  const parts: string[] = scope.configProblem === '' ? [] : [scope.configProblem];
  if (scope.roots.length === 0) {
    parts.push(`No folder can be browsed yet: the roots are the parents of the folders your sessions ran in, and the folders listed under launchRoots in ${scope.configFile}. Add one with: agent-manager launch-roots add <path>. You can still type a path.`);
  }
  if (scope.missing.length > 0) {
    parts.push(`launchRoots lists ${scope.missing.length === 1 ? 'a folder that does not exist' : 'folders that do not exist'}: ${scope.missing.join(', ')}. Fix it with: agent-manager launch-roots remove <path>.`);
  }
  return parts.join(' ');
}

/** How long a scope is reused when nothing it was built from changed. */
export const SCOPE_TTL_MS = 4000;

async function mtimeSize(path: string): Promise<string> {
  try {
    const stats = await fs.stat(path);
    return `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return 'none';
  }
}

/**
 * The scope of the folder routes, rebuilt only when it can have changed. A tree click is a request, and a scope is a config.yml read, a registry read, a daemon call and
 * a realpath and stat per root: it is reused for SCOPE_TTL_MS while what it was built from looks the same, which is checked at every request with three cheap calls:
 * the size and modification time of config.yml (so `launch-roots add|remove` shows at once, whatever process wrote it), the modification time of the registry folder (a
 * session that starts or ends), and the working directories of the daemon's list (itself cached by the daemon client for 1.5 s).
 */
export function createScopeCache(owned: OwnedSource, now: () => number = () => Date.now()): { get(configDir: string): Promise<Scope> } {
  let held: { signature: string; at: number; scope: Scope } | undefined;
  return {
    async get(configDir) {
      const registry = resolveSessionsDir(process.env);
      const listed = await owned.list();
      const daemon = listed.ok ? listed.sessions.map((view) => `${view.id}=${view.cwd}`).sort().join(',') : `error:${listed.error.code}`;
      const signature = [configDir, await mtimeSize(join(configDir, 'config.yml')), registry, await mtimeSize(registry), daemon].join('|');
      const at = now();
      if (held !== undefined && held.signature === signature && at - held.at < SCOPE_TTL_MS) {
        return held.scope;
      }
      const built = await buildScope(configDir, owned);
      held = { signature, at, scope: built };
      return built;
    },
  };
}
