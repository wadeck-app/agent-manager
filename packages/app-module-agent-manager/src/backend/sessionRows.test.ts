import { mkdirSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionRowDto } from '../commons/api.js';
import { SLUG, putSession, textLine, toolUseLine, transcriptFile, useSandbox, userLine, writeLines } from './apiFixtures.js';
import { DIGEST_TAIL_BYTES, DIGEST_TEXT_CHARS, digestCacheSizes } from './transcriptDigest.js';
import { makeModule } from './testKit.js';

const box = useSandbox();

const rows = async (query = '') => {
  const { body } = await makeModule({ dataDir: box.data }).call('GET', `/sessions${query}`);
  return body;
};
const rowOf = (body: { sessions: (Partial<SessionRowDto> & { sessionId: string })[] }, id: string) => body.sessions.find((row) => row.sessionId === id);

describe('GET /sessions: the fields of the master-detail list', () => {
  it('has state, pinned, seen, reason, lastActivity and subagentCount on each row, and keeps the table fields', async () => {
    const id = putSession(box, process.pid, { status: 'waiting', waitingFor: 'permission prompt', name: 'api work' });
    writeLines(transcriptFile(box, id), [userLine(1, 'go'), textLine(2, 'I am working on it')]);
    const body = await rows();
    expect(body.ok).toBe(true);
    expect(body.userStateError).toBe('');
    expect(body).not.toHaveProperty('herdr');
    expect(body).not.toHaveProperty('herdrError');
    expect(rowOf(body, id)).toMatchObject({
      state: 'needs-you',
      pinned: false,
      seen: true,
      reason: 'permission prompt',
      lastActivity: 'I am working on it',
      activityNote: '',
      subagentCount: 0,
      // the columns of the table still work
      displayName: 'api work',
      statusDetail: 'waiting: permission prompt',
      aliveText: 'alive',
    });
    expect(body.tableColumns.length).toBeGreaterThan(0);
  });

  it('reason is empty when the session does not wait', async () => {
    const id = putSession(box, process.pid, { status: 'busy' });
    expect(rowOf(await rows(), id)).toMatchObject({ state: 'working', reason: '' });
  });

  it('pinned follows the pin route, seen is false while the finished work was not looked at', async () => {
    const id = putSession(box, process.pid, { status: 'idle', statusUpdatedAt: Date.now() - 60_000 });
    writeFileSync(join(box.data, 'agents-user-state.json'), JSON.stringify({ pinned: [id], seen: { [id]: Date.now() - 600_000 } }));
    expect(rowOf(await rows(), id)).toMatchObject({ state: 'done', pinned: true, seen: false });
    const { call } = makeModule({ dataDir: box.data });
    await call('POST', `/sessions/${id}/seen`);
    expect(rowOf((await call('GET', '/sessions')).body, id)).toMatchObject({ state: 'idle', pinned: true, seen: true });
  });

  it('pinOrder is the order the user pinned in (decision 46), -1 when not pinned, and an unpin closes the gap for the next pin', async () => {
    const first = putSession(box, process.pid, { status: 'idle' });
    const second = putSession(box, 999_001, { status: 'idle' });
    const third = putSession(box, 999_002, { status: 'idle' });
    const { call } = makeModule({ dataDir: box.data });
    await call('POST', `/sessions/${second}/pin`, { body: { pinned: true } });
    await call('POST', `/sessions/${first}/pin`, { body: { pinned: true } });
    const order = async () => {
      const body = (await call('GET', '/sessions?show=all')).body;
      return [first, second, third].map((id) => rowOf(body, id)?.pinOrder);
    };
    expect(await order()).toEqual([1, 0, -1]);
    await call('POST', `/sessions/${second}/pin`, { body: { pinned: false } });
    expect(await order()).toEqual([0, -1, -1]);
  });

  it('the latest tool call is the activity when it is the last thing written', async () => {
    const id = putSession(box, process.pid);
    writeLines(transcriptFile(box, id), [textLine(1, 'let me run it'), toolUseLine(2, 'toolu_1', 'Bash', { command: 'npm test' })]);
    expect(rowOf(await rows(), id)?.lastActivity).toBe('Bash: npm test');
  });

  it('a session with no transcript says so instead of showing an empty activity', async () => {
    const id = putSession(box, process.pid);
    expect(rowOf(await rows(), id)).toMatchObject({ lastActivity: '', activityNote: 'No transcript yet', subagentCount: 0 });
  });

  it('the activity follows the transcript (a changed file is read again), and is one short line', async () => {
    const id = putSession(box, process.pid);
    const file = transcriptFile(box, id);
    writeLines(file, [textLine(1, 'first')]);
    expect(rowOf(await rows(), id)?.lastActivity).toBe('first');
    // an unchanged file is served from the cache: the same answer
    expect(rowOf(await rows(), id)?.lastActivity).toBe('first');
    writeLines(file, [textLine(2, `second\n\n   line ${'w'.repeat(500)}`)], true);
    const activity = rowOf(await rows(), id)?.lastActivity as string;
    expect(activity.startsWith('second line w')).toBe(true);
    expect(activity.length).toBeLessThanOrEqual(DIGEST_TEXT_CHARS);
    expect(activity).not.toContain('\n');
  });

  it('reads only the end of a large transcript', async () => {
    const id = putSession(box, process.pid);
    // the old part is far larger than the tail that is read; only the end counts
    const old = Array.from({ length: 400 }, (_v, i) => textLine(i, `old ${i} ${'o'.repeat(1000)}`));
    writeLines(transcriptFile(box, id), [...old, textLine(1000, 'the latest')]);
    expect(DIGEST_TAIL_BYTES).toBeLessThan(400 * 1000);
    expect(rowOf(await rows(), id)?.lastActivity).toBe('the latest');
  });

  it('counts the sub-agents and notices a new one', async () => {
    const id = putSession(box, process.pid);
    writeLines(transcriptFile(box, id), [userLine(1, 'go')]);
    const dir = join(box.projects, SLUG, id, 'subagents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore' }));
    expect(rowOf(await rows(), id)?.subagentCount).toBe(1);
    writeFileSync(join(dir, 'agent-a2.meta.json'), JSON.stringify({ agentType: 'Plan' }));
    // the folder mtime is what the cache watches: make sure it moved on file systems with a coarse clock
    const later = new Date(Date.now() + 5_000);
    utimesSync(dir, later, later);
    expect(rowOf(await rows(), id)?.subagentCount).toBe(2);
  });

  it('an unreadable user state is reported in userStateError and the sessions stay listed', async () => {
    const id = putSession(box, process.pid);
    writeFileSync(join(box.data, 'agents-user-state.json'), '{"pinned": [');
    const body = await rows();
    expect(body.ok).toBe(true);
    expect(body.userStateError).toContain('agents-user-state.json');
    expect(rowOf(body, id)).toMatchObject({ pinned: false });
  });

  it('a registry that cannot be read is an inline error with no sessions', async () => {
    process.env['AGENT_MANAGER_SESSIONS_DIR'] = join(box.registry, 'missing');
    const body = await rows();
    expect(body).toMatchObject({ ok: false, sessions: [], userStateError: '', errorText: expect.stringContaining('AGENT_MANAGER_SESSIONS_DIR') });
    expect(body).not.toHaveProperty('herdr');
  });
});

describe('the transcript digest cache', () => {
  it('forgets the "no transcript" memos and the cached digests of sessions that left the registry', async () => {
    const id = putSession(box, process.pid);
    expect(rowOf(await rows(), id)?.activityNote).toContain('No transcript');
    expect(digestCacheSizes().missing).toBe(1);
    unlinkSync(join(box.registry, `${process.pid}.json`));
    await rows();
    expect(digestCacheSizes()).toEqual({ found: 0, missing: 0 });
  });
});
