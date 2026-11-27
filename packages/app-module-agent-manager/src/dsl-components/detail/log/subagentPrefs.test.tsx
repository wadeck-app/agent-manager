import { act, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { READ_PROBLEM, SUBAGENT_PREFS_KEY, WRITE_PROBLEM, readPrefs, useSubagentPrefs } from './subagentPrefs.js';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

describe('readPrefs', () => {
  it('nothing saved is not a problem', () => {
    expect(readPrefs()).toEqual({ prefs: { mode: 'summary', order: 'recent', keep: '1h' }, problem: '' });
  });

  it.each([['text that is not JSON', '{nope'], ['JSON that is not an object', '[1]'], ['an unknown mode', '{"mode":"groups"}'], ['an unknown order', '{"order":"sideways"}'], ['a collapsed that is not a boolean', '{"collapsed":"yes"}'], ['an unknown keep age', '{"keep":"2h"}']])('%s: the defaults, a sentence, one console warning', (_name, raw) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    window.localStorage.setItem(SUBAGENT_PREFS_KEY, raw);
    const read = readPrefs();
    expect(read.problem).toBe(READ_PROBLEM);
    expect(read.prefs.mode).toBe('summary');
    expect(read.prefs.order).toBe('recent');
    expect(read.prefs.keep).toBe('1h');
    // Reading it again does not warn again.
    readPrefs();
    expect(warn.mock.calls.filter((call) => String(call[0]).includes('could not be read')).length).toBeLessThanOrEqual(1);
  });
});

describe('useSubagentPrefs', () => {
  it('writes once per change (no side effect inside a state updater, even in strict mode)', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(() => useSubagentPrefs(), { wrapper: strict });
    act(() => result.current.change({ mode: 'timeline' }));
    expect(set).toHaveBeenCalledTimes(1);
    expect(result.current.prefs.mode).toBe('timeline');
  });

  it('writes per field: a field changed meanwhile by another tab is kept', () => {
    window.localStorage.setItem(SUBAGENT_PREFS_KEY, JSON.stringify({ mode: 'timeline', order: 'oldest' }));
    const { result } = renderHook(() => useSubagentPrefs());
    // Another tab collapses the panel; this tab (which does not know yet) changes only the mode.
    window.localStorage.setItem(SUBAGENT_PREFS_KEY, JSON.stringify({ mode: 'timeline', order: 'oldest', collapsed: true }));
    act(() => result.current.change({ mode: 'summary' }));
    expect(JSON.parse(window.localStorage.getItem(SUBAGENT_PREFS_KEY) ?? '{}')).toEqual({ mode: 'summary', order: 'oldest', collapsed: true });
  });

  it('follows the other tabs (storage event)', () => {
    const { result } = renderHook(() => useSubagentPrefs());
    expect(result.current.prefs.order).toBe('recent');
    window.localStorage.setItem(SUBAGENT_PREFS_KEY, JSON.stringify({ order: 'oldest', collapsed: true }));
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: SUBAGENT_PREFS_KEY }));
    });
    expect(result.current.prefs).toMatchObject({ order: 'oldest', collapsed: true });
  });

  it('a write that fails keeps the choice, says so, and the note can be dismissed', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = renderHook(() => useSubagentPrefs());
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    act(() => result.current.change({ order: 'oldest' }));
    expect(result.current.prefs.order).toBe('oldest');
    expect(result.current.problem).toBe(WRITE_PROBLEM);
    act(() => result.current.dismissProblem());
    expect(result.current.problem).toBe('');
  });
});
