import { describe, expect, it } from 'vitest';
import { NdjsonFramer } from './ndjsonFramer.js';

const lines = (frames: ReturnType<NdjsonFramer['push']>): string[] => frames.map((frame) => (frame.kind === 'line' ? frame.text : `<oversize ${frame.chars}>`));

describe('NdjsonFramer', () => {
  it('returns several lines of one chunk', () => {
    expect(lines(new NdjsonFramer().push('{"a":1}\n{"b":2}\n'))).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('joins a line split across chunks and keeps the partial one until its newline', () => {
    const framer = new NdjsonFramer();
    expect(lines(framer.push('{"a":'))).toEqual([]);
    expect(lines(framer.push('1}\n{"b"'))).toEqual(['{"a":1}']);
    expect(lines(framer.push(':2}\n'))).toEqual(['{"b":2}']);
  });

  it('does not break a multi-byte character split between two chunks', () => {
    const framer = new NdjsonFramer();
    const bytes = Buffer.from('{"t":"caf\u00e9 \u2713"}\n', 'utf8');
    // Cut inside the two-byte character and inside the three-byte one.
    const first = bytes.indexOf(0xc3) + 1;
    const second = bytes.indexOf(0xe2) + 1;
    expect(lines(framer.push(bytes.subarray(0, first)))).toEqual([]);
    expect(lines(framer.push(bytes.subarray(first, second)))).toEqual([]);
    expect(lines(framer.push(bytes.subarray(second)))).toEqual(['{"t":"caf\u00e9 \u2713"}']);
  });

  it('skips empty lines and removes a trailing carriage return', () => {
    expect(lines(new NdjsonFramer().push('\n\r\n{"a":1}\r\n   \n'))).toEqual(['{"a":1}']);
  });

  it('gives the last line that has no newline at the end of the stream', () => {
    const framer = new NdjsonFramer();
    expect(lines(framer.push('{"a":1}\n{"b":2}'))).toEqual(['{"a":1}']);
    expect(lines(framer.end())).toEqual(['{"b":2}']);
    expect(lines(framer.end())).toEqual([]);
  });

  it('drops a line above the limit as a whole, then continues with the next line', () => {
    const framer = new NdjsonFramer(10);
    expect(lines(framer.push('0123456789ab'))).toEqual([]);
    expect(lines(framer.push('cdef\n{"ok":1}\n'))).toEqual(['<oversize 16>', '{"ok":1}']);
  });

  it('accepts a line of exactly the limit and reports one that is a character longer', () => {
    const framer = new NdjsonFramer(5);
    expect(lines(framer.push('12345\n123456\n'))).toEqual(['12345', '<oversize 6>']);
  });

  it('reports an oversize last line at the end of the stream', () => {
    const framer = new NdjsonFramer(4);
    framer.push('abcdefgh');
    expect(lines(framer.end())).toEqual(['<oversize 8>']);
  });

  it('handles a long line fed in many small chunks without rescanning (linear)', () => {
    const framer = new NdjsonFramer(10_000_000);
    let frames: string[] = [];
    for (let index = 0; index < 20_000; index++) {
      frames = frames.concat(lines(framer.push('x'.repeat(100))));
    }
    expect(frames).toEqual([]);
    expect(lines(framer.push('\n'))).toHaveLength(1);
  });

  it('refuses a limit that is not a positive integer', () => {
    expect(() => new NdjsonFramer(0)).toThrow(RangeError);
    expect(() => new NdjsonFramer(1.5)).toThrow(RangeError);
  });
});
