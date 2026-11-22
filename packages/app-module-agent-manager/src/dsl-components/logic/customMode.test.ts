import { describe, expect, it } from 'vitest';
import { customSections, effectiveRow, resolveDrop, sortMembers, UNGROUPED_ID, type DropContext } from './customMode.js';
import { row } from './fixtures.js';
import type { CustomGroupDto, SessionRowDto } from '../shared.js';

const group = (id: string, order: number, overrides: Partial<CustomGroupDto> = {}): CustomGroupDto => ({ id, name: id.toUpperCase(), color: null, collapsed: false, order, sort: 'manual', bodyColor: null, ...overrides });
const agent = (id: string, overrides: Partial<SessionRowDto> = {}): SessionRowDto => row({ sessionId: id, displayName: id, ...overrides });

describe('sortMembers', () => {
  const needs = agent('n', { state: 'needs-you', statusUpdatedAt: 100, customGroupOrder: 2 });
  const done = agent('d', { state: 'done', statusUpdatedAt: 300, customGroupOrder: 0 });
  const working = agent('w', { state: 'working', statusUpdatedAt: 200, customGroupOrder: 1 });
  const idleOld = agent('i1', { state: 'idle', statusUpdatedAt: 50, customGroupOrder: 3 });
  const idleNew = agent('i2', { state: 'idle', statusUpdatedAt: 250, customGroupOrder: 4 });
  const all = [idleOld, working, idleNew, needs, done];

  it('manual follows the saved position', () => {
    expect(sortMembers('manual', all).map((r) => r.sessionId)).toEqual(['d', 'w', 'n', 'i1', 'i2']);
  });
  it('urgency puts Needs you first, then the urgency order, newest change first inside a state', () => {
    expect(sortMembers('urgency', all).map((r) => r.sessionId)).toEqual(['n', 'd', 'w', 'i2', 'i1']);
  });
  it('recent is the latest change first, whatever the state', () => {
    expect(sortMembers('recent', all).map((r) => r.sessionId)).toEqual(['d', 'i2', 'w', 'n', 'i1']);
  });
  it('name is alphabetical, ignoring case', () => {
    const rows = [agent('b', { displayName: 'beta' }), agent('a', { displayName: 'Alpha' }), agent('c', { displayName: 'charlie' })];
    expect(sortMembers('name', rows).map((r) => r.displayName)).toEqual(['Alpha', 'beta', 'charlie']);
  });
  it('does not change the rows it was given', () => {
    const copy = [...all];
    sortMembers('urgency', all);
    expect(all).toEqual(copy);
  });
});

describe('effectiveRow (mark as unread)', () => {
  it('an unread idle agent shows as finished and unseen, like the blue dot of Herdr', () => {
    expect(effectiveRow(agent('a', { state: 'idle', unread: true })).state).toBe('done');
  });
  it('does not hide a more urgent state, and leaves a read agent alone', () => {
    expect(effectiveRow(agent('a', { state: 'needs-you', unread: true })).state).toBe('needs-you');
    const read = agent('a', { state: 'idle' });
    expect(effectiveRow(read)).toBe(read);
  });
});

describe('customSections', () => {
  const g1 = group('g1', 0, { sort: 'urgency' });
  const g2 = group('g2', 1);
  it('every group in order, an empty one too, and the Ungrouped bucket last with the rows no group claims', () => {
    const rows = [agent('x', { customGroupId: 'g2', customGroupOrder: 0 }), agent('y', { customGroupId: null }), agent('z', { customGroupId: 'gone' })];
    const sections = customSections(rows, [g2, g1]);
    expect(sections.map((s) => [s.id, s.sessions.map((r) => r.sessionId)])).toEqual([['g1', []], ['g2', ['x']], [UNGROUPED_ID, ['y', 'z']]]);
    expect(sections[0]?.rollup).toBeUndefined();
  });
  it('the rollup is the most urgent state, shown when the group is folded', () => {
    const rows = [agent('a', { customGroupId: 'g1', state: 'idle' }), agent('b', { customGroupId: 'g1', state: 'needs-you' })];
    expect(customSections(rows, [g1])[0]?.rollup).toBe('needs-you');
  });
  it('sorts the agents of each group by the setting of that group', () => {
    const rows = [agent('a', { customGroupId: 'g1', state: 'idle', statusUpdatedAt: 5 }), agent('b', { customGroupId: 'g1', state: 'needs-you', statusUpdatedAt: 1 })];
    expect(customSections(rows, [g1])[0]?.sessions.map((r) => r.sessionId)).toEqual(['b', 'a']);
  });
  it('an unread agent counts as done in the rollup', () => {
    const rows = [agent('a', { customGroupId: 'g2', state: 'idle', unread: true })];
    expect(customSections(rows, [g2])[0]?.rollup).toBe('done');
  });
});

// The held item is passed to resolveDrop explicitly: the pitfall of the Herdr mod was a drop handler that cleared the held item BEFORE validating the target,
// which silently rejected every drop.
describe('resolveDrop', () => {
  const groups = [group('g1', 0), group('g2', 1), group('g3', 2, { sort: 'urgency' })];
  const members: Record<string, string[]> = { g1: ['a', 'b', 'c'], g2: ['d', 'e'], g3: ['f', 'g'], [UNGROUPED_ID]: ['u'] };
  const ctx: DropContext = { groups, membersOf: (id) => members[id ?? UNGROUPED_ID] ?? [] };
  const agentHeld = (id: string, from: string | null) => ({ kind: 'agent' as const, id, from });

  it('an agent dropped on an agent of another group joins that group before it', () => {
    expect(resolveDrop(agentHeld('a', 'g1'), { kind: 'row', id: 'e', groupId: 'g2' }, ctx)).toEqual({ kind: 'move', sessionId: 'a', groupId: 'g2', beforeId: 'e' });
  });
  it('on the first agent of another group it goes before it, and an ungrouped agent can join too', () => {
    expect(resolveDrop(agentHeld('u', null), { kind: 'row', id: 'd', groupId: 'g2' }, ctx)).toEqual({ kind: 'move', sessionId: 'u', groupId: 'g2', beforeId: 'd' });
  });
  it('an agent dropped on a group header goes to the end of that group', () => {
    expect(resolveDrop(agentHeld('a', 'g1'), { kind: 'header', groupId: 'g2' }, ctx)).toEqual({ kind: 'move', sessionId: 'a', groupId: 'g2', beforeId: null });
  });
  it('the strip under the last agent is the bottom of the group', () => {
    expect(resolveDrop(agentHeld('a', 'g1'), { kind: 'end', groupId: 'g2' }, ctx)).toEqual({ kind: 'move', sessionId: 'a', groupId: 'g2', beforeId: null });
  });
  it('dropped on the Ungrouped bucket, an agent leaves its group; already ungrouped: nothing to do', () => {
    expect(resolveDrop(agentHeld('a', 'g1'), { kind: 'header', groupId: null }, ctx)).toEqual({ kind: 'move', sessionId: 'a', groupId: null, beforeId: null });
    expect(resolveDrop(agentHeld('u', null), { kind: 'header', groupId: null }, ctx)).toEqual({ kind: 'none' });
  });
  it('inside a manual group, the agent takes the place of the target: before it from below, after it from above', () => {
    expect(resolveDrop(agentHeld('c', 'g1'), { kind: 'row', id: 'a', groupId: 'g1' }, ctx)).toEqual({ kind: 'move', sessionId: 'c', groupId: 'g1', beforeId: 'a' });
    expect(resolveDrop(agentHeld('a', 'g1'), { kind: 'row', id: 'b', groupId: 'g1' }, ctx)).toEqual({ kind: 'move', sessionId: 'a', groupId: 'g1', beforeId: 'c' });
    expect(resolveDrop(agentHeld('a', 'g1'), { kind: 'row', id: 'c', groupId: 'g1' }, ctx)).toEqual({ kind: 'move', sessionId: 'a', groupId: 'g1', beforeId: null });
  });
  it('dropped on itself is nothing', () => {
    expect(resolveDrop(agentHeld('a', 'g1'), { kind: 'row', id: 'a', groupId: 'g1' }, ctx)).toEqual({ kind: 'none' });
  });
  it('inside a group that is not manual the drop is ignored, and says why', () => {
    const outcome = resolveDrop(agentHeld('g', 'g3'), { kind: 'row', id: 'f', groupId: 'g3' }, ctx);
    expect(outcome).toMatchObject({ kind: 'ignored' });
    expect(outcome.kind === 'ignored' && outcome.hint).toMatch(/ordered by urgency.*group settings/i);
    expect(resolveDrop(agentHeld('g', 'g3'), { kind: 'end', groupId: 'g3' }, ctx)).toMatchObject({ kind: 'ignored' });
  });
  it('an agent coming from another group still joins a group that is not manual (its place is decided by the order)', () => {
    expect(resolveDrop(agentHeld('a', 'g1'), { kind: 'row', id: 'f', groupId: 'g3' }, ctx)).toEqual({ kind: 'move', sessionId: 'a', groupId: 'g3', beforeId: null });
    expect(resolveDrop(agentHeld('a', 'g1'), { kind: 'header', groupId: 'g3' }, ctx)).toEqual({ kind: 'move', sessionId: 'a', groupId: 'g3', beforeId: null });
  });
  it('a group header dropped on another header reorders the groups, the dragged one taking the place of the target', () => {
    expect(resolveDrop({ kind: 'group', id: 'g3' }, { kind: 'header', groupId: 'g1' }, ctx)).toEqual({ kind: 'reorder', ids: ['g3', 'g1', 'g2'] });
    expect(resolveDrop({ kind: 'group', id: 'g1' }, { kind: 'header', groupId: 'g3' }, ctx)).toEqual({ kind: 'reorder', ids: ['g2', 'g3', 'g1'] });
  });
  it('a group dropped on itself, on a row, or on the Ungrouped bucket is nothing', () => {
    expect(resolveDrop({ kind: 'group', id: 'g1' }, { kind: 'header', groupId: 'g1' }, ctx)).toEqual({ kind: 'none' });
    expect(resolveDrop({ kind: 'group', id: 'g1' }, { kind: 'row', id: 'd', groupId: 'g2' }, ctx)).toEqual({ kind: 'none' });
    expect(resolveDrop({ kind: 'group', id: 'g1' }, { kind: 'header', groupId: null }, ctx)).toEqual({ kind: 'none' });
  });
  it('nothing held is nothing (never a crash)', () => {
    expect(resolveDrop(undefined, { kind: 'header', groupId: 'g1' }, ctx)).toEqual({ kind: 'none' });
  });
});
