import { describe, expect, it } from 'vitest';
import { UNKNOWN_DURATION, compactDuration } from './compactDuration.js';

const s = (n: number): number => n * 1000;
const m = (n: number): number => s(n * 60);
const h = (n: number): number => m(n * 60);

describe('compactDuration', () => {
  it.each([
    [0, '<1m'],
    [s(59), '<1m'],
    [s(59) + 999, '<1m'],
    [s(60), '1m'],
    [m(5), '5m'],
    [m(59), '59m'],
    [m(59) + s(59), '59m'],
    [m(60), '1h'],
    [h(4) + m(59), '4h'],
    [h(23) + m(59), '23h'],
    [h(24), '1d'],
    [h(24) * 2 + h(5), '2d'],
  ])('%i ms is %s', (age, expected) => {
    expect(compactDuration(age)).toBe(expected);
  });

  it('a missing timestamp is "?", never "<1m"', () => {
    expect(compactDuration(undefined)).toBe(UNKNOWN_DURATION);
    expect(UNKNOWN_DURATION).toBe('?');
    expect(compactDuration(Number.NaN)).toBe('?');
    expect(compactDuration(Number.POSITIVE_INFINITY)).toBe('?');
  });

  it('a negative age (clock skew) counts as zero', () => {
    expect(compactDuration(-s(30))).toBe('<1m');
  });
});
