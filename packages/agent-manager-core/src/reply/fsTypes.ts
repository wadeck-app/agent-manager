import type * as fsPromises from 'node:fs/promises';

/** The part of node:fs/promises the reply side uses; the service and every helper take it as a parameter so tests and callers can replace it. */
export type ReplyFs = Pick<typeof fsPromises, 'mkdir' | 'writeFile' | 'rename' | 'readFile' | 'readdir' | 'stat' | 'unlink' | 'appendFile' | 'rmdir'>;

export function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}
