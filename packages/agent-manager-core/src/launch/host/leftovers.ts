import { isPidAlive } from '../../pidAlive.js';
import type { OwnedSessionRecord } from './types.js';

export interface Leftover {
  sessionId: string;
  pid: number;
  daemonPid: number | undefined;
  cwd: string;
}

/**
 * The `claude` children a crashed daemon may have left behind: the records that were `live` in the file with a child pid that is still alive.
 * Nothing is killed and nothing is assumed: a live pid may be an orphan of the old daemon OR a program that reused the number, so the answer is a
 * LIST for the user (and for `doctor`, which does not exist in this repo yet). Records that already ended (exited, interrupted) are not examined: the
 * pid of an ended process is never signalled, because it may belong to something else by now.
 * `isAlive` is replaceable for tests.
 */
export function findLeftovers(records: readonly OwnedSessionRecord[], isAlive: (pid: number) => boolean = isPidAlive): Leftover[] {
  const found: Leftover[] = [];
  for (const record of records) {
    if (record.hostKind === 'stream-json' && record.status === 'live' && record.pid !== undefined && Number.isInteger(record.pid) && record.pid > 0 && isAlive(record.pid)) {
      found.push({ sessionId: record.id, pid: record.pid, daemonPid: record.daemonPid, cwd: record.cwd });
    }
  }
  return found;
}

/** The sentence that explains a leftover to the user (shared by the daemon, the session list and doctor). */
export function describeLeftover(leftover: Leftover): string {
  return `process ${leftover.pid} (session ${leftover.sessionId}, folder ${leftover.cwd}) was started by the daemon ${leftover.daemonPid === undefined ? '(pid unknown)' : leftover.daemonPid} and is still alive although that daemon is gone: it may be a leftover claude (check it in the task manager and end it if so) or an unrelated program that reuses the pid; agent-manager never ends it by itself`;
}
