import { join } from 'node:path';
import * as realFs from 'node:fs/promises';
import { errorCode } from './fsTypes.js';
import type { ReplyFs } from './fsTypes.js';

/** Decision 21: 90 days and 200 MB per data category. */
export const DEFAULT_MAX_AGE_MS = 90 * 86_400_000;
export const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;

export type PurgeCategory = 'uploads' | 'audit' | 'history';
export const PURGE_CATEGORIES: readonly PurgeCategory[] = ['uploads', 'audit', 'history'];

export interface PurgeOptions {
  configDir: string;
  /** Default 90 days. Files older than this (by modification time) go. */
  maxAgeMs?: number;
  /** Default 200 MB per category. When a category is still bigger, the oldest files go first. */
  maxBytes?: number;
  /** Epoch ms. Default: now. */
  now?: number;
  fs?: ReplyFs;
}

export interface PurgeCategoryResult {
  deleted: number;
  bytesFreed: number;
  kept: number;
  bytesKept: number;
  /** Files that could not be deleted, with the reason: a failure is reported, never swallowed. */
  failures: { path: string; reason: string }[];
}

export type PurgeResult = Record<PurgeCategory, PurgeCategoryResult>;

interface Entry {
  path: string;
  mtimeMs: number;
  size: number;
}

async function listFiles(fs: ReplyFs, dir: string, out: Entry[], folders: string[]): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return;
    }
    throw error;
  }
  for (const name of names) {
    const path = join(dir, name);
    const info = await fs.stat(path);
    if (info.isDirectory()) {
      folders.push(path);
      await listFiles(fs, path, out, folders);
    } else if (info.isFile()) {
      out.push({ path, mtimeMs: info.mtimeMs, size: info.size });
    }
  }
}

async function purgeCategory(fs: ReplyFs, dir: string, maxAgeMs: number, maxBytes: number, now: number): Promise<PurgeCategoryResult> {
  const files: Entry[] = [];
  const folders: string[] = [];
  await listFiles(fs, dir, files, folders);
  // Oldest first, ties by path so that the order is deterministic.
  files.sort((a, b) => a.mtimeMs - b.mtimeMs || (a.path < b.path ? -1 : 1));
  const result: PurgeCategoryResult = { deleted: 0, bytesFreed: 0, kept: 0, bytesKept: 0, failures: [] };
  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files) {
    const tooOld = now - file.mtimeMs > maxAgeMs;
    const tooBig = total > maxBytes;
    if (!tooOld && !tooBig) {
      result.kept++;
      result.bytesKept += file.size;
      continue;
    }
    try {
      await fs.unlink(file.path);
      result.deleted++;
      result.bytesFreed += file.size;
      total -= file.size;
    } catch (error) {
      result.failures.push({ path: file.path, reason: (error as Error).message });
      result.kept++;
      result.bytesKept += file.size;
    }
  }
  // Empty sub-folders (a session folder of uploads) go too; deepest first. A folder that is not empty is left, which is not a failure.
  for (const folder of folders.reverse()) {
    await fs.rmdir(folder).catch(() => undefined);
  }
  return result;
}

/**
 * Retention of the stored data (decision 21, 39): `<configDir>/uploads`, `<configDir>/audit` and `<configDir>/history` each lose the files older than
 * `maxAgeMs`, then, while the category is over `maxBytes`, the oldest files first. A missing folder is an empty category. Returns the counts.
 */
export async function purge(options: PurgeOptions): Promise<PurgeResult> {
  const fs = options.fs ?? realFs;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const now = options.now ?? Date.now();
  const result = {} as PurgeResult;
  for (const category of PURGE_CATEGORIES) {
    result[category] = await purgeCategory(fs, join(options.configDir, category), maxAgeMs, maxBytes, now);
  }
  return result;
}
