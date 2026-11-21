import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { FolderError } from './errors.js';

/** Longest path accepted (the launch form has the same limit). */
export const MAX_PATH_CHARS = 1024;

/** A Windows drive path (a drive letter, a colon, then a separator). A rooted path without a drive and a drive-relative one mean something else per process, so they are refused. */
const DRIVE_PATH = /^[A-Za-z]:[\\/]/;

function example(): string {
  // violations-suppress: shared/no-out-of-repo-path a path as a plain value (an example or a test input), never read from disk
  return process.platform === 'win32' ? 'C:\\Projects\\shop' : '/home/me/shop';
}

/**
 * The absolute path the text names, normalized (no trailing separator except a root), or a FolderError saying what is wrong with it.
 * Refused, never repaired: an empty text, control characters, a relative path, a rooted path without a drive (Windows), a `..` segment (path traversal: the
 * caller must say the real folder), and a UNC path (`\\server\share`: opening it makes this machine talk to another one, and could send credentials to it).
 */
export function checkAbsolutePath(raw: unknown, what = 'path'): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new FolderError('path-missing', `${what} is empty`, `give the absolute path of a folder, e.g. ${example()}`);
  }
  const text = raw.trim();
  if (text.length > MAX_PATH_CHARS) {
    throw new FolderError('path-invalid', `${what} has ${text.length} characters, the limit is ${MAX_PATH_CHARS}`, 'give the real path of the folder');
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    throw new FolderError('path-invalid', `${what} contains control characters`, 'give a path on a single line, without control characters');
  }
  if (text.startsWith('\\\\') || (process.platform === 'win32' && text.startsWith('//'))) {
    throw new FolderError('path-unc', `${what} '${text}' is a network (UNC) path`, 'network paths are not browsed; map the share to a drive letter, or type the path of a local folder');
  }
  if (text.split(/[\\/]+/).includes('..')) {
    throw new FolderError('path-traversal', `${what} '${text}' contains a '..' segment`, "write the real path without '..'");
  }
  const absolute = process.platform === 'win32' ? DRIVE_PATH.test(text) : isAbsolute(text);
  if (!absolute) {
    throw new FolderError('path-not-absolute', `${what} '${text}' is not an absolute path`, `start from the root, e.g. ${example()}`);
  }
  return resolve(text);
}

/** The key two spellings of the same folder share: normalized, and lower case where the file system ignores the case (Windows). */
export function pathKey(path: string): string {
  const normalized = resolve(path);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/** True when `child` is `root` or below it (by name: symbolic links are the caller's business, see the browse code). */
export function isInside(root: string, child: string): boolean {
  const rel = relative(resolve(root), resolve(child));
  if (rel === '') {
    return true;
  }
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** True for a drive root and for `/`: the folder with no parent. */
export function isFilesystemRoot(path: string): boolean {
  const normalized = resolve(path);
  return dirname(normalized) === normalized;
}

/** The parent folder, or null at the root. */
export function parentOf(path: string): string | null {
  const normalized = resolve(path);
  const parent = dirname(normalized);
  return parent === normalized ? null : parent;
}
