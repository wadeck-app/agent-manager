import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import * as realFs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AtomicWriteError, replaceFileAtomic, type AtomicFs } from './fsAtomic.js';

describe('replaceFileAtomic', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fx-atomic-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

  it('replaces the file whole and leaves no temp file', async () => {
    const file = join(dir, 'config.yml');
    await replaceFileAtomic(file, 'a: 1\n', realFs);
    await replaceFileAtomic(file, 'a: 2\n', realFs);
    expect(readFileSync(file, 'utf8')).toBe('a: 2\n');
    expect(readdirSync(dir)).toEqual(['config.yml']);
  });

  it('retries a rename that a Windows process holds for a moment (EPERM), then succeeds', async () => {
    let renames = 0;
    const fake: AtomicFs = {
      ...realFs,
      rename: async (from, to) => {
        renames += 1;
        if (renames < 3) {
          throw Object.assign(new Error('busy'), { code: 'EPERM' });
        }
        return realFs.rename(from, to);
      },
    };
    const file = join(dir, 'config.yml');
    await replaceFileAtomic(file, 'x\n', fake);
    expect(renames).toBe(3);
    expect(readFileSync(file, 'utf8')).toBe('x\n');
  });

  it('a rename that keeps failing is an AtomicWriteError naming the file, and the temp file is removed', async () => {
    const fake: AtomicFs = { ...realFs, rename: async () => Promise.reject(Object.assign(new Error('denied'), { code: 'EPERM' })) };
    const file = join(dir, 'config.yml');
    await expect(replaceFileAtomic(file, 'x\n', fake)).rejects.toThrow(new AtomicWriteError(file, new Error('denied')).message);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('another error code is not retried', async () => {
    let renames = 0;
    const fake: AtomicFs = { ...realFs, rename: async () => { renames += 1; return Promise.reject(Object.assign(new Error('no space'), { code: 'ENOSPC' })); } };
    await expect(replaceFileAtomic(join(dir, 'c.yml'), 'x', fake)).rejects.toBeInstanceOf(AtomicWriteError);
    expect(renames).toBe(1);
  });
});
