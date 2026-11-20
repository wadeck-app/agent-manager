import { describe, expect, it } from 'vitest';
import { describeLeftover, findLeftovers } from './leftovers.js';
import type { OwnedSessionRecord } from './types.js';

function record(overrides: Partial<OwnedSessionRecord>): OwnedSessionRecord {
  return { id: 's', hostKind: 'stream-json', cwd: '/work/p', claudeVersion: '1', startedAt: 1, status: 'live', pid: 100, daemonPid: 7, ...overrides };
}

describe('findLeftovers', () => {
  it('lists the live stream-json records whose child pid is still alive, and nothing else', () => {
    const records = [
      record({ id: 'alive', pid: 100 }),
      record({ id: 'dead', pid: 200 }),
      record({ id: 'exited', pid: 100, status: 'exited' }),
      record({ id: 'interrupted', pid: 100, status: 'interrupted' }),
      record({ id: 'hc', hostKind: 'hc', pid: 100 }),
      record({ id: 'nopid', pid: undefined }),
    ];
    const probed: number[] = [];
    const found = findLeftovers(records, (pid) => {
      probed.push(pid);
      return pid === 100;
    });
    expect(found.map((leftover) => leftover.sessionId)).toEqual(['alive']);
    // The pid of an ended process is never probed, let alone signalled: it may belong to another program.
    expect(probed).toEqual([100, 200]);
  });

  it('describes a leftover with what to check and the promise not to kill it', () => {
    const text = describeLeftover({ sessionId: 's1', pid: 42, daemonPid: 7, cwd: '/work/p' });
    expect(text).toContain('process 42');
    expect(text).toContain('never ends it by itself');
  });
});
