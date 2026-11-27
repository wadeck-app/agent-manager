// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC_DIR } from '../build/paths.js';

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'generated' ? [] : sourceFiles(full);
    }
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : [];
  });
}

/**
 * The `rows` prop of the dsl-ui Tooltip (installed 2026.11.26-381) sizes its value column by the longest unbreakable word and right aligns the values: a path or a command
 * overflows the card. Details go through TipRows (the `content` of the Tooltip) instead.
 */
describe('Tooltip with labelled details', () => {
  it('no component passes the rows prop of the dsl-ui Tooltip', () => {
    const offenders = sourceFiles(SRC_DIR).filter((file) => /<Tooltip\b(?:(?!<TipRows)[^>])*\srows=/.test(fs.readFileSync(file, 'utf8').replace(/\n/g, ' ')));
    expect(offenders.map((file) => path.relative(SRC_DIR, file))).toEqual([]);
  });
});
