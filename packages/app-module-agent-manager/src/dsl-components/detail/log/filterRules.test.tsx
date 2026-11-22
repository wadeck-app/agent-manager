import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry } from '../deps.js';
import { assistantText, toolCall, userPrompt } from './entryFixtures.js';
import { DEFAULT_FILTERS, FILTER_PREFS_KEY, FILTER_READ_PROBLEM, FILTER_WRITE_PROBLEM, applyFilters, categoryOf, readFilterPrefs, useLogFilters } from './logFilters.js';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const hook = (key: string, patch: Partial<Extract<LogEntry, { kind: 'hook' }>> = {}): LogEntry => ({ key, offset: 0, kind: 'hook', hookEvent: 'PreToolUse', hookName: 'PreToolUse:Bash', outcome: 'success', attachmentType: 'hook_success', ...patch });
const notice = (key: string, noticeKind: Extract<LogEntry, { kind: 'system-notice' }>['noticeKind']): LogEntry => ({ key, offset: 0, kind: 'system-notice', noticeKind, subtype: noticeKind, isMeta: false });
const prompt = (key: string, patch: Partial<Extract<LogEntry, { kind: 'user-prompt' }>>): LogEntry => ({ ...(userPrompt(key, 'text') as Extract<LogEntry, { kind: 'user-prompt' }>), ...patch });
const queue = (key: string, contentKind: 'task-notification' | 'cross-session-message' | 'text'): LogEntry => ({ key, offset: 0, kind: 'queue-operation', operation: 'enqueue', contentKind });

describe('categoryOf', () => {
  it('hooks: hook entries and the Stop hook summary', () => {
    expect(categoryOf(hook('h'))).toBe('hooks');
    expect(categoryOf(notice('n', 'stop-hook'))).toBe('hooks');
    expect(categoryOf(notice('n', 'turn-duration'))).toBeUndefined();
  });

  it('tools: every tool call but the ones that carry a message between agents, orphan results included', () => {
    expect(categoryOf(toolCall('1', { name: 'Bash' }))).toBe('tools');
    expect(categoryOf(toolCall('2', { name: '(unknown)', orphan: true }))).toBe('tools');
    expect(categoryOf(toolCall('3', { name: 'mcp__srv__tool' }))).toBe('tools');
  });

  it('agent messages: SendMessage and Agent calls (the prompt and the result of a sub-agent), peer and task-notification prompts, their queue lines', () => {
    expect(categoryOf(toolCall('1', { name: 'SendMessage' }))).toBe('agents');
    expect(categoryOf(toolCall('2', { name: 'Agent' }))).toBe('agents');
    expect(categoryOf(toolCall('3', { name: 'Task' }))).toBe('agents');
    expect(categoryOf(prompt('p', { source: 'peer' }))).toBe('agents');
    expect(categoryOf(prompt('t', { source: 'task-notification' }))).toBe('agents');
    expect(categoryOf(queue('q1', 'cross-session-message'))).toBe('agents');
    expect(categoryOf(queue('q2', 'task-notification'))).toBe('agents');
  });

  it('never filtered: what the person and Claude say, a message the person sent from here, plain queue lines, the harness notes', () => {
    expect(categoryOf(userPrompt('u', 'hi'))).toBeUndefined();
    expect(categoryOf(assistantText('a', 'hi'))).toBeUndefined();
    expect(categoryOf(prompt('w', { source: 'peer', webReply: { messageId: 'm', text: 'x' } }))).toBeUndefined();
    expect(categoryOf(queue('q3', 'text'))).toBeUndefined();
    expect(categoryOf(prompt('i', { source: 'injected' }))).toBeUndefined();
  });
});

describe('applyFilters', () => {
  const entries = [userPrompt('u', 'hi'), hook('h1'), toolCall('1'), hook('h2'), toolCall('2', { name: 'SendMessage' }), prompt('p', { source: 'peer' }), assistantText('a', 'ok')];

  it('defaults: hooks hidden, tools and agent messages shown; counts are over every loaded entry, hidden over the ones left out', () => {
    const result = applyFilters(entries, DEFAULT_FILTERS);
    expect(result.entries.map((entry) => entry.key)).toEqual(['u', 'call:1', 'call:2', 'p', 'a']);
    expect(result.counts).toEqual({ hooks: 2, tools: 1, agents: 2 });
    expect(result.hidden).toEqual({ hooks: 2, tools: 0, agents: 0 });
    expect(result.hiddenTotal).toBe(2);
  });

  it('everything shown: nothing hidden, same list', () => {
    const result = applyFilters(entries, { hooks: true, tools: true, agents: true });
    expect(result.entries).toHaveLength(entries.length);
    expect(result.hiddenTotal).toBe(0);
  });

  it('everything off: only the conversation stays', () => {
    const result = applyFilters(entries, { hooks: false, tools: false, agents: false });
    expect(result.entries.map((entry) => entry.key)).toEqual(['u', 'a']);
    expect(result.hiddenTotal).toBe(5);
  });

  it('keep: an entry the page needs stays visible whatever the filter says, and is not counted as hidden', () => {
    const result = applyFilters(entries, { hooks: false, tools: false, agents: false }, (entry) => entry.key === 'call:2');
    expect(result.entries.map((entry) => entry.key)).toEqual(['u', 'call:2', 'a']);
    expect(result.hidden.agents).toBe(1);
  });
});

describe('readFilterPrefs', () => {
  it('nothing saved is not a problem', () => {
    expect(readFilterPrefs()).toEqual({ prefs: DEFAULT_FILTERS, problem: '' });
  });

  it('reads what was saved', () => {
    window.localStorage.setItem(FILTER_PREFS_KEY, JSON.stringify({ hooks: true, tools: false }));
    expect(readFilterPrefs()).toEqual({ prefs: { hooks: true, tools: false, agents: true }, problem: '' });
  });

  it.each([['text that is not JSON', '{nope'], ['JSON that is not an object', '[1]'], ['a value that is not a boolean', '{"hooks":"yes"}']])('%s: the defaults and a sentence', (_name, raw) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    window.localStorage.setItem(FILTER_PREFS_KEY, raw);
    expect(readFilterPrefs()).toEqual({ prefs: DEFAULT_FILTERS, problem: FILTER_READ_PROBLEM });
  });

  it('warns on the console once per page load, however often it reads', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    window.localStorage.setItem(FILTER_PREFS_KEY, '{nope');
    readFilterPrefs();
    readFilterPrefs();
    expect(warn.mock.calls.filter((call) => String(call[0]).includes('log filters')).length).toBeLessThanOrEqual(1);
  });
});

describe('useLogFilters', () => {
  it('a toggle is saved per field and read back', () => {
    const { result } = renderHook(() => useLogFilters());
    act(() => result.current.change({ hooks: true }));
    expect(result.current.prefs).toEqual({ hooks: true, tools: true, agents: true });
    expect(JSON.parse(window.localStorage.getItem(FILTER_PREFS_KEY) ?? '{}')).toEqual({ hooks: true });
    const second = renderHook(() => useLogFilters());
    expect(second.result.current.prefs.hooks).toBe(true);
  });

  it('a storage that refuses the write: the choice holds, a sentence says it will not be remembered', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const { result } = renderHook(() => useLogFilters());
    act(() => result.current.change({ tools: false }));
    expect(result.current.prefs.tools).toBe(false);
    expect(result.current.problem).toBe(FILTER_WRITE_PROBLEM);
    act(() => result.current.dismissProblem());
    expect(result.current.problem).toBe('');
  });

  it('follows another tab (storage event)', () => {
    const { result } = renderHook(() => useLogFilters());
    window.localStorage.setItem(FILTER_PREFS_KEY, JSON.stringify({ agents: false }));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: FILTER_PREFS_KEY }));
    });
    expect(result.current.prefs.agents).toBe(false);
  });
});
