import type { FolderEntryDto } from '../shared.js';

/** What the dialog knows about the folder the user picked (the path is what fills the Folder field). */
export interface FolderPick {
  path: string;
  name: string;
  /** Known only for a folder a picker listed: a path typed by hand has no branch to show. */
  branch?: string;
  hasGit?: boolean;
}

export function pickOf(entry: Pick<FolderEntryDto, 'path' | 'name' | 'branch' | 'hasGit'>): FolderPick {
  return { path: entry.path, name: entry.name, hasGit: entry.hasGit, ...(entry.branch === undefined ? {} : { branch: entry.branch }) };
}

/** The last segment of a path written with either separator (a root keeps its own text). */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part !== '');
  return parts.length === 0 ? path : parts[parts.length - 1]!;
}

/** The separator a path is written with: a backslash when it has one (Windows), else a slash. */
export function separatorOf(path: string): '\\' | '/' {
  return path.includes('\\') ? '\\' : '/';
}

/** Same folder, whatever the case and the trailing separator (the file system of the host decides case; the picker only needs to recognise what it just showed). */
export function samePath(a: string, b: string): boolean {
  const clean = (path: string): string => path.trim().replace(/[\\/]+$/, '').toLowerCase();
  return clean(a) === clean(b);
}

export interface TypedPath {
  /** The folder whose subfolders to list: the text up to the last separator (a drive root and "/" keep their separator: they are folders themselves). */
  dir: string;
  /** What follows the last separator: the start of a folder name, possibly empty. */
  partial: string;
  /** The text up to and including the last separator: what a completion is appended to. */
  head: string;
}

/**
 * Splits what the user typed at its last separator, or returns undefined while there is none (a word, not a path yet: the palette searches the known projects
 * instead). A drive without separator ("C:") is not a path yet either.
 */
export function splitTyped(text: string): TypedPath | undefined {
  const value = text.trimStart();
  const at = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'));
  if (at < 0) {
    return undefined;
  }
  const head = value.slice(0, at + 1);
  const partial = value.slice(at + 1);
  const trimmed = head.replace(/[\\/]+$/, '');
  // A drive root and "/" are folders themselves: their separator is part of the path.
  const dir = trimmed === '' ? head.slice(0, 1) : /^[A-Za-z]:$/.test(trimmed) ? `${trimmed}\\` : trimmed;
  return { dir, partial, head };
}

/** The subfolders whose name starts with `partial` (the case ignored), in their order. An empty partial keeps all. */
export function startingWith<T extends { name: string }>(entries: readonly T[], partial: string): T[] {
  const lower = partial.toLowerCase();
  return entries.filter((entry) => entry.name.toLowerCase().startsWith(lower));
}

/** The text a Tab or a click on a suggestion writes: the folder and the separator, ready for the next segment. */
export function completed(typed: TypedPath, entry: { name: string }): string {
  return `${typed.head}${entry.name}${separatorOf(typed.head)}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Favorites: kept in this browser (localStorage), like the host, model and permission mode of the dialog. A folder pinned here is not known to the server.
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export const FAVORITES_STORAGE_KEY = 'agent-manager.launch-favorites.v1';
export const MAX_FAVORITES = 50;

/** The pinned folders, in the order they were pinned. A missing key is none; a corrupt value is dropped with the reason (the caller shows it), never half read. */
export function readFavorites(): { folders: string[]; problem: string } {
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (raw === null) {
      return { folders: [], problem: '' };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
      return { folders: [], problem: `The pinned folders saved in this browser (${FAVORITES_STORAGE_KEY}) are not a list of paths and were ignored. Pin your folders again to replace them.` };
    }
    return { folders: [...new Set(parsed as string[])].slice(0, MAX_FAVORITES), problem: '' };
  } catch (error) {
    return { folders: [], problem: `The pinned folders of this browser cannot be read (${String(error)}).` };
  }
}

/** '' when saved, else why not (a browser that refuses storage): the pin then lasts until the dialog closes, and the picker says it. */
export function saveFavorites(folders: readonly string[]): string {
  try {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(folders));
    return '';
  } catch (error) {
    return `Your pinned folders could not be remembered for next time (${String(error)}).`;
  }
}

/** Pins or unpins a path. Pinning past MAX_FAVORITES is refused with the reason, not by dropping an older pin. */
export function toggleFavorite(folders: readonly string[], path: string): { folders: string[]; problem: string } {
  const present = folders.some((item) => samePath(item, path));
  if (present) {
    return { folders: folders.filter((item) => !samePath(item, path)), problem: '' };
  }
  if (folders.length >= MAX_FAVORITES) {
    return { folders: [...folders], problem: `At most ${MAX_FAVORITES} folders can be pinned: unpin one first.` };
  }
  return { folders: [...folders, path], problem: '' };
}
