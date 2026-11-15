import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Session } from '@wadeck-app/agent-manager-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DONE_WINDOW_MS, stateOf } from './agentState.js';
import { makeModule } from './testKit.js';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const ID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function session(n: number, overrides: Partial<Session> = {}): Session {
  return {
    file: `${n}.json`,
    pid: n,
    sessionId: ID(n),
    cwd: `/work/proj${n}`,
    folder: `proj${n}`,
    name: `owner${n}`,
    status: 'idle',
    statusGroup: 'idle',
    alive: true,
    livenessCheck: 'pid-only',
    version: '2.1.0',
    statusUpdatedAt: NOW - 90 * MIN,
    ...overrides,
  };
}

// Every test session was first seen long ago (the baseline the module writes); a status change since then is what makes a session Done.
const BASELINE: Record<string, number> = Object.fromEntries(Array.from({ length: 10 }, (_v, i) => [ID(i + 1), NOW - 600 * MIN]));

describe('stateOf: the mapping of the registry values', () => {
  it.each([
    [{ status: 'waiting', waitingFor: 'permission prompt' }, 'needs-you'],
    [{ status: 'waiting' }, 'needs-you'],
    [{ status: 'busy' }, 'working'],
    [{ status: 'shell' }, 'working'],
    [{ status: 'idle', statusUpdatedAt: NOW - 2 * MIN }, 'done'],
    [{ status: 'idle', statusUpdatedAt: NOW - 90 * MIN }, 'idle'],
    [{ status: 'idle', statusUpdatedAt: undefined }, 'idle'],
    [{ status: 'compacting' }, 'other'],
    [{ status: 'busy', alive: false }, 'ended'],
  ] as [Partial<Session>, string][])('%j is %s', (overrides, expected) => {
    expect(stateOf(session(1, overrides), BASELINE, NOW)).toBe(expected);
  });

  it('Done ends at the window, and when the user saw it after the last status change; a newer status change makes it Done again', () => {
    const finished = session(1, { statusUpdatedAt: NOW - 5 * MIN });
    expect(stateOf({ ...finished, statusUpdatedAt: NOW - DONE_WINDOW_MS }, BASELINE, NOW)).toBe('done');
    expect(stateOf({ ...finished, statusUpdatedAt: NOW - DONE_WINDOW_MS - 1 }, BASELINE, NOW)).toBe('idle');
    // no record yet (first poll, or the baseline write failed): never Done
    expect(stateOf(finished, {}, NOW)).toBe('idle');
    expect(stateOf(finished, { [ID(1)]: NOW - MIN }, NOW)).toBe('idle');
    // seen before the status changed again: a new finished turn
    expect(stateOf(finished, { [ID(1)]: NOW - 10 * MIN }, NOW)).toBe('done');
  });
});

describe('routes: GET /sessions (states, pins, seen markers) and the pin and seen routes', () => {
  let registry: string;
  let data: string;
  beforeEach(() => {
    registry = mkdtempSync(join(tmpdir(), 'agent-manager-herdr-registry-'));
    data = mkdtempSync(join(tmpdir(), 'agent-manager-herdr-data-'));
    process.env['AGENT_MANAGER_SESSIONS_DIR'] = registry;
  });
  afterEach(() => {
    delete process.env['AGENT_MANAGER_SESSIONS_DIR'];
    rmSync(registry, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    rmSync(data, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });

  const put = (pid: number, fields: Record<string, unknown>): void =>
    writeFileSync(join(registry, `${pid}.json`), JSON.stringify({ pid, sessionId: ID(pid), cwd: '/work/shop', version: '2.1.323', status: 'idle', statusUpdatedAt: Date.now() - 2 * MIN, ...fields }));
  const deadPid = (): number => {
    const child = spawnSync(process.execPath, ['--version'], { windowsHide: true });
    if (child.pid === undefined) {
      throw new Error('cannot start a child process to get a dead pid');
    }
    return child.pid;
  };
  // The state of each listed session, sorted; a pinned one has the suffix ':pinned'.
  const titles = (body: { sessions: { state: string; pinned: boolean }[] }): string[] => body.sessions.map((row) => (row.pinned ? `${row.state}:pinned` : row.state)).sort();

  const stateFile = (): { pinned: string[]; seen: Record<string, number> } => JSON.parse(readFileSync(join(data, 'agents-user-state.json'), 'utf8'));
  // A session that was first seen long enough ago, then changed status: the baseline is older than the status change.
  const baseline = (ids: string[], at: number): void => writeFileSync(join(data, 'agents-user-state.json'), JSON.stringify({ pinned: [], seen: Object.fromEntries(ids.map((id) => [id, at])) }));

  it('groups the registry: needs you, done, ended (show=all), and back to idle once seen', async () => {
    const dead = deadPid();
    put(process.pid, { status: 'waiting', waitingFor: 'permission prompt', statusUpdatedAt: Date.now() - 10_000 });
    put(process.ppid, { status: 'idle', statusUpdatedAt: Date.now() - 2 * MIN });
    put(dead, { status: 'busy' });
    baseline([ID(process.pid), ID(process.ppid), ID(dead)], Date.now() - 60 * MIN);
    const { call } = makeModule({ dataDir: data });
    const before = (await call('GET', '/sessions?show=all')).body;
    expect(before.userStateError).toBe('');
    expect(titles(before)).toEqual(['done', 'ended', 'needs-you']);

    const seen = await call('POST', `/sessions/${ID(process.ppid)}/seen`);
    expect(seen.status).toBe(200);
    const after = (await call('GET', '/sessions?show=all')).body;
    expect(titles(after)).toEqual(['ended', 'idle', 'needs-you']);
    // the seen marker is a file of the module data folder
    expect(JSON.parse(readFileSync(join(data, 'agents-user-state.json'), 'utf8')).seen[ID(process.ppid)]).toEqual(expect.any(Number));
  });

  it('a new session gets a baseline once and is not Done; busy -> idle after it is Done; marking it seen makes it Idle', async () => {
    put(process.pid, { status: 'idle', statusUpdatedAt: Date.now() - 2 * MIN });
    const { call } = makeModule({ dataDir: data });
    const first = (await call('GET', '/sessions')).body;
    expect(first.userStateError).toBe('');
    expect(titles(first)).toEqual(['idle']);
    const written = stateFile();
    expect(written.seen[ID(process.pid)]).toEqual(expect.any(Number));
    // a second poll does not rewrite the file
    const before = statSync(join(data, 'agents-user-state.json'));
    const text = readFileSync(join(data, 'agents-user-state.json'), 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(titles((await call('GET', '/sessions')).body)).toEqual(['idle']);
    expect(readFileSync(join(data, 'agents-user-state.json'), 'utf8')).toBe(text);
    expect(statSync(join(data, 'agents-user-state.json')).mtimeMs).toBe(before.mtimeMs);
    // busy, then idle again after the baseline: finished since the user last looked
    put(process.pid, { status: 'busy', statusUpdatedAt: Date.now() });
    expect(titles((await call('GET', '/sessions')).body)).toEqual(['working']);
    await new Promise((resolve) => setTimeout(resolve, 5));
    put(process.pid, { status: 'idle', statusUpdatedAt: Date.now() });
    expect(titles((await call('GET', '/sessions')).body)).toEqual(['done']);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await call('POST', `/sessions/${ID(process.pid)}/seen`)).status).toBe(200);
    expect(titles((await call('GET', '/sessions')).body)).toEqual(['idle']);
  });

  it('the new ids of one poll are written in a single write; pins are kept', async () => {
    put(process.pid, { status: 'idle' });
    put(process.ppid, { status: 'busy' });
    writeFileSync(join(data, 'agents-user-state.json'), JSON.stringify({ pinned: [ID(process.pid)], seen: {} }));
    const { call } = makeModule({ dataDir: data });
    await call('GET', '/sessions');
    const written = stateFile();
    expect(Object.keys(written.seen).sort()).toEqual([ID(process.pid), ID(process.ppid)].sort());
    expect(written.pinned).toEqual([ID(process.pid)]);
  });

  it('a failed baseline write is reported on the page (userStateError) and does not break the poll', async () => {
    put(process.pid, { status: 'idle' });
    // the data folder is a file: it cannot be created
    const notAFolder = join(data, 'file');
    writeFileSync(notAFolder, 'x');
    const page = (await makeModule({ dataDir: notAFolder }).call('GET', '/sessions')).body;
    expect(page.ok).toBe(true);
    // On Windows the read finds no file and the write then fails ("could not be saved"); on Linux and macOS the read already fails with ENOTDIR
    // ("cannot be read"). Either way the problem is reported, with the file and a hint, and never ignored.
    expect(page.userStateError).toMatch(/first-seen markers could not be saved|cannot be read/);
    expect(page.userStateError).toContain('agents-user-state.json');
    expect(page.sessions).toHaveLength(1);
    expect(titles(page)).toEqual(['idle']);
  });

  it('entries of sessions that left the registry are pruned, at most once per hour', async () => {
    put(process.pid, { status: 'idle', statusUpdatedAt: Date.now() - 2 * MIN });
    baseline([ID(process.pid), ID(999_001)], Date.now() - 60 * MIN);
    const { call } = makeModule({ dataDir: data });
    await call('GET', '/sessions');
    expect(Object.keys(stateFile().seen)).toEqual([ID(process.pid)]);
    // a stale entry added right after is kept: the next prune is an hour away
    baseline([ID(process.pid), ID(999_002)], Date.now() - 60 * MIN);
    await call('GET', '/sessions');
    expect(Object.keys(stateFile().seen).sort()).toEqual([ID(process.pid), ID(999_002)].sort());
  });

  it('pin and unpin: the session moves to Pinned and back, the pin survives in the data folder', async () => {
    put(process.pid, { status: 'busy' });
    const { call } = makeModule({ dataDir: data });
    expect(titles((await call('GET', '/sessions')).body)).toEqual(['working']);
    const pin = await call('POST', `/sessions/${ID(process.pid)}/pin`, { body: { pinned: true } });
    expect(pin).toMatchObject({ status: 200, body: { ok: true, pinned: true, pinnedCount: 1 } });
    expect(titles((await call('GET', '/sessions')).body)).toEqual(['working:pinned']);
    // a new module instance (a restart) reads the same file
    expect(titles((await makeModule({ dataDir: data }).call('GET', '/sessions')).body)).toEqual(['working:pinned']);
    await call('POST', `/sessions/${ID(process.pid)}/pin`, { body: { pinned: false } });
    expect(titles((await call('GET', '/sessions')).body)).toEqual(['working']);
  });

  it('pinning twice keeps one pin; the id is case-insensitive', async () => {
    const { call } = makeModule({ dataDir: data });
    const id = 'ABCDEF01-0000-4000-8000-000000000001';
    await call('POST', `/sessions/${id}/pin`, { body: { pinned: true } });
    const second = await call('POST', `/sessions/${id.toLowerCase()}/pin`, { body: { pinned: true } });
    expect(second.body.pinnedCount).toBe(1);
  });

  it.each(['abc', '../../x', ID(1) + 'x', 'x' + ID(1), '00000000-0000-4000-8000-00000000000g', '%24sources', '1234'])('refuses the session id %s with an actionable 400', async (id) => {
    const { call } = makeModule({ dataDir: data });
    for (const route of ['pin', 'seen']) {
      const answer = await call('POST', `/sessions/${encodeURIComponent(id)}/${route}`, { body: route === 'pin' ? { pinned: true } : undefined });
      expect(answer.status, `${id} ${route}`).toBe(400);
      expect(answer.body.hint).toContain('8-4-4-4-12');
    }
  });

  it.each([
    ['no body', undefined],
    ['null', null],
    ['an array', [true]],
    ['a string', 'yes'],
    ['pinned as text', { pinned: 'true' }],
    ['pinned missing', {}],
    ['an unknown field', { pinned: true, extra: 1 }],
  ])('refuses a pin body that is %s with an actionable 400, and writes nothing', async (_label, body) => {
    const { call } = makeModule({ dataDir: data });
    const answer = await call('POST', `/sessions/${ID(1)}/pin`, { body });
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ error: 'BAD_REQUEST', message: expect.any(String), hint: expect.stringContaining('pinned') });
    expect(() => readFileSync(join(data, 'agents-user-state.json'))).toThrow();
  });

  it('seen refuses a body, and an unknown session with a 404 that says what to do', async () => {
    put(process.pid, { status: 'idle' });
    const { call } = makeModule({ dataDir: data });
    expect((await call('POST', `/sessions/${ID(process.pid)}/seen`, { body: { x: 1 } })).status).toBe(400);
    const missing = await call('POST', `/sessions/${ID(999_999)}/seen`);
    expect(missing.status).toBe(404);
    expect(missing.body.hint).toContain('next refresh');
  });

  it('seen on an unreadable registry is a 409 with the registry hint', async () => {
    process.env['AGENT_MANAGER_SESSIONS_DIR'] = join(registry, 'missing');
    const answer = await makeModule({ dataDir: data }).call('POST', `/sessions/${ID(1)}/seen`);
    expect(answer.status).toBe(409);
    expect(answer.body.hint).toContain('AGENT_MANAGER_SESSIONS_DIR');
  });

  it('a corrupt user state file is reported (userStateError for the page, 500 with the file for a write) and never overwritten', async () => {
    put(process.pid, { status: 'busy' });
    writeFileSync(join(data, 'agents-user-state.json'), '{"pinned": [');
    const { call } = makeModule({ dataDir: data });
    const page = (await call('GET', '/sessions')).body;
    expect(page.ok).toBe(true);
    // the session stays listed (no pins, no seen markers) while the error is shown
    expect(titles(page)).toEqual(['working']);
    expect(page.userStateError).toContain('agents-user-state.json');
    const write = await call('POST', `/sessions/${ID(1)}/pin`, { body: { pinned: true } });
    expect(write.status).toBe(500);
    expect(write.body.message).toContain('not valid JSON');
    expect(readFileSync(join(data, 'agents-user-state.json'), 'utf8')).toBe('{"pinned": [');
  });

  it('a user state file of the wrong shape is reported, not trusted', async () => {
    writeFileSync(join(data, 'agents-user-state.json'), JSON.stringify({ pinned: ['not-an-id'], seen: {} }));
    put(process.pid, { status: 'busy' });
    expect((await makeModule({ dataDir: data }).call('GET', '/sessions')).body.userStateError).toContain('"pinned" must be an array of session ids');
  });
});
