import { describe, expect, it } from 'vitest';
import { splitCommand } from './dispatch.js';

const names = ['start', 'status', 'cli update', 'cli version'];

describe('splitCommand', () => {
  it('finds a one-word command and leaves the rest in order', () => {
    expect(splitCommand(['start', '--json', 'x'], names)).toEqual({ name: 'start', words: ['start'], rest: ['--json', 'x'] });
  });

  it('finds a two-word command', () => {
    expect(splitCommand(['cli', 'update', '--check'], names)).toEqual({
      name: 'cli update',
      words: ['cli', 'update'],
      rest: ['--check'],
    });
  });

  it('finds the command wherever the options are', () => {
    expect(splitCommand(['--json', 'status'], names).name).toBe('status');
  });

  it('reports no command when only options are given', () => {
    expect(splitCommand(['--version'], names)).toEqual({ name: undefined, words: [], rest: ['--version'] });
    expect(splitCommand([], names)).toEqual({ name: undefined, words: [], rest: [] });
  });

  it('reports an unknown word without a name', () => {
    expect(splitCommand(['stat', 'x'], names)).toEqual({ name: undefined, words: ['stat'], rest: ['x'] });
  });

  it('reports a group without a valid subcommand', () => {
    expect(splitCommand(['cli'], names)).toEqual({ name: undefined, words: ['cli'], rest: [] });
    expect(splitCommand(['cli', 'nope'], names)).toEqual({ name: undefined, words: ['cli', 'nope'], rest: [] });
  });

  it('does not look for a command after --', () => {
    expect(splitCommand(['--', 'start'], names)).toEqual({ name: undefined, words: [], rest: ['--', 'start'] });
  });
});
