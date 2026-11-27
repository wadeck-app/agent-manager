import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../deps.js';
import { assistantText, toolCall } from './entryFixtures.js';
import { buildRows, mergeSystemRows } from './grouping.js';

const hook = (key: string): LogEntry => ({ key, offset: 0, kind: 'hook', hookEvent: 'PreToolUse', hookName: 'PreToolUse:Bash', outcome: 'success', attachmentType: 'hook_success' });

describe('buildRows with hook entries', () => {
  it('a hook between two tool calls does not split the group: it follows it', () => {
    const rows = buildRows([toolCall('1'), hook('h1'), toolCall('2'), hook('h2'), toolCall('3'), assistantText('a', 'done')]);
    expect(rows.map((row) => (row.type === 'group' ? `group(${row.calls.length})` : row.key))).toEqual(['group(3)', 'h1', 'h2', 'a']);
  });

  it('a hook before a lone call, or after the run, stays where it is', () => {
    const rows = buildRows([hook('h0'), toolCall('1'), hook('h1'), assistantText('a', 'x'), hook('h2')]);
    expect(rows.map((row) => row.key)).toEqual(['h0', 'call:1', 'h1', 'a', 'h2']);
  });

  it('a lone call with a hook after it stays a single row', () => {
    const rows = buildRows([toolCall('1'), hook('h1'), assistantText('a', 'x')]);
    expect(rows.map((row) => row.type)).toEqual(['entry', 'entry', 'entry']);
  });
});

describe('buildRows, grouped or separate', () => {
  const entries = [toolCall('1'), hook('h1'), toolCall('2'), toolCall('3', { name: 'Agent' }), assistantText('a', 'done')];

  it('grouped (the default) is today: one group, the hook after it', () => {
    expect(buildRows(entries).map((row) => row.type)).toEqual(['group', 'entry', 'entry']);
    expect(buildRows(entries, true)).toEqual(buildRows(entries));
  });

  it('separate: one row per entry, in the order of the transcript, keys of the calls kept', () => {
    const rows = buildRows(entries, false);
    expect(rows.every((row) => row.type === 'entry')).toBe(true);
    expect(rows.map((row) => row.key)).toEqual(['call:1', 'h1', 'call:2', 'call:3', 'a']);
  });
});

describe('mergeSystemRows', () => {
  const notice = (key: string, noticeKind: 'stop-hook' | 'turn-duration' | 'local-command'): LogEntry => ({ key, offset: 0, kind: 'system-notice', noticeKind, subtype: noticeKind, isMeta: false, durationMs: 32_000 });
  const rows = buildRows([assistantText('a', 'x'), hook('h1'), notice('n1', 'stop-hook'), notice('n2', 'turn-duration'), assistantText('b', 'y'), notice('n3', 'local-command')]);

  it('look rows: the rows are returned as they are', () => {
    expect(mergeSystemRows(rows, 'rows').map((row) => row.key)).toEqual(rows.map((row) => row.key));
  });

  it('other looks: a run of hooks and turn rows is ONE row that holds every entry; a message or another notice ends the run', () => {
    const merged = mergeSystemRows(rows, 'merged');
    expect(merged.map((row) => row.type)).toEqual(['entry', 'system', 'entry', 'entry']);
    const system = merged[1]!;
    expect(system.type === 'system' ? system.entries.map((entry) => entry.key) : []).toEqual(['h1', 'n1', 'n2']);
    expect(system.key).toBe('system:h1');
  });
});
