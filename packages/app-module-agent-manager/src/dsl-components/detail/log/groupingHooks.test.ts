import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../deps.js';
import { assistantText, toolCall } from './entryFixtures.js';
import { buildRows } from './grouping.js';

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
