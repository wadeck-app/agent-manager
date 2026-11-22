import { describe, expect, it } from 'vitest';
import { toolCall } from './entryFixtures.js';
import { callChips, groupChips, groupTooltip, toolLabel, type MetaChip } from './toolChips.js';
import type { ToolCall } from './grouping.js';

const text = (chip: MetaChip): string => chip.parts.map((part) => part.text).join(' ');
const texts = (call: ToolCall): string[] => callChips(call).map(text);
const done = (name: string, meta: ToolCall['meta'], patch: Partial<ToolCall> = {}): ToolCall => toolCall(`${name}-${Math.random()}`, { name, status: 'ok', durationMs: 1000, ...(meta === undefined ? {} : { meta }), ...patch });

describe('callChips', () => {
  it('Edit: the churn with colours only on the signs, and an accessible sentence', () => {
    const [chip] = callChips(done('Edit', { file: '/a.ts', added: 12, removed: 3 }));
    expect(chip!.parts).toEqual([
      { text: '+12', tone: 'add' },
      { text: '-3', tone: 'remove' },
    ]);
    expect(chip!.label).toBe('12 lines added, 3 lines removed');
  });

  it('Edit: an estimate is marked with ~ and says so in words', () => {
    const [chip] = callChips(done('Edit', { file: '/a.ts', added: 2, removed: 1, churnApprox: true }, { status: 'running' }));
    expect(text(chip!)).toBe('~ +2 -1');
    expect(chip!.label).toMatch(/estimate/i);
  });

  it('Edit: no number when the meta has none (a failed edit)', () => {
    expect(callChips(done('Edit', { file: '/a.ts' }, { status: 'error' }))).toEqual([]);
  });

  it('Edit: a zero is a zero when the patch says so', () => {
    expect(texts(done('Edit', { file: '/a.ts', added: 0, removed: 0 }))).toEqual(['+0 -0']);
  });

  it('Write: new file chip and the lines', () => {
    expect(texts(done('Write', { file: '/n.ts', added: 40, removed: 0, created: true }))).toEqual(['+40 -0', 'new']);
  });

  it('MultiEdit: the number of edits next to the churn', () => {
    expect(texts(done('MultiEdit', { file: '/a.ts', edits: 3, added: 4, removed: 2 }))).toEqual(['+4 -2', '3 edits']);
  });

  it('Bash: nothing for a plain success without output', () => {
    expect(callChips(done('Bash', { outputLines: 0 }))).toEqual([]);
    expect(callChips(done('Bash', undefined))).toEqual([]);
  });

  it('Bash: output size from the lines and the bytes of the result', () => {
    const [chip] = callChips(done('Bash', { outputLines: 42 }, { resultBytes: 3174 }));
    expect(text(chip!)).toBe('42 lines');
    expect(chip!.label).toBe('Output: 42 lines, 3.1 KiB');
    expect(texts(done('Bash', { outputLines: 1 }))).toEqual(['1 line']);
  });

  it('Bash: exit code and interruption in the failure colour, background flag first', () => {
    const chips = callChips(done('Bash', { background: true, exitCode: 2, interrupted: true }, { status: 'error' }));
    expect(chips.map(text)).toEqual(['bg', 'exit 2', 'interrupted']);
    expect(texts(done('Bash', { exitCode: 1, outputLines: 3 }, { status: 'error' }))).toEqual(['exit 1', '3 lines']);
    expect(chips[1]!.parts[0]!.tone).toBe('fail');
    expect(chips[2]!.parts[0]!.tone).toBe('warn');
  });

  it('Bash in the background: the result is the launch message, its lines are not the output', () => {
    expect(texts(done('Bash', { background: true, outputLines: 2, backgroundTaskId: 'b1' }))).toEqual(['bg']);
  });

  it('Read: a range of a bigger file, a whole file, an image', () => {
    expect(texts(done('Read', { file: '/a', readLines: 50, readFrom: 10, readTotal: 400 }))).toEqual(['10-59 of 400']);
    expect(texts(done('Read', { file: '/a', readLines: 120, readFrom: 1, readTotal: 120 }))).toEqual(['120 lines']);
    expect(texts(done('Read', { file: '/a.png', image: true }))).toEqual(['image']);
    expect(callChips(done('Read', { file: '/a' }))).toEqual([]);
  });

  it('Grep: files, lines (cut by the limit), matches; Glob: files (cut)', () => {
    expect(texts(done('Grep', { mode: 'files_with_matches', files: 12 }))).toEqual(['12 files']);
    expect(texts(done('Grep', { mode: 'files_with_matches', files: 1 }))).toEqual(['1 file']);
    expect(texts(done('Grep', { mode: 'content', lines: 20, limited: true }))).toEqual(['20 lines', 'cut']);
    expect(texts(done('Grep', { mode: 'count', matches: 31 }))).toEqual(['31 matches']);
    expect(texts(done('Glob', { files: 100, truncated: true }))).toEqual(['100 files', 'cut']);
    expect(texts(done('Glob', { files: 0 }))).toEqual(['0 files']);
  });

  it('WebFetch: host, status code (failure colour from 400), size', () => {
    const chips = callChips(done('WebFetch', { host: 'docs.example.com', httpCode: 404, fetchedBytes: 5120 }));
    expect(chips.map(text)).toEqual(['docs.example.com', '404', '5.0 KiB']);
    expect(chips[1]!.parts[0]!.tone).toBe('fail');
    expect(callChips(done('WebFetch', { host: 'a.io', httpCode: 200 }))[1]!.parts[0]!.tone).toBeUndefined();
  });

  it('Agent: the type of sub-agent and the background flag', () => {
    expect(texts(done('Agent', { subagentType: 'Explore', background: true }))).toEqual(['Explore', 'bg']);
    expect(callChips(done('Agent', undefined))).toEqual([]);
  });

  it('MCP: the server; the label of the row is the tool', () => {
    const call = done('mcp__github-wadeck__actions_list', { mcpServer: 'github-wadeck', mcpTool: 'actions_list' });
    expect(texts(call)).toEqual(['mcp github-wadeck']);
    expect(toolLabel(call)).toBe('actions_list');
    expect(toolLabel(done('Bash', undefined))).toBe('Bash');
  });
});

describe('groupChips', () => {
  const edit = (file: string, added: number, removed: number, patch: Partial<ToolCall> = {}): ToolCall => done('Edit', { file, added, removed }, patch);

  it('edits: files, then the total churn', () => {
    const chips = groupChips([edit('/a', 10, 1), edit('/b', 5, 2), edit('/a', 3, 0), done('Bash', undefined)]);
    const churn = chips.find((chip) => chip.id === 'edits')!;
    expect(text(churn)).toBe('2 files +18 -3');
    expect(churn.parts.map((part) => part.tone)).toEqual([undefined, 'add', 'remove']);
    expect(churn.label).toBe('2 files changed: 18 lines added, 3 lines removed');
  });

  it('edits: a failed edit applied nothing and is left out; a running one makes the total an estimate', () => {
    expect(text(groupChips([edit('/a', 2, 1), done('Edit', { file: '/b' }, { status: 'error' })]).find((chip) => chip.id === 'edits')!)).toBe('1 file +2 -1');
    const estimate = groupChips([edit('/a', 2, 1), done('Edit', { file: '/b', added: 4, removed: 0, churnApprox: true }, { status: 'running' })]).find((chip) => chip.id === 'edits')!;
    expect(text(estimate)).toBe('~ 2 files +6 -1');
  });

  it('edits: a successful edit with no number leaves the totals out rather than wrong', () => {
    const chip = groupChips([edit('/a', 2, 1), done('Edit', { file: '/b' })]).find((c) => c.id === 'edits')!;
    expect(text(chip)).toBe('2 files');
  });

  it('bash: count and total time; omitted while one is still running', () => {
    const bash = (ms: number | undefined, status: ToolCall['status'] = 'ok'): ToolCall => done('Bash', undefined, { durationMs: ms as number, status });
    expect(text(groupChips([bash(2000), bash(12_200)]).find((chip) => chip.id === 'bash')!)).toBe('2 bash 14 s');
    expect(text(groupChips([bash(2000), bash(undefined, 'running')]).find((chip) => chip.id === 'bash')!)).toBe('2 bash');
  });

  it('reads: count and the lines when every read says them', () => {
    const read = (lines: number | undefined): ToolCall => done('Read', lines === undefined ? { file: '/a' } : { file: '/a', readLines: lines });
    expect(text(groupChips([read(100), read(380)]).find((chip) => chip.id === 'reads')!)).toBe('2 reads 480 lines');
    expect(text(groupChips([read(100), read(undefined)]).find((chip) => chip.id === 'reads')!)).toBe('2 reads');
  });

  it('nothing to say: no chip', () => {
    expect(groupChips([done('Skill', undefined), done('ListAgents', undefined)])).toEqual([]);
  });
});

describe('groupTooltip', () => {
  it('one line per call: the name, the summary, the chips', () => {
    const calls = [done('Edit', { file: '/a.ts', added: 2, removed: 1 }, { inputSummary: '/a.ts' }), done('Bash', { outputLines: 3 }, { inputSummary: 'npm test', durationMs: 2500 })];
    expect(groupTooltip(calls)).toBe('Edit /a.ts: +2 -1, 1.0 s\nBash npm test: 3 lines, 2.5 s');
  });

  it('is capped, and says how many more', () => {
    const calls = Array.from({ length: 25 }, (_, i) => done('Bash', undefined, { inputSummary: `c${i}`, durationMs: undefined as unknown as number }));
    const lines = groupTooltip(calls).split('\n');
    expect(lines).toHaveLength(21);
    expect(lines[20]).toBe('... and 5 more');
  });
});
