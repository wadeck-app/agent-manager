import * as fs from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { getErrorMessage } from '@wadeck-app/agent-manager-core';
import { FolderError, checkAbsolutePath, isInside, parentOf, pathKey } from '@wadeck-app/agent-manager-core/folders';
import type { FolderCrumbDto, FolderEntryDto, FolderListOk, FolderSearchResultDto } from '../commons/api.js';
import { rootOf, type FolderRoot, type Scope } from './foldersScope.js';

/** Subfolders sent by one listing. */
export const MAX_ENTRIES = 300;
/** Directory entries read before a listing gives up (a folder with a million entries must not hold a request): the answer is then flagged truncated. */
const MAX_SCANNED = 5000;
/** Results of a search. */
export const MAX_RESULTS = 30;
/** Folders the project scan keeps (depth 1 and 2 of every root). */
const MAX_PROJECTS = 4000;
/** The scan of the roots is reused this long. */
export const SCAN_CACHE_MS = 30_000;
/** Parallel file system calls (a stat of `.git` per folder): enough to be fast, few enough not to starve the machine. */
const PARALLEL = 16;

/** Folders never listed: hidden ones (a leading dot), dependency and system folders. They can still be typed. */
const TECHNICAL = new Set(['node_modules', '$recycle.bin', 'system volume information', 'windows.old']);

function isHidden(name: string): boolean {
  return name.startsWith('.') || TECHNICAL.has(name.toLowerCase());
}

async function inChunks<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let index = 0; index < items.length; index += PARALLEL) {
    out.push(...(await Promise.all(items.slice(index, index + PARALLEL).map(work))));
  }
  return out;
}

export interface GitInfo {
  hasGit: boolean;
  branch?: string;
}

/**
 * Whether `dir` is a git working tree and on which branch, from the files alone (no process: `.git` is a folder, or a file `gitdir: <path>` for a worktree,
 * and HEAD says `ref: refs/heads/<branch>`). Only the branch name leaves this function: HEAD of a worktree may live outside the roots, its content is not sent.
 */
export async function gitInfo(dir: string): Promise<GitInfo> {
  const dot = join(dir, '.git');
  let headFile: string;
  try {
    const stats = await fs.stat(dot);
    if (stats.isDirectory()) {
      headFile = join(dot, 'HEAD');
    } else {
      const pointer = /^gitdir:\s*(.+?)\s*$/m.exec((await fs.readFile(dot, 'utf8')).slice(0, 1024));
      if (pointer === null) {
        return { hasGit: true };
      }
      headFile = join(isAbsolute(pointer[1]!) ? pointer[1]! : resolve(dir, pointer[1]!), 'HEAD');
    }
  } catch {
    return { hasGit: false };
  }
  try {
    const head = /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec((await fs.readFile(headFile, 'utf8')).slice(0, 1024));
    return head === null ? { hasGit: true } : { hasGit: true, branch: head[1]! };
  } catch {
    return { hasGit: true };
  }
}

function entryOf(path: string, git: GitInfo, scope: Scope, isLink: boolean): FolderEntryDto {
  const isRecent = scope.known.folders.has(pathKey(path));
  return {
    name: basename(path) === '' ? path : basename(path),
    path,
    hasGit: git.hasGit,
    isRecent,
    isKnownProject: isRecent || git.hasGit,
    isLink,
    ...(git.branch === undefined ? {} : { branch: git.branch }),
  };
}

function errorOf(error: unknown, path: string): FolderError {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new FolderError('folder-not-found', `${path} does not exist`, 'check the path, or pick a folder from the list');
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new FolderError('folder-unreadable', `${path} cannot be read by the app-core process (${code})`, 'pick another folder, or fix the permissions of this one');
  }
  return new FolderError('folder-unreadable', `${path} cannot be read (${getErrorMessage(error)})`, 'pick another folder, then retry');
}

export interface Browsable {
  /** The normalized path, as the caller wrote it. */
  path: string;
  root: FolderRoot;
}

/**
 * The folder a request names, when it may be listed. Order matters: the NAME is checked against the roots before the disk is touched (so a path outside the roots
 * never reveals whether it exists), then the real folder (links resolved) must still be inside a root: a link or junction in a root cannot lead out of it.
 */
export async function checkBrowsable(raw: string, scope: Scope): Promise<Browsable> {
  const path = checkAbsolutePath(raw, 'the folder');
  const outside = new FolderError(
    'folder-not-browsable',
    `${path} is outside the folders that can be browsed`,
    scope.roots.length === 0
      ? `no root is known yet: run 'agent-manager launch-roots add <path>' for the folder that holds your projects, or type the path in the Folder field (the daemon checks it at launch)`
      : `browse one of: ${scope.roots.map((root) => root.path).join(', ')}; or run 'agent-manager launch-roots add ${path}' to allow this folder; typing the path in the Folder field works without it`,
  );
  const named = rootOf(scope, path);
  if (named === undefined) {
    throw outside;
  }
  let real: string;
  try {
    real = await fs.realpath(path);
    if (!(await fs.stat(real)).isDirectory()) {
      throw new FolderError('not-a-folder', `${path} is a file, not a folder`, 'pick a folder');
    }
  } catch (error) {
    throw error instanceof FolderError ? error : errorOf(error, path);
  }
  if (!scope.roots.some((root) => isInside(root.real, real))) {
    throw outside;
  }
  return { path, root: named };
}

function breadcrumbsOf(root: FolderRoot, path: string): FolderCrumbDto[] {
  const crumbs: FolderCrumbDto[] = [{ name: root.path, path: root.path }];
  // The segments between the root and the folder, by name: the root may be a link, the path is written from it.
  const base = isInside(root.path, path) ? root.path : root.real;
  const rest = resolve(path).slice(resolve(base).length).split(/[\\/]+/).filter((part) => part !== '');
  let current = root.path;
  for (const part of rest) {
    current = join(current, part);
    crumbs.push({ name: part, path: current });
  }
  return crumbs;
}

/** The subfolders of a folder inside the roots. See FolderListOk. */
export async function listFolder(raw: string, scope: Scope): Promise<FolderListOk> {
  const { path, root } = await checkBrowsable(raw, scope);
  let directory;
  try {
    directory = await fs.opendir(path);
  } catch (error) {
    throw errorOf(error, path);
  }
  const found: { name: string; isLink: boolean }[] = [];
  let skipped = 0;
  let scanned = 0;
  let truncated = false;
  try {
    for await (const dirent of directory) {
      scanned += 1;
      if (scanned > MAX_SCANNED) {
        truncated = true;
        break;
      }
      let isDirectory = dirent.isDirectory();
      const isLink = dirent.isSymbolicLink();
      if (!isDirectory && !isLink && !dirent.isFile()) {
        // A file system that does not say the type in the listing (type unknown): ask.
        isDirectory = await fs.stat(join(path, dirent.name)).then((stats) => stats.isDirectory(), () => false);
      }
      if (!isDirectory && !isLink) {
        continue;
      }
      if (isHidden(dirent.name)) {
        skipped += 1;
        continue;
      }
      if (isLink) {
        // A link or junction is listed only when it leads to a folder inside the roots.
        const target = await fs.realpath(join(path, dirent.name)).then(
          async (real) => ((await fs.stat(real)).isDirectory() ? real : undefined),
          () => undefined,
        );
        if (target === undefined || !scope.roots.some((candidate) => isInside(candidate.real, target))) {
          skipped += 1;
          continue;
        }
      }
      found.push({ name: dirent.name, isLink });
    }
  } catch (error) {
    throw errorOf(error, path);
  }
  found.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (found.length > MAX_ENTRIES) {
    truncated = true;
  }
  const kept = found.slice(0, MAX_ENTRIES);
  const entries = await inChunks(kept, async ({ name, isLink }) => {
    const child = join(path, name);
    return entryOf(child, await gitInfo(child), scope, isLink);
  });
  const own = await gitInfo(path);
  const parent = pathKey(path) === pathKey(root.path) || pathKey(path) === pathKey(root.real) ? null : parentOf(path);
  return {
    ok: true,
    path,
    name: basename(path) === '' ? path : basename(path),
    parent,
    breadcrumbs: breadcrumbsOf(root, path),
    entries,
    truncated,
    limit: MAX_ENTRIES,
    skipped,
    hasGit: own.hasGit,
    warnings: scope.known.warnings,
    ...(own.branch === undefined ? {} : { branch: own.branch }),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------------------------------------------------------------------------------

interface Project {
  path: string;
  git: GitInfo;
}

interface ScanResult {
  projects: Project[];
  /** The scan stopped at MAX_PROJECTS. */
  capped: boolean;
}

async function subfolders(dir: string, scope: Scope): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const dirent of await fs.opendir(dir)) {
      if (names.length >= MAX_ENTRIES * 2) {
        break;
      }
      // Links are not followed by the scan: a project is found where it really is, or by its own root.
      if (dirent.isDirectory() && !isHidden(dirent.name)) {
        names.push(join(dir, dirent.name));
      }
    }
  } catch {
    // An unreadable subfolder is not a project; the scan goes on (it is a search aid, listing a folder reports its errors).
  }
  return names.filter((path) => scope.roots.some((root) => isInside(root.real, path) || isInside(root.path, path)));
}

/** The folders at depth 1 and 2 of every root, with their git state: the "known projects" besides the recent folders. */
export async function scanProjects(scope: Scope): Promise<ScanResult> {
  const seen = new Set<string>();
  const paths: string[] = [];
  let capped = false;
  const take = (path: string): void => {
    const key = pathKey(path);
    if (!seen.has(key)) {
      seen.add(key);
      paths.push(path);
    }
  };
  for (const root of scope.roots) {
    take(root.path);
    const first = await subfolders(root.path, scope);
    first.forEach(take);
    const second = await inChunks(first, (dir) => subfolders(dir, scope));
    second.flat().forEach(take);
    if (paths.length >= MAX_PROJECTS) {
      capped = true;
      break;
    }
  }
  const limited = paths.slice(0, MAX_PROJECTS);
  const projects = await inChunks(limited, async (path) => ({ path, git: await gitInfo(path) }));
  return { projects, capped: capped || paths.length > MAX_PROJECTS };
}

let cache: { key: string; at: number; scan: Promise<ScanResult> } | undefined;

/** The scan of the roots, shared by the requests of the same 30 seconds (one scan in flight at a time). A failed scan is not cached. */
export function cachedScan(scope: Scope, now: number = Date.now()): Promise<ScanResult> {
  const key = scope.roots.map((root) => pathKey(root.real)).sort().join('|');
  if (cache !== undefined && cache.key === key && now - cache.at < SCAN_CACHE_MS) {
    return cache.scan;
  }
  const scan = scanProjects(scope);
  const entry = { key, at: now, scan };
  cache = entry;
  scan.catch(() => {
    if (cache === entry) {
      cache = undefined;
    }
  });
  return scan;
}

/** For tests: forgets the cached scan. */
export function resetScanCache(): void {
  cache = undefined;
}

/** Every character of the query appears in the text in order: the smallest fuzzy match. */
function isSubsequence(query: string, text: string): boolean {
  let at = 0;
  for (const char of text) {
    if (char === query[at]) {
      at += 1;
      if (at === query.length) {
        return true;
      }
    }
  }
  return query.length === 0;
}

/** The score of one word of the query against a folder; 0 when it does not match. Name beats path, a prefix beats a substring beats a scattered match. */
function wordScore(word: string, name: string, path: string): number {
  if (name.startsWith(word)) {
    return 100;
  }
  if (name.includes(word)) {
    return 70;
  }
  if (isSubsequence(word, name)) {
    return 40;
  }
  if (path.includes(word)) {
    return 20;
  }
  return isSubsequence(word, path) ? 10 : 0;
}

/** The score of a folder for a query (every word must match), 0 when it does not match. Exported for the tests. */
export function searchScore(query: string, path: string, extra: { isRecent: boolean; hasGit: boolean }): number {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) {
    return 0;
  }
  const lowerPath = path.toLowerCase();
  const name = basename(path).toLowerCase();
  let total = 0;
  for (const word of words) {
    const score = wordScore(word, name, lowerPath);
    if (score === 0) {
      return 0;
    }
    total += score;
  }
  return total + (extra.isRecent ? 25 : 0) + (extra.hasGit ? 8 : 0);
}

export interface SearchOutcome {
  results: FolderSearchResultDto[];
  truncated: boolean;
  scanned: number;
}

/**
 * Fuzzy search over the known projects: the recent folders (wherever they are) and the folders at depth 1 and 2 of the roots. An empty query lists the
 * recent ones first. Results are folders that exist, at most MAX_RESULTS, best first (ties: the most recent, then by name).
 */
export async function searchFolders(query: string, scope: Scope, now: number = Date.now()): Promise<SearchOutcome> {
  const scan = await cachedScan(scope, now);
  const candidates = new Map<string, { path: string; git?: GitInfo }>();
  for (const project of scan.projects) {
    candidates.set(pathKey(project.path), project);
  }
  for (const folder of scope.known.folders.values()) {
    if (!candidates.has(pathKey(folder.path))) {
      candidates.set(pathKey(folder.path), { path: folder.path });
    }
  }
  const scored: { path: string; git?: GitInfo; score: number; lastUsedAt: number }[] = [];
  for (const candidate of candidates.values()) {
    const known = scope.known.folders.get(pathKey(candidate.path));
    const score = query.trim() === '' ? (known === undefined ? 0 : 1) : searchScore(query, candidate.path, { isRecent: known !== undefined, hasGit: candidate.git?.hasGit === true });
    if (score > 0) {
      scored.push({ ...candidate, score, lastUsedAt: known?.lastUsedAt ?? 0 });
    }
  }
  scored.sort((a, b) => b.score - a.score || b.lastUsedAt - a.lastUsedAt || a.path.localeCompare(b.path));
  const truncated = scored.length > MAX_RESULTS || scan.capped;
  const top = scored.slice(0, MAX_RESULTS);
  const results = (
    await inChunks(top, async (candidate): Promise<FolderSearchResultDto | undefined> => {
      // A recent folder may be gone: it is not offered for a search (the recent list says it).
      const stats = await fs.stat(candidate.path).catch(() => undefined);
      if (stats === undefined || !stats.isDirectory()) {
        return undefined;
      }
      const git = candidate.git ?? (await gitInfo(candidate.path));
      const known = scope.known.folders.get(pathKey(candidate.path));
      return { ...entryOf(candidate.path, git, scope, false), ...(known === undefined ? {} : { lastUsedAt: known.lastUsedAt }) };
    })
  ).filter((result): result is FolderSearchResultDto => result !== undefined);
  return { results, truncated, scanned: candidates.size };
}
