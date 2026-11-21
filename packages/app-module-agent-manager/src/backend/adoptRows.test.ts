import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SLUG, putSession, textLine, toolResultLine, toolUseLine, transcriptFile, useSandbox, userLine, writeLines } from './apiFixtures.js';
import { createDaemonApi } from './daemon/daemonApi.js';
import { ownedView, startFakeDaemon } from './daemon/fakeDaemon.js';
import type { FakeDaemon } from './daemon/fakeDaemon.js';
import { makeModule } from './testKit.js';

/*
 * `adoptReadiness` on every row of GET /sessions (#71 phase 1): {state: free | busy | unknown, reasons}. Computed here from the signals that exist on this side
 * (registry status, transcript tail, sub-agent files, the daemon's pending permissions); the daemon computes it again at the moment of a switch. The rule itself
 * is tested in agent-manager-core (readiness.test.ts); these tests prove each signal reaches the row.
 */

const box = useSandbox();
let daemon: FakeDaemon | undefined;
afterEach(async () => {
  await daemon?.stop();
  daemon = undefined;
});

interface Row {
  sessionId: string;
  adoptReadiness: { state: 'free' | 'busy' | 'unknown'; reasons: string[] };
}

async function rowOf(id: string, withDaemon = false): Promise<Row> {
  if (withDaemon && daemon === undefined) {
    daemon = await startFakeDaemon(box.config);
  }
  const mod = makeModule({ dataDir: box.data, options: withDaemon ? { daemon: createDaemonApi({ cacheMs: 0, timeoutMs: 3000 }) } : {} });
  const { body } = await mod.call('GET', '/sessions');
  const row = (body.sessions as Row[]).find((candidate) => candidate.sessionId === id);
  if (row === undefined) {
    throw new Error(`no row for ${id}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return row;
}

/** A live session (this process's parent) with a transcript of the given lines; its registry status is old enough to be settled. */
function session(pid: number, lines: Record<string, unknown>[], fields: Record<string, unknown> = {}): string {
  const id = putSession(box, pid, { cwd: '/work/shop', ...fields });
  writeLines(transcriptFile(box, id), lines);
  return id;
}

const QUIET = [userLine(1, 'hello'), textLine(2, 'hi')];
const notification = (toolUseId: string, status: string): string => `<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>${status}</status>\n</task-notification>`;
const queueLine = (seconds: number, operation: string, content?: string): Record<string, unknown> => ({ type: 'queue-operation', operation, timestamp: new Date(Date.UTC(2026, 10, 15, 10, 0, seconds)).toISOString(), sessionId: 's', ...(content === undefined ? {} : { content }) });

describe('adoptReadiness of a row', () => {
  it('is free for an idle session whose transcript shows nothing in flight', async () => {
    const id = session(process.ppid, QUIET);
    expect((await rowOf(id)).adoptReadiness).toEqual({ state: 'free', reasons: [] });
  });

  it('is busy while the registry says busy, with the reason that names what is lost', async () => {
    const id = session(process.ppid, QUIET, { status: 'busy' });
    const { adoptReadiness } = await rowOf(id);
    expect(adoptReadiness.state).toBe('busy');
    expect(adoptReadiness.reasons[0]).toMatch(/turn is running.*partial answer is lost/i);
  });

  it('is busy while the session waits, naming what it waits on', async () => {
    const id = session(process.ppid, QUIET, { status: 'waiting', waitingFor: 'permission prompt' });
    expect((await rowOf(id)).adoptReadiness.reasons[0]).toMatch(/permission prompt.*not replayed/i);
  });

  it('is busy with an unmatched tool call, free again once its result is written (the cache follows the file)', async () => {
    const id = session(process.ppid, [userLine(1, 'go'), toolUseLine(2, 'toolu_1', 'Bash', { command: 'node wait.mjs' })]);
    const busy = (await rowOf(id)).adoptReadiness;
    expect(busy.state).toBe('busy');
    expect(busy.reasons[0]).toContain('node wait.mjs');
    writeLines(transcriptFile(box, id), [toolResultLine(3, 'toolu_1', 'done'), textLine(4, 'finished')], true);
    expect((await rowOf(id)).adoptReadiness).toEqual({ state: 'free', reasons: [] });
  });

  it('is busy with a background task that has no completion notice, free once the notice is in the transcript', async () => {
    const id = session(process.ppid, [userLine(1, 'go'), toolUseLine(2, 'toolu_bg', 'Bash', { command: 'npm run watch', run_in_background: true }), toolResultLine(3, 'toolu_bg', 'running in background'), textLine(4, 'started')]);
    const busy = (await rowOf(id)).adoptReadiness;
    expect(busy.state).toBe('busy');
    expect(busy.reasons[0]).toMatch(/Background.*npm run watch.*not restored/);
    writeLines(transcriptFile(box, id), [queueLine(5, 'enqueue', notification('toolu_bg', 'completed')), queueLine(6, 'dequeue')], true);
    expect((await rowOf(id)).adoptReadiness.state).toBe('free');
  });

  it('is busy with a queued message that was not absorbed', async () => {
    const id = session(process.ppid, [...QUIET, queueLine(3, 'enqueue', 'typed while busy')]);
    expect((await rowOf(id)).adoptReadiness.reasons[0]).toMatch(/1 queued message/);
  });

  it('is busy with an active sub-agent, and free when the sub-agent is marked finished', async () => {
    const id = session(process.ppid, QUIET);
    const dir = join(box.projects, SLUG, id, 'subagents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'research', finished: false }));
    writeFileSync(join(dir, 'agent-a1.jsonl'), `${JSON.stringify(userLine(3, 'sub task'))}\n`);
    const busy = (await rowOf(id)).adoptReadiness;
    expect(busy.state).toBe('busy');
    expect(busy.reasons[0]).toMatch(/1 sub-agent active/);
    writeFileSync(join(dir, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'research', finished: true }));
    // The folder itself did not change (a meta file was rewritten in place): the row must still notice.
    expect((await rowOf(id)).adoptReadiness.state).toBe('free');
  });

  it('is unknown, never free, when there is no transcript', async () => {
    const id = putSession(box, process.ppid, { cwd: '/work/shop' });
    const { adoptReadiness } = await rowOf(id);
    expect(adoptReadiness.state).toBe('unknown');
    expect(adoptReadiness.reasons[0]).toMatch(/Cannot tell.*Treated as busy/);
  });

  it('is unknown while the status changed less than 3 seconds ago (still settling)', async () => {
    const id = session(process.ppid, QUIET, { statusUpdatedAt: Date.now() - 500 });
    expect((await rowOf(id)).adoptReadiness).toMatchObject({ state: 'unknown', reasons: [expect.stringMatching(/settling/)] });
  });

  it('is unknown for a status this version does not know', async () => {
    const id = session(process.ppid, QUIET, { status: 'frobnicating' });
    expect((await rowOf(id)).adoptReadiness).toMatchObject({ state: 'unknown', reasons: [expect.stringContaining('frobnicating')] });
  });

  it('counts the permission requests an owned Web session waits on', async () => {
    daemon = await startFakeDaemon(box.config);
    const id = session(process.ppid, QUIET);
    daemon.sessions.push(ownedView({ id, cwd: '/work/shop', state: 'requires_action', pendingPermissions: 2 }));
    const { adoptReadiness } = await rowOf(id, true);
    expect(adoptReadiness.state).toBe('busy');
    expect(adoptReadiness.reasons.join(' ')).toMatch(/2 permission requests/);
  });

  it('an owned session that has no registry file yet (nothing written) is unknown: there is no transcript to read', async () => {
    daemon = await startFakeDaemon(box.config);
    const id = '00000000-0000-4000-8000-0000000000aa';
    daemon.sessions.push(ownedView({ id, cwd: '/work/shop', state: 'idle' }));
    expect((await rowOf(id, true)).adoptReadiness.state).toBe('unknown');
  });
});

describe('a stopped record whose last switch failed (#71 recovery)', () => {
  const FAILURE = { at: 1, target: 'stream-json' as const, reason: 'claude could not start' };

  it('stays in the list (an exited hc record is otherwise hidden) and carries the failure, so the page can offer Start on <target>', async () => {
    daemon = await startFakeDaemon(box.config);
    const id = '00000000-0000-4000-8000-0000000000bb';
    daemon.sessions.push(ownedView({ id, hostKind: 'hc', hcAddress: 't9', cwd: '/work/shop', status: 'exited', state: 'exited', resumable: false, switchFailure: FAILURE }));
    const row = (await rowOf(id, true)) as Row & { switchFailure?: unknown; host?: string };
    expect(row.switchFailure).toEqual(FAILURE);
    expect(row.host).toBe('hc');
  });

  it('without the failure the same exited hc record is not listed', async () => {
    daemon = await startFakeDaemon(box.config);
    const id = '00000000-0000-4000-8000-0000000000cc';
    daemon.sessions.push(ownedView({ id, hostKind: 'hc', hcAddress: 't9', cwd: '/work/shop', status: 'exited', state: 'exited', resumable: false }));
    await expect(rowOf(id, true)).rejects.toThrow(/no row for/);
  });
});
