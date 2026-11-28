import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { subagent } from './entryFixtures.js';
import { countNeedingEye, flattenSubagents, formatAge, isStale, type KeepAge } from './subagentModel.js';
import { SubagentRow } from './SubagentRow.js';
import { SubagentsView } from './SubagentsView.js';
import { SUBAGENT_PREFS_KEY, readPrefs, useSubagentPrefs } from './subagentPrefs.js';
import { foldLabel } from './SubagentSummary.js';

const NOW = Date.parse('2026-11-27T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;

/** One sub-agent of each kind and age: active, fresh and old failed, fresh and old idle, finished. */
const fleet = flattenSubagents([
  subagent({ agentId: 'run00001', description: 'runner', status: 'active', finished: false, startedAt: NOW - 5 * MIN, lastActivityAt: NOW - 5_000 }),
  subagent({ agentId: 'badnew01', description: 'fresh failure', status: 'failed', failureReason: 'Stopped by the user', startedAt: NOW - 20 * MIN, endedAt: NOW - 5 * MIN, lastActivityAt: NOW - 5 * MIN }),
  subagent({ agentId: 'badold01', description: 'old failure', status: 'failed', failureReason: 'Stopped by the user', startedAt: NOW - 49 * HOUR, endedAt: NOW - 48 * HOUR, lastActivityAt: NOW - 48 * HOUR }),
  subagent({ agentId: 'idlnew01', description: 'fresh idle', status: 'idle', finished: false, startedAt: NOW - 30 * MIN, lastActivityAt: NOW - 20 * MIN }),
  subagent({ agentId: 'idlold01', description: 'old idle', status: 'idle', finished: false, startedAt: NOW - 3 * HOUR - 17_000, lastActivityAt: NOW - 3 * HOUR }),
  subagent({ agentId: 'ok000001', description: 'done worker', startedAt: NOW - 2 * HOUR, endedAt: NOW - 90 * MIN }),
]);
const [, freshFailed, oldFailed, freshIdle, oldIdle, finished] = fleet;

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function view(keep: KeepAge, selectedId?: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  return render(<SubagentsView items={fleet} mode="summary" onMode={() => undefined} order="recent" onOrder={() => undefined} keep={keep} onKeep={() => undefined} selectedId={selectedId} phase="idle" onSelect={() => undefined} note="" />);
}

const shown = (name: string): boolean => screen.queryAllByRole('button').some((button) => (button.textContent ?? '').includes(name));

describe('isStale: only a failed or idle one, only after the chosen age', () => {
  // [fresh failure (5 min), old failure (48 h), fresh idle (20 min), old idle (3 h), finished]
  it.each([
    ['10m', [false, true, true, true, false]],
    ['1h', [false, true, false, true, false]],
    ['8h', [false, true, false, false, false]],
    ['always', [false, false, false, false, false]],
  ] as const)('keep %s', (keep, expected) => {
    const items = [freshFailed!, oldFailed!, freshIdle!, oldIdle!, finished!];
    expect(items.map((item) => isStale(item, NOW, keep))).toEqual(expected);
  });

  it('a failed or idle one with no known time is never stale (nothing says it is old)', () => {
    const [undated] = flattenSubagents([subagent({ agentId: 'u0000001', status: 'failed' })]);
    expect(isStale(undated!, NOW, '10m')).toBe(false);
  });
});

describe('countNeedingEye: the chips leave out stale failed and idle ones, the total stays', () => {
  it('1 h: the 48 h failure and the 3 h idle are not counted, the fresh ones are', () => {
    const items = [freshFailed!, oldFailed!, freshIdle!, oldIdle!, finished!];
    expect(countNeedingEye(items, NOW, '1h')).toMatchObject({ total: 5, failed: 1, idle: 1, finished: 1 });
  });

  it('always: nothing is left out', () => {
    const items = [freshFailed!, oldFailed!, freshIdle!, oldIdle!, finished!];
    expect(countNeedingEye(items, NOW, 'always')).toMatchObject({ total: 5, failed: 2, idle: 2 });
  });
});

describe('the Summary folds old failed and idle rows and keeps the counts', () => {
  it('1 h (default): the 48 h failure and the 3 h idle fold, the headline still counts them, the fold keeps their status', () => {
    view('1h');
    expect(screen.getByText('3 of 6 done, 1 active (no end marker), 2 failed, 2 idle')).toBeInTheDocument();
    expect(shown('runner')).toBe(true);
    expect(shown('fresh failure')).toBe(true);
    expect(shown('fresh idle')).toBe(true);
    expect(shown('old failure')).toBe(false);
    expect(shown('old idle')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '1 finished, 2 older failed or idle' }));
    const oldFailure = screen.getByRole('button', { name: /old failure/ });
    expect(oldFailure).toHaveTextContent('Failed');
    expect(oldFailure).toHaveTextContent('ended 2d 0h ago');
  });

  it('10 min: the 20 min idle folds too', () => {
    view('10m');
    expect(shown('fresh idle')).toBe(false);
    expect(screen.getByRole('button', { name: '1 finished, 3 older failed or idle' })).toBeInTheDocument();
  });

  it('always: only the finished one folds', () => {
    view('always');
    expect(shown('old failure')).toBe(true);
    expect(screen.getByRole('button', { name: '1 finished' })).toBeInTheDocument();
  });

  it('a selected old row stays in view', () => {
    view('1h', 'badold01');
    expect(shown('old failure')).toBe(true);
    expect(screen.getByRole('button', { name: '1 finished, 1 older failed or idle' })).toBeInTheDocument();
  });

  it('the Failed and Idle filters show every one, whatever its age', () => {
    view('10m');
    fireEvent.change(screen.getByRole('combobox', { name: 'Show sub-agents' }), { target: { value: 'failed' } });
    expect(shown('old failure')).toBe(true);
    expect(shown('fresh failure')).toBe(true);
    fireEvent.change(screen.getByRole('combobox', { name: 'Show sub-agents' }), { target: { value: 'idle' } });
    expect(shown('old idle')).toBe(true);
    expect(shown('fresh idle')).toBe(true);
    expect(screen.queryByRole('button', { name: /older failed or idle/ })).toBeNull();
  });

  it('the menu changes the age through onKeep', () => {
    const onKeep = vi.fn();
    render(<SubagentsView items={fleet} mode="summary" onMode={() => undefined} order="recent" onOrder={() => undefined} keep="1h" onKeep={onKeep} selectedId={undefined} phase="idle" onSelect={() => undefined} note="" />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Keep failed and idle sub-agents in view for' }), { target: { value: '8h' } });
    expect(onKeep).toHaveBeenCalledWith('8h');
  });
});

describe('the wording of idle and failed rows', () => {
  const rowOf = (item: NonNullable<typeof oldIdle>) => render(<SubagentRow item={item} now={NOW} selected={false} locate="idle" onSelect={() => undefined} />);

  it('idle: says what is known, and the duration reads as a run time', () => {
    rowOf(oldIdle!);
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('Idle');
    expect(button).toHaveTextContent('no finish marker, last activity 3h 00m ago');
    expect(button).toHaveTextContent('ran 17s');
  });

  it('failed: keeps its reason and adds when it ended', () => {
    rowOf(oldFailed!);
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('Stopped by the user');
    expect(button).toHaveTextContent('ended 2d 0h ago');
    expect(button).toHaveTextContent('ran 1h 00m');
  });

  it('the ages are coarse and never negative', () => {
    expect(formatAge(-5)).toBe('0s');
    expect(formatAge(42_000)).toBe('42s');
    expect(formatAge(5 * MIN + 59_000)).toBe('5m');
    expect(formatAge(2 * HOUR + 3 * MIN)).toBe('2h 03m');
    expect(formatAge(49 * HOUR)).toBe('2d 1h');
  });

  it('the fold label says what it holds', () => {
    expect(foldLabel(185, 0)).toBe('185 finished');
    expect(foldLabel(185, 3)).toBe('185 finished, 3 older failed or idle');
    expect(foldLabel(0, 3)).toBe('3 older failed or idle');
  });
});

describe('the age option is a persisted view preference', () => {
  it('defaults to 1 h and is saved with the other panel choices', () => {
    expect(readPrefs().prefs.keep).toBe('1h');
    const { result } = renderHook(() => useSubagentPrefs());
    act(() => result.current.change({ keep: '8h' }));
    expect(JSON.parse(window.localStorage.getItem(SUBAGENT_PREFS_KEY) ?? '{}')).toEqual({ keep: '8h' });
    expect(readPrefs().prefs.keep).toBe('8h');
  });
});
