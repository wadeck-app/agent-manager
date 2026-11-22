import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HERDR_GROUP_NAMES, isGroupSort } from '../commons/groups.js';
import { makeModule } from './testKit.js';

const ID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// The persistence behind the Custom mode (the Herdr-like list): the order of the agents of a group, the body color, the flag and the unread mark, and the
// one-click preset. All of it lives in agents-user-state.json as additive fields.
describe('Custom mode: group settings, marks and the Herdr preset', () => {
  let registry: string;
  let data: string;
  beforeEach(() => {
    registry = mkdtempSync(join(tmpdir(), 'agent-manager-custom-registry-'));
    data = mkdtempSync(join(tmpdir(), 'agent-manager-custom-data-'));
    process.env['AGENT_MANAGER_SESSIONS_DIR'] = registry;
  });
  afterEach(() => {
    delete process.env['AGENT_MANAGER_SESSIONS_DIR'];
    rmSync(registry, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    rmSync(data, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  const stateFile = (): Record<string, unknown> & { groups: { id: string; name: string; sort?: string; bodyColor?: string | null }[]; marks?: Record<string, { flag: boolean; unread: boolean; at: number }> } => JSON.parse(readFileSync(join(data, 'agents-user-state.json'), 'utf8'));
  const registerSession = (): void => {
    writeFileSync(join(registry, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: ID(process.pid), cwd: '/work/shop', version: '2.1.323', status: 'idle' }));
  };

  describe('group settings', () => {
    it('a new group is manual with no body color, and the page says so', async () => {
      const { call } = makeModule({ dataDir: data });
      const created = await call('POST', '/groups', { body: { name: 'Focus' } });
      expect(created.body.group).toMatchObject({ name: 'Focus', sort: 'manual', bodyColor: null });
      const page = (await call('GET', '/sessions')).body;
      expect(page.customGroups[0]).toMatchObject({ sort: 'manual', bodyColor: null });
    });

    it('changes the order of the agents and the body color, and refuses what it does not know', async () => {
      const { call } = makeModule({ dataDir: data });
      const id = (await call('POST', '/groups', { body: { name: 'Focus' } })).body.group.id as string;
      const changed = await call('POST', `/groups/${id}`, { body: { sort: 'urgency', bodyColor: 'blue' } });
      expect(changed.body.group).toMatchObject({ sort: 'urgency', bodyColor: 'blue' });
      expect(stateFile().groups[0]).toMatchObject({ sort: 'urgency', bodyColor: 'blue' });
      expect((await call('POST', `/groups/${id}`, { body: { bodyColor: null } })).body.group.bodyColor).toBeNull();
      const bad = await call('POST', `/groups/${id}`, { body: { sort: 'random' } });
      expect(bad.status).toBe(400);
      expect(bad.body.message).toMatch(/sort.*manual, urgency, name, recent/);
      expect(bad.body.hint).toBeTruthy();
      expect((await call('POST', `/groups/${id}`, { body: { bodyColor: 'chartreuse' } })).status).toBe(400);
    });

    it('a state file written before these fields existed reads as manual with no body color', async () => {
      writeFileSync(join(data, 'agents-user-state.json'), JSON.stringify({ version: 1, pinned: [], seen: {}, groups: [{ id: ID(70), name: 'Old', color: 'green', collapsed: false, order: 0, members: [] }] }));
      const { call } = makeModule({ dataDir: data });
      const page = (await call('GET', '/sessions')).body;
      expect(page.userStateError).toBe('');
      expect(page.customGroups[0]).toMatchObject({ name: 'Old', color: 'green', sort: 'manual', bodyColor: null });
    });

    it('a state file with a bad sort or a bad mark is reported, never used and never overwritten', async () => {
      const file = join(data, 'agents-user-state.json');
      for (const content of [
        { version: 1, pinned: [], seen: {}, groups: [{ id: ID(70), name: 'Old', color: null, collapsed: false, order: 0, members: [], sort: 'random' }] },
        { version: 1, pinned: [], seen: {}, groups: [], marks: { [ID(1)]: { flag: 'yes', unread: false, at: 1 } } },
        { version: 1, pinned: [], seen: {}, groups: [], marks: [] },
      ]) {
        writeFileSync(file, JSON.stringify(content));
        const before = readFileSync(file, 'utf8');
        const page = (await makeModule({ dataDir: data }).call('GET', '/sessions')).body;
        expect(page.userStateError).toContain('agents-user-state.json');
        expect(readFileSync(file, 'utf8')).toBe(before);
      }
    });

    it('isGroupSort knows the four orders', () => {
      expect(['manual', 'urgency', 'name', 'recent'].every(isGroupSort)).toBe(true);
      expect(isGroupSort('priority')).toBe(false);
    });
  });

  describe('the Herdr preset', () => {
    it('creates Focus, Regular, Secondary, Meta and Icebox in this order, once', async () => {
      const { call } = makeModule({ dataDir: data });
      const answer = await call('POST', '/groups/preset', { body: { preset: 'herdr' } });
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect(answer.body.groups.map((group: { name: string }) => group.name)).toEqual([...HERDR_GROUP_NAMES]);
      expect(HERDR_GROUP_NAMES).toEqual(['Focus', 'Regular', 'Secondary', 'Meta', 'Icebox']);
      expect(stateFile().groups.map((group) => group.name)).toEqual([...HERDR_GROUP_NAMES]);
      const again = await call('POST', '/groups/preset', { body: { preset: 'herdr' } });
      expect(again.status).toBe(409);
      expect(again.body.message).toMatch(/already has groups/);
      expect(again.body.hint).toBeTruthy();
    });

    it('is refused when a group exists (it never merges into the user groups), and for an unknown preset', async () => {
      const { call } = makeModule({ dataDir: data });
      await call('POST', '/groups', { body: { name: 'Mine' } });
      expect((await call('POST', '/groups/preset', { body: { preset: 'herdr' } })).status).toBe(409);
      expect(stateFile().groups.map((group) => group.name)).toEqual(['Mine']);
      const unknown = await call('POST', '/groups/preset', { body: { preset: 'other' } });
      expect(unknown.status).toBe(400);
      expect(unknown.body.message).toMatch(/preset/);
      expect((await call('POST', '/groups/preset', { body: {} })).status).toBe(400);
    });
  });

  describe('marks: flag and unread', () => {
    it('flags and unflags a session; GET /sessions says it per row', async () => {
      registerSession();
      const { call } = makeModule({ dataDir: data });
      const sessionId = ID(process.pid);
      expect((await call('GET', '/sessions')).body.sessions[0]).toMatchObject({ flagged: false, unread: false });
      const set = await call('POST', `/sessions/${sessionId}/marks`, { body: { flag: true } });
      expect(set.body).toMatchObject({ ok: true, sessionId, flag: true, unread: false });
      expect((await call('GET', '/sessions')).body.sessions[0]).toMatchObject({ flagged: true, unread: false });
      await call('POST', `/sessions/${sessionId}/marks`, { body: { unread: true } });
      expect((await call('GET', '/sessions')).body.sessions[0]).toMatchObject({ flagged: true, unread: true });
      await call('POST', `/sessions/${sessionId}/marks`, { body: { flag: false, unread: false } });
      expect((await call('GET', '/sessions')).body.sessions[0]).toMatchObject({ flagged: false, unread: false });
      // Both off: the entry is removed, the file does not grow.
      expect(stateFile().marks).toEqual({});
    });

    it('writes nothing when the mark is already what was asked', async () => {
      const { call } = makeModule({ dataDir: data });
      await call('POST', `/sessions/${ID(1)}/marks`, { body: { flag: true } });
      const before = readFileSync(join(data, 'agents-user-state.json'), 'utf8');
      await call('POST', `/sessions/${ID(1)}/marks`, { body: { flag: true } });
      await call('POST', `/sessions/${ID(2)}/marks`, { body: { unread: false } });
      expect(readFileSync(join(data, 'agents-user-state.json'), 'utf8')).toBe(before);
    });

    it.each([
      ['no body', undefined, /JSON object/],
      ['an empty body', {}, /no mark/],
      ['an unknown field', { flag: true, color: 'red' }, /Unknown field/],
      ['a flag that is not a boolean', { flag: 'yes' }, /'flag' must be true or false/],
      ['an unread that is not a boolean', { unread: 1 }, /'unread' must be true or false/],
    ])('refuses %s with an actionable 400', async (_name, body, message) => {
      const { call } = makeModule({ dataDir: data });
      const answer = await call('POST', `/sessions/${ID(1)}/marks`, { body });
      expect(answer.status).toBe(400);
      expect(answer.body.message).toMatch(message);
      expect(answer.body.hint).toBeTruthy();
    });

    it('refuses a session id that is not one', async () => {
      const { call } = makeModule({ dataDir: data });
      const answer = await call('POST', '/sessions/not-an-id/marks', { body: { flag: true } });
      expect(answer.status).toBe(400);
      expect(answer.body.message).toMatch(/not a session id/);
    });
  });
});

describe('marksAfterPass (the hourly prune)', () => {
  const DAY = 24 * 60 * 60 * 1000;
  it('drops the mark of an absent session after 14 days, keeps the present one and the recent one', async () => {
    const { marksAfterPass } = await import('./sessionsRoutes.js');
    const now = 100 * DAY;
    const marks = { [ID(1)]: { flag: true, unread: false, at: now - 30 * DAY }, [ID(2)]: { flag: true, unread: false, at: now - 30 * DAY }, [ID(3)]: { flag: false, unread: true, at: now - DAY } };
    expect(marksAfterPass(marks, new Set([ID(1)]), now)).toEqual({ [ID(1)]: marks[ID(1)], [ID(3)]: marks[ID(3)] });
    // Nothing to drop: the same object back (no write).
    expect(marksAfterPass({ [ID(3)]: marks[ID(3)] }, new Set(), now)).toStrictEqual({ [ID(3)]: marks[ID(3)] });
  });
});
