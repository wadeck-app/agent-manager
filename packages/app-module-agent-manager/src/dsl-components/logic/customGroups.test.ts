import { describe, expect, it } from 'vitest';
import type { CustomGroupDto } from '../shared.js';
import { applyLayout, dropBefore, groupOfRow, inLowerHalf, layoutOf, layoutsEqual, moveInLayout, partitionByGroup, reorderedGroupIds, stepGroupIds } from './customGroups.js';
import { row } from './fixtures.js';
import { DEFAULT_VIEW_OPTIONS } from './viewOptions.js';
import { orderedSessionIds } from './order.js';

const group = (id: string, order: number, overrides: Partial<CustomGroupDto> = {}): CustomGroupDto => ({ id, name: id, color: null, collapsed: false, order, ...overrides });
const A = group('a', 0);
const B = group('b', 1);
const C = group('c', 2);

describe('layoutOf and applyLayout', () => {
  const x = row({ customGroupId: 'a', customGroupOrder: 1 });
  const y = row({ customGroupId: 'a', customGroupOrder: 0 });
  const z = row({ customGroupId: 'b', customGroupOrder: 0 });
  const free = row();
  const lost = row({ customGroupId: 'gone', customGroupOrder: 0 });

  it('orders the groups by `order` and the members by their position; a row of an unknown group is ungrouped', () => {
    const layout = layoutOf([B, A], [x, y, z, free, lost]);
    expect(layout.groups.map((g) => g.id)).toEqual(['a', 'b']);
    expect(layout.members['a']).toEqual([y.sessionId, x.sessionId]);
    expect(layout.members['b']).toEqual([z.sessionId]);
    expect(Object.values(layout.members).flat()).not.toContain(lost.sessionId);
  });

  it('applyLayout puts the group and the position on the rows and leaves untouched rows as they are', () => {
    const layout = layoutOf([A, B], [x, y, z, free]);
    const moved = moveInLayout(layout, free.sessionId, 'b', null);
    const rows = applyLayout([x, y, z, free], moved!);
    expect(rows[3]).toMatchObject({ customGroupId: 'b', customGroupOrder: 1 });
    expect(rows[0]).toBe(x);
    expect(rows[2]).toBe(z);
  });

  it('layoutsEqual compares groups (name, color, collapsed) and the order of the members', () => {
    const base = layoutOf([A, B], [x, y]);
    expect(layoutsEqual(base, layoutOf([A, B], [x, y]))).toBe(true);
    expect(layoutsEqual(base, layoutOf([{ ...A, name: 'other' }, B], [x, y]))).toBe(false);
    expect(layoutsEqual(base, layoutOf([A, B], [{ ...x, customGroupOrder: 0 }, { ...y, customGroupOrder: 1 }]))).toBe(false);
    expect(layoutsEqual(base, layoutOf([A], [x, y]))).toBe(false);
  });
});

describe('moveInLayout', () => {
  const m1 = row({ customGroupId: 'a', customGroupOrder: 0 });
  const m2 = row({ customGroupId: 'a', customGroupOrder: 1 });
  const m3 = row({ customGroupId: 'b', customGroupOrder: 0 });
  const layout = layoutOf([A, B], [m1, m2, m3]);

  it('moves into another group (leaving the first), inside a group, and out', () => {
    expect(moveInLayout(layout, m1.sessionId, 'b', m3.sessionId)?.members).toEqual({ a: [m2.sessionId], b: [m1.sessionId, m3.sessionId] });
    expect(moveInLayout(layout, m2.sessionId, 'a', m1.sessionId)?.members['a']).toEqual([m2.sessionId, m1.sessionId]);
    expect(moveInLayout(layout, m2.sessionId, null, null)?.members).toEqual({ a: [m1.sessionId], b: [m3.sessionId] });
  });

  it('refuses an unknown group and a position that is not a member (no guess)', () => {
    expect(moveInLayout(layout, m1.sessionId, 'nope', null)).toBeUndefined();
    expect(moveInLayout(layout, m1.sessionId, 'b', m2.sessionId)).toBeUndefined();
  });

  it('is case-insensitive on the session id', () => {
    expect(moveInLayout(layout, m1.sessionId.toUpperCase(), 'b', null)?.members['b']).toEqual([m3.sessionId, m1.sessionId]);
  });
});

describe('reordering the groups', () => {
  const groups = [A, B, C];
  it('reorderedGroupIds puts the dragged group before or after the target; the same place is no change', () => {
    expect(reorderedGroupIds(groups, 'c', 'a', false)).toEqual(['c', 'a', 'b']);
    expect(reorderedGroupIds(groups, 'a', 'b', true)).toEqual(['b', 'a', 'c']);
    expect(reorderedGroupIds(groups, 'a', 'b', false)).toBeUndefined();
    expect(reorderedGroupIds(groups, 'b', 'a', true)).toBeUndefined();
    expect(reorderedGroupIds(groups, 'a', 'a', true)).toBeUndefined();
    expect(reorderedGroupIds(groups, 'a', 'zzz', true)).toBeUndefined();
  });
  it('stepGroupIds swaps with the neighbour and stops at the ends', () => {
    expect(stepGroupIds(groups, 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(stepGroupIds(groups, 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(stepGroupIds(groups, 'a', -1)).toBeUndefined();
    expect(stepGroupIds(groups, 'c', 1)).toBeUndefined();
    expect(stepGroupIds(groups, 'zzz', 1)).toBeUndefined();
  });
});

describe('drop positions', () => {
  it('dropBefore: the target itself in its upper half, the member after it in the lower half (null at the end)', () => {
    expect(dropBefore(['x', 'y', 'z'], 'y', false)).toBe('y');
    expect(dropBefore(['x', 'y', 'z'], 'y', true)).toBe('z');
    expect(dropBefore(['x', 'y', 'z'], 'z', true)).toBeNull();
    expect(dropBefore(['x'], 'unknown', true)).toBeNull();
  });
  it('inLowerHalf', () => {
    const box = { top: 100, height: 40 };
    expect(inLowerHalf(119, box)).toBe(false);
    expect(inLowerHalf(120, box)).toBe(true);
  });
});

describe('partitionByGroup', () => {
  const a1 = row({ customGroupId: 'a', customGroupOrder: 1, state: 'idle' });
  const a0 = row({ customGroupId: 'a', customGroupOrder: 0, state: 'needs-you' });
  const free = row();

  it('lists every group in order (an empty one too), members by position, and the worst state of each', () => {
    const { sections, ungrouped } = partitionByGroup([a1, a0, free], [B, A], false);
    expect(sections.map((s) => s.group.id)).toEqual(['a', 'b']);
    expect(sections[0]?.sessions).toEqual([a0, a1]);
    expect(sections[0]?.rollup).toBe('needs-you');
    expect(sections[1]?.sessions).toEqual([]);
    expect(sections[1]?.rollup).toBeUndefined();
    expect(ungrouped).toEqual([free]);
  });

  it('leaves the empty groups out when asked (a search)', () => {
    expect(partitionByGroup([a1, free], [A, B], true).sections.map((s) => s.group.id)).toEqual(['a']);
  });

  it('groupOfRow finds the group of a row', () => {
    expect(groupOfRow(a1, [A, B])).toBe(A);
    expect(groupOfRow(free, [A, B])).toBeUndefined();
  });
});

describe('orderedSessionIds in the Tree with custom groups', () => {
  it('walks the groups first (in their order), then the automatic tree', () => {
    const inB = row({ customGroupId: 'b', customGroupOrder: 0, folder: 'zeta' });
    const inA = row({ customGroupId: 'a', customGroupOrder: 0, folder: 'zeta' });
    const free = row({ folder: 'alpha' });
    const ids = orderedSessionIds('tree', [free, inB, inA], DEFAULT_VIEW_OPTIONS, null, ['a', 'b']);
    expect(ids).toEqual([inA.sessionId, inB.sessionId, free.sessionId].map((id) => id.toLowerCase()));
    // with the groups in the other order
    expect(orderedSessionIds('tree', [free, inB, inA], DEFAULT_VIEW_OPTIONS, null, ['b', 'a'])[0]).toBe(inB.sessionId.toLowerCase());
  });
  it('without groups it is the automatic tree as before', () => {
    const one = row({ folder: 'a' });
    expect(orderedSessionIds('tree', [one], DEFAULT_VIEW_OPTIONS, null)).toEqual([one.sessionId.toLowerCase()]);
  });
});
