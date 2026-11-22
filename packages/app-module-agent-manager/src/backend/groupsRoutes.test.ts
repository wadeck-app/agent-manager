import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GROUP_NAME_MAX, MAX_GROUPS, checkGroupName, placeMember } from '../commons/groups.js';
import { makeModule, type Call } from './testKit.js';

const ID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('custom groups: routes', () => {
  let registry: string;
  let data: string;
  beforeEach(() => {
    registry = mkdtempSync(join(tmpdir(), 'agent-manager-groups-registry-'));
    data = mkdtempSync(join(tmpdir(), 'agent-manager-groups-data-'));
    process.env['AGENT_MANAGER_SESSIONS_DIR'] = registry;
  });
  afterEach(() => {
    delete process.env['AGENT_MANAGER_SESSIONS_DIR'];
    rmSync(registry, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    rmSync(data, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });

  const stateFile = (): { version: number; groups: { id: string; name: string; color: string | null; collapsed: boolean; order: number; members: string[] }[] } => JSON.parse(readFileSync(join(data, 'agents-user-state.json'), 'utf8'));
  const create = async (call: ReturnType<typeof makeModule>['call'], name: string, color?: string): Promise<string> => {
    const answer = await call('POST', '/groups', { body: color === undefined ? { name } : { name, color } });
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    return answer.body.group.id as string;
  };
  const move = (call: ReturnType<typeof makeModule>['call'], session: number, body: unknown): Promise<Call> => call('POST', `/sessions/${ID(session)}/group`, { body });
  const members = (groupId: string): string[] => stateFile().groups.find((group) => group.id === groupId)?.members ?? [];

  it('creates groups at the end, with the version of the format and no color by default', async () => {
    const { call } = makeModule({ dataDir: data });
    const first = await call('POST', '/groups', { body: { name: '  Backend  ' } });
    expect(first.body).toMatchObject({ ok: true, group: { name: 'Backend', color: null, collapsed: false, order: 0 } });
    expect(first.body.group.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const second = await call('POST', '/groups', { body: { name: 'Frontend', color: 'teal' } });
    expect(second.status).toBe(400);
    const third = await call('POST', '/groups', { body: { name: 'Frontend', color: 'cyan' } });
    expect(third.body.group).toMatchObject({ name: 'Frontend', color: 'cyan', order: 1 });
    const file = stateFile();
    expect(file.version).toBe(1);
    expect(file.groups.map((group) => group.name)).toEqual(['Backend', 'Frontend']);
  });

  it.each([
    [{}, /name must be text/],
    [{ name: '' }, /empty/],
    [{ name: '   ' }, /empty/],
    [{ name: 'x'.repeat(GROUP_NAME_MAX + 1) }, /61 characters.*limit is 60/],
    [{ name: 'a\nb' }, /control character/],
    [{ name: 'ok', color: 'chartreuse' }, /one of blue, green/],
    [{ name: 'ok', extra: 1 }, /Unknown field/],
  ])('refuses the create body %j with an actionable 400', async (body, message) => {
    const { call } = makeModule({ dataDir: data });
    const answer = await call('POST', '/groups', { body });
    expect(answer.status).toBe(400);
    expect(answer.body.message).toMatch(message);
    expect(answer.body.hint).toBeTruthy();
  });

  it('accepts a name of exactly 60 characters', async () => {
    const { call } = makeModule({ dataDir: data });
    expect((await call('POST', '/groups', { body: { name: 'x'.repeat(GROUP_NAME_MAX) } })).status).toBe(200);
  });

  it('refuses more than MAX_GROUPS groups with a 409 that says what to do', async () => {
    const { call } = makeModule({ dataDir: data });
    for (let i = 0; i < MAX_GROUPS; i += 1) {
      await create(call, `g${i}`);
    }
    const answer = await call('POST', '/groups', { body: { name: 'one too many' } });
    expect(answer.status).toBe(409);
    expect(answer.body.hint).toMatch(/Delete a group/);
  });

  it('renames, recolors and collapses a group; no field, an unknown group and a bad value are refused', async () => {
    const { call } = makeModule({ dataDir: data });
    const id = await create(call, 'Backend');
    expect((await call('POST', `/groups/${id}`, { body: { name: 'API' } })).body.group).toMatchObject({ name: 'API', collapsed: false });
    expect((await call('POST', `/groups/${id}`, { body: { color: 'red', collapsed: true } })).body.group).toMatchObject({ color: 'red', collapsed: true });
    expect((await call('POST', `/groups/${id}`, { body: { color: null } })).body.group.color).toBeNull();
    expect(stateFile().groups[0]).toMatchObject({ name: 'API', color: null, collapsed: true });
    expect((await call('POST', `/groups/${id}`, { body: {} })).status).toBe(400);
    expect((await call('POST', `/groups/${id}`, { body: { collapsed: 'yes' } })).status).toBe(400);
    expect((await call('POST', `/groups/${id}`, { body: { name: '' } })).status).toBe(400);
    const unknown = await call('POST', `/groups/${ID(99)}`, { body: { name: 'x' } });
    expect(unknown.status).toBe(404);
    expect(unknown.body.hint).toMatch(/deleted/);
    expect((await call('POST', '/groups/not-a-uuid', { body: { name: 'x' } })).status).toBe(400);
  });

  it('moves a session into a group at the end, before a member, between groups, and out', async () => {
    const { call } = makeModule({ dataDir: data });
    const a = await create(call, 'A');
    const b = await create(call, 'B');
    await move(call, 1, { groupId: a });
    await move(call, 2, { groupId: a });
    await move(call, 3, { groupId: a, beforeSessionId: ID(1) });
    expect(members(a)).toEqual([ID(3), ID(1), ID(2)]);
    // reorder inside the group
    await move(call, 2, { groupId: a, beforeSessionId: ID(3) });
    expect(members(a)).toEqual([ID(2), ID(3), ID(1)]);
    // into another group: a session is in at most one group
    expect((await move(call, 3, { groupId: b })).status).toBe(200);
    expect(members(a)).toEqual([ID(2), ID(1)]);
    expect(members(b)).toEqual([ID(3)]);
    // out
    expect((await move(call, 1, { groupId: null })).body).toMatchObject({ ok: true, groupId: null });
    expect(members(a)).toEqual([ID(2)]);
  });

  it('writes nothing when the move changes nothing', async () => {
    const { call } = makeModule({ dataDir: data });
    const a = await create(call, 'A');
    await move(call, 1, { groupId: a });
    const before = readFileSync(join(data, 'agents-user-state.json'), 'utf8');
    await move(call, 1, { groupId: a });
    await move(call, 2, { groupId: null });
    expect(readFileSync(join(data, 'agents-user-state.json'), 'utf8')).toBe(before);
  });

  it.each([
    ['no groupId', {}, 400, /groupId' is missing/],
    ['an id that is not a group id', { groupId: 'abc' }, 400, /not a group id/],
    ['an unknown group', { groupId: ID(77) }, 404, /No group/],
    ['a position without a group', { groupId: null, beforeSessionId: ID(2) }, 400, /needs a 'groupId'/],
    ['itself as the position', { groupId: 'GROUP', beforeSessionId: ID(1) }, 400, /the session itself/],
    ['a position that is not a member', { groupId: 'GROUP', beforeSessionId: ID(5) }, 409, /not in the group/],
    ['an unknown field', { groupId: null, wat: 1 }, 400, /Unknown field/],
  ])('refuses a move with %s', async (_name, body, status, message) => {
    const { call } = makeModule({ dataDir: data });
    const id = await create(call, 'A');
    const resolved = JSON.parse(JSON.stringify(body).replace('GROUP', id));
    const answer = await move(call, 1, resolved);
    expect(answer.status).toBe(status);
    expect(answer.body.message).toMatch(message);
    expect(answer.body.hint).toBeTruthy();
  });

  it('deletes a group: its members become ungrouped, the other groups are renumbered', async () => {
    const { call } = makeModule({ dataDir: data });
    const a = await create(call, 'A');
    const b = await create(call, 'B');
    const c = await create(call, 'C');
    await move(call, 1, { groupId: b });
    const answer = await call('POST', `/groups/${b}/delete`);
    expect(answer.body).toMatchObject({ ok: true, ungrouped: 1 });
    expect(stateFile().groups.map((group) => [group.id, group.order])).toEqual([
      [a, 0],
      [c, 1],
    ]);
    expect((await call('POST', `/groups/${b}/delete`)).status).toBe(404);
  });

  it('reorders the groups; the ids must be exactly the current groups', async () => {
    const { call } = makeModule({ dataDir: data });
    const a = await create(call, 'A');
    const b = await create(call, 'B');
    const c = await create(call, 'C');
    expect((await call('POST', '/groups/order', { body: { ids: [c, a, b] } })).status).toBe(200);
    expect(stateFile().groups.map((group) => [group.name, group.order])).toEqual([
      ['C', 0],
      ['A', 1],
      ['B', 2],
    ]);
    for (const ids of [[a, b], [a, b, c, ID(5)], [a, a, b], 'x']) {
      const answer = await call('POST', '/groups/order', { body: { ids } });
      expect(answer.status, JSON.stringify(ids)).toBe(ids === 'x' ? 400 : 409);
      expect(answer.body.hint).toBeTruthy();
    }
  });

  it('GET /sessions carries the groups and, per row, the group and the position', async () => {
    writeFileSync(join(registry, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: ID(process.pid), cwd: '/work/shop', version: '2.1.323', status: 'idle', statusUpdatedAt: Date.now() - 90 * 60_000 }));
    const { call } = makeModule({ dataDir: data });
    const g = await create(call, 'Mine', 'green');
    await move(call, process.pid, { groupId: g });
    const page = (await call('GET', '/sessions')).body;
    expect(page.customGroups).toEqual([{ id: g, name: 'Mine', color: 'green', collapsed: false, order: 0, sort: 'manual', bodyColor: null }]);
    expect(page.sessions[0]).toMatchObject({ customGroupId: g, customGroupOrder: 0 });
  });

  it('a row that is in no group says so (null and -1)', async () => {
    writeFileSync(join(registry, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: ID(process.pid), cwd: '/work/shop', version: '2.1.323', status: 'idle' }));
    const { call } = makeModule({ dataDir: data });
    const page = (await call('GET', '/sessions')).body;
    expect(page.customGroups).toEqual([]);
    expect(page.sessions[0]).toMatchObject({ customGroupId: null, customGroupOrder: -1 });
  });

  describe('members of a group whose session left the registry (14 days of absence, never one missing read)', () => {
    const DAY = 24 * 60 * 60 * 1000;
    const T0 = Date.parse('2026-12-01T10:00:00Z');
    afterEach(() => vi.useRealTimers());
    // Each poll is a fresh module instance (the hourly pass is per instance), at the given time.
    const pollAt = async (at: number): Promise<void> => {
      vi.setSystemTime(at);
      await makeModule({ dataDir: data }).call('GET', '/sessions');
    };
    const seenAt = (groupId: string, session: number): number | undefined => (stateFile().groups.find((g) => g.id === groupId) as unknown as { seenAt: Record<string, number> }).seenAt[ID(session)];

    it('absent 1 hour: kept; absent 15 days: pruned; the present one is refreshed each pass', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      writeFileSync(join(registry, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: ID(process.pid), cwd: '/work/shop', version: '2.1.323', status: 'idle' }));
      const { call } = makeModule({ dataDir: data });
      const g = await create(call, 'Mine');
      await move(call, process.pid, { groupId: g });
      await move(call, 999_001, { groupId: g });
      expect(members(g)).toEqual([ID(process.pid), ID(999_001)]);
      // the first poll: the absent member is NOT dropped, its clock is the time it was placed
      await pollAt(T0);
      expect(members(g)).toEqual([ID(process.pid), ID(999_001)]);
      await pollAt(T0 + 60 * 60 * 1000);
      expect(members(g)).toEqual([ID(process.pid), ID(999_001)]);
      expect(seenAt(g, 999_001)).toBe(T0);
      expect(seenAt(g, process.pid)).toBe(T0 + 60 * 60 * 1000);
      // 13 days: still kept
      await pollAt(T0 + 13 * DAY);
      expect(members(g)).toEqual([ID(process.pid), ID(999_001)]);
      // 15 days: pruned, the present member stays with a fresh clock
      await pollAt(T0 + 15 * DAY);
      expect(members(g)).toEqual([ID(process.pid)]);
      expect(seenAt(g, process.pid)).toBe(T0 + 15 * DAY);
    });

    it('a member that reappears has its clock refreshed: it is kept 10 days after, even though 20 days passed since the first absence', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      const { call } = makeModule({ dataDir: data });
      const g = await create(call, 'Mine');
      await move(call, 999_001, { groupId: g });
      await pollAt(T0 + 2 * DAY);
      // the session is back in the registry
      writeFileSync(join(registry, '999001.json'), JSON.stringify({ pid: process.pid, sessionId: ID(999_001), cwd: '/work/shop', version: '2.1.323', status: 'idle' }));
      await pollAt(T0 + 10 * DAY);
      expect(seenAt(g, 999_001)).toBe(T0 + 10 * DAY);
      rmSync(join(registry, '999001.json'));
      await pollAt(T0 + 20 * DAY);
      expect(members(g)).toEqual([ID(999_001)]);
      await pollAt(T0 + 25 * DAY);
      expect(members(g)).toEqual([]);
    });

    it('a file written before the clock existed (members without seenAt) gets its clock started by the first pass, and loses nobody', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(T0);
      writeFileSync(join(data, 'agents-user-state.json'), JSON.stringify({ pinned: [], seen: {}, groups: [{ id: ID(1), name: 'old', collapsed: false, order: 0, members: [ID(999_001)] }] }));
      await pollAt(T0);
      expect(members(ID(1))).toEqual([ID(999_001)]);
      expect(seenAt(ID(1), 999_001)).toBe(T0);
    });

    it('moving a member out removes its clock', async () => {
      const { call } = makeModule({ dataDir: data });
      const g = await create(call, 'Mine');
      await move(call, 999_001, { groupId: g });
      expect(seenAt(g, 999_001)).toEqual(expect.any(Number));
      await move(call, 999_001, { groupId: null });
      expect(seenAt(g, 999_001)).toBeUndefined();
    });
  });

  it('a corrupt or foreign state file is a loud 500 with the file and a hint, and is never overwritten', async () => {
    const { call } = makeModule({ dataDir: data });
    const file = join(data, 'agents-user-state.json');
    const bad = [
      JSON.stringify({ pinned: [], seen: {}, groups: [{ id: ID(1), name: '', collapsed: false, order: 0, members: [] }] }),
      JSON.stringify({ pinned: [], seen: {}, groups: [{ id: ID(1), name: 'a', collapsed: false, order: 0, members: [ID(5)] }, { id: ID(2), name: 'b', collapsed: false, order: 1, members: [ID(5)] }] }),
      JSON.stringify({ pinned: [], seen: {}, groups: [{ id: ID(1), name: 'a', color: 'plaid', collapsed: false, order: 0, members: [] }] }),
      JSON.stringify({ version: 2, pinned: [], seen: {}, groups: [] }),
      '{not json',
    ];
    for (const text of bad) {
      writeFileSync(file, text);
      const answer = await call('POST', '/groups', { body: { name: 'x' } });
      expect(answer.status, text).toBe(500);
      expect(answer.body.message).toContain('agents-user-state.json');
      expect(answer.body.hint).toMatch(/Nothing was overwritten/);
      expect(readFileSync(file, 'utf8')).toBe(text);
    }
  });

  it('a file written before the groups existed (no version, no groups) is read as it is and gets the groups added', async () => {
    writeFileSync(join(data, 'agents-user-state.json'), JSON.stringify({ pinned: [ID(1)], seen: { [ID(2)]: 5 } }));
    const { call } = makeModule({ dataDir: data });
    await create(call, 'A');
    const file = JSON.parse(readFileSync(join(data, 'agents-user-state.json'), 'utf8'));
    expect(file).toMatchObject({ version: 1, pinned: [ID(1)], seen: { [ID(2)]: 5 } });
    expect(file.groups).toHaveLength(1);
  });

  it('the CSRF guard answers 403 on the group routes without the web UI headers, and they are not PIN-sensitive', async () => {
    const m = makeModule({ dataDir: data });
    for (const [path, body] of [
      ['/groups', { name: 'x' }],
      ['/groups/order', { ids: [] }],
      [`/groups/${ID(1)}`, { name: 'x' }],
      [`/groups/${ID(1)}/delete`, undefined],
      [`/sessions/${ID(1)}/group`, { groupId: null }],
    ] as const) {
      const answer = await m.call('POST', path, { body, headers: { 'sec-fetch-site': undefined } });
      expect(answer.status, path).toBe(403);
      expect(answer.body).toMatchObject({ ok: false, error: { code: 'csrf-required' } });
    }
    expect(m.registered.filter((route) => route.key.includes('/groups') || route.key.endsWith('/group')).every((route) => route.effect === undefined)).toBe(true);
  });
});

describe('custom groups: shared rules', () => {
  it('checkGroupName trims and refuses empty, long and control characters', () => {
    expect(checkGroupName(' a ')).toEqual({ ok: true, name: 'a' });
    expect(checkGroupName(5)).toMatchObject({ ok: false });
    expect(checkGroupName('a\u0000b')).toMatchObject({ ok: false });
    expect(checkGroupName('a\u007fb')).toMatchObject({ ok: false });
    expect(checkGroupName(`caf${String.fromCharCode(233)} is fine`)).toMatchObject({ ok: true });
  });

  it('placeMember puts the id before the named member or at the end, and refuses an unknown position', () => {
    expect(placeMember(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(placeMember(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a']);
    expect(placeMember(['a', 'b'], 'x', undefined)).toEqual(['a', 'b', 'x']);
    expect(placeMember(['a', 'b'], 'x', 'zzz')).toBeUndefined();
    expect(placeMember(['a', 'b'], 'a', 'a')).toBeUndefined();
  });
});
