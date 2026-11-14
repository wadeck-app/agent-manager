import { describe, expect, it } from 'vitest';
import { DurationError, parseDuration } from './duration.js';

describe('parseDuration', () => {
  it.each([
    ['0', 0],
    ['30s', 30_000],
    ['15m', 900_000],
    ['5h', 18_000_000],
    ['1d', 86_400_000],
    ['1h5m30s', 3_930_000],
    ['1d2h3m4s', 93_784_000],
    ['0s', 0],
    ['90m', 5_400_000],
    ['  15m  ', 900_000],
  ])('%s is %i ms', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it('accepts the units in any order', () => {
    expect(parseDuration('30s1h')).toBe(3_630_000);
  });

  it('treats 0 as no timeout', () => {
    expect(parseDuration('0')).toBe(0);
  });

  it.each([
    ['', /it is empty/],
    ['   ', /it is empty/],
    ['-5s', /cannot be negative/],
    ['-0', /cannot be negative/],
    ['30', /has no unit, add one \(e\.g\. 30s/],
    ['1h30', /the number 30 at the end has no unit/],
    ['5w', /unknown unit 'w' after 5/],
    ['5ms', /expected a number at 's'/],
    ['1h1h', /the unit 'h' is given twice/],
    ['1.5h', /unknown unit '\.' after 1/],
    ['1 h', /unknown unit ' ' after 1/],
    ['h', /expected a number at 'h'/],
    ['5hh', /expected a number at 'h'/],
    ['+5s', /expected a number at '\+5s'/],
    ['abc', /expected a number at 'abc'/],
  ])('rejects %j with an actionable message', (input, reason) => {
    expect(() => parseDuration(input)).toThrow(DurationError);
    expect(() => parseDuration(input)).toThrow(reason);
    // every message repeats the input and tells what is accepted
    expect(() => parseDuration(input)).toThrow(/accepted: '0' \(no timeout\)/);
    expect(() => parseDuration(input)).toThrow(`invalid duration '${input}'`);
  });

  it('rejects a value too large to be exact', () => {
    expect(() => parseDuration('99999999999999999999d')).toThrow(/too large/);
  });
});
