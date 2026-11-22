import { describe, expect, it } from 'vitest';
import { harnessChip } from './harness.js';

describe('harnessChip', () => {
  it.each([
    ['Claude Code 2.1.325', 'CCv2.1.325'],
    ['Claude Code', 'CC'],
    ['OpenCode 0.15.3', 'OCv0.15.3'],
    ['Codex 0.9.0', 'Cxv0.9.0'],
    ['codex', 'Cx'],
  ])('%s is shown as %s, the full name stays for the tooltip', (full, short) => {
    expect(harnessChip(full)).toEqual({ short, full });
  });

  it('a program it does not know is shown as it is, never guessed', () => {
    expect(harnessChip('Mystery Agent 1.2')).toEqual({ short: 'Mystery Agent 1.2', full: 'Mystery Agent 1.2' });
  });
});
