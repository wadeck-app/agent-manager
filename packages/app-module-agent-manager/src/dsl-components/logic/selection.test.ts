import { describe, expect, it } from 'vitest';
import { groupCheck, pruneSelection, rangeBetween, selectedText } from './selection.js';

const VISIBLE = ['a', 'b', 'c', 'd', 'e'];

describe('rangeBetween', () => {
  it('is the ids between the anchor and the target, inclusive, whichever way round', () => {
    expect(rangeBetween(VISIBLE, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeBetween(VISIBLE, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(rangeBetween(VISIBLE, 'c', 'c')).toEqual(['c']);
  });
  it('without an anchor, or an anchor that is no longer on screen, it is the target alone (never a guessed range)', () => {
    expect(rangeBetween(VISIBLE, undefined, 'c')).toEqual(['c']);
    expect(rangeBetween(VISIBLE, 'gone', 'c')).toEqual(['c']);
  });
  it('a target that is not on screen selects nothing', () => {
    expect(rangeBetween(VISIBLE, 'a', 'zz')).toEqual([]);
  });
});

describe('pruneSelection', () => {
  it('drops the ids of sessions that are gone and keeps the same set when none is', () => {
    const selected = new Set(['a', 'b', 'x']);
    expect([...pruneSelection(selected, new Set(['a', 'b', 'c']))]).toEqual(['a', 'b']);
    expect(pruneSelection(selected, new Set(['a', 'b', 'x']))).toBe(selected);
  });
});

describe('groupCheck', () => {
  it('none, some or all of the members; an empty group is none', () => {
    const selected = new Set(['a', 'b']);
    expect(groupCheck(['a', 'b'], selected)).toBe('all');
    expect(groupCheck(['a', 'c'], selected)).toBe('some');
    expect(groupCheck(['c', 'd'], selected)).toBe('none');
    expect(groupCheck([], selected)).toBe('none');
  });
});

describe('selectedText', () => {
  it('says the count', () => {
    expect(selectedText(3)).toBe('3 selected');
  });
});
