import { randomBytes } from 'node:crypto';
import type * as fsPromises from 'node:fs/promises';
import { getErrorMessage } from './errors.js';

/** The part of node:fs/promises the atomic replacement uses (callers may give a fake one). */
export type AtomicFs = Pick<typeof fsPromises, 'writeFile' | 'rename' | 'unlink'>;

/** The file could not be replaced. `message` names the file and the cause; each caller maps it to its own error with its own fix. */
export class AtomicWriteError extends Error {
  constructor(file: string, cause: unknown) {
    super(`cannot write ${file} (${getErrorMessage(cause)})`);
    this.name = 'AtomicWriteError';
  }
}

const RENAME_RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_ATTEMPTS = 5;

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Replaces `file` by `next` (temp file in the same folder, then rename). On Windows a rename onto a file another process has open fails with EPERM/EACCES/EBUSY
 * for a moment (an editor, an antivirus, the updater reading config.yml): retried a few times briefly, then an AtomicWriteError. NO LOCK: two processes changing the
 * file at the same instant can lose one change (out of scope: the file is replaced whole, never half written). The temp file is removed on failure.
 */
export async function replaceFileAtomic(file: string, next: string, fs: AtomicFs): Promise<void> {
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, next, 'utf8');
    for (let attempt = 1; ; attempt++) {
      try {
        await fs.rename(temp, file);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code ?? '';
        if (!RENAME_RETRYABLE.has(code) || attempt >= RENAME_ATTEMPTS) {
          throw error;
        }
        await pause(25 * attempt);
      }
    }
  } catch (error) {
    await fs.unlink(temp).catch(() => undefined);
    throw new AtomicWriteError(file, error);
  }
}
