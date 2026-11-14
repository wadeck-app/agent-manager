/**
 * Whether a process with this pid exists. `process.kill(pid, 0)` sends nothing: EPERM means the process exists but belongs to
 * someone else (alive), ESRCH means it does not. Any other failure is not an answer and is not swallowed.
 *
 * The pid must be a positive integer: for kill, 0 and negative values address process GROUPS, which is never what a registry means.
 */
export function isPidAlive(pid: number, kill: (pid: number, signal: 0) => unknown = process.kill): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new RangeError(`pid must be a positive integer, got ${String(pid)}`);
  }
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM') {
      return true;
    }
    if (code === 'ESRCH') {
      return false;
    }
    throw error;
  }
}
