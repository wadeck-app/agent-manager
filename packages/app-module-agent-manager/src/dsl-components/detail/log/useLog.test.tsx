import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogResponse } from '../deps.js';
import { resetPending } from '../pending.js';
import { answer, assistantText } from './entryFixtures.js';
import { useLog } from './useLog.js';

function json(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  resetPending();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadOlderUntil and the lock of the older pages', () => {
  it('an abort while it waits for a page loaded by the scroll returns cancelled and leaves that page its lock', async () => {
    let release: (page: LogResponse) => void = () => undefined;
    const gate = new Promise<LogResponse>((resolve) => (release = resolve));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.includes('before=') ? json(await gate) : json(answer([{ ...assistantText('new', 'recent'), offset: 9000 }], { olderCursor: 'o1' })))),
    );
    const { result } = renderHook(() => useLog('s1'));
    await waitFor(() => expect(result.current.state.olderCursor).toBe('o1'));
    // The scroll starts a page: it owns the lock.
    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.loadingOlder).toBe(true));
    const controller = new AbortController();
    const onPage = vi.fn();
    let outcome: Awaited<ReturnType<typeof result.current.loadOlderUntil>> | undefined;
    const pending = result.current.loadOlderUntil(100, { signal: controller.signal, maxPages: 5, onPage }).then((value) => (outcome = value));
    controller.abort();
    await act(async () => {
      await pending;
    });
    expect(outcome).toEqual({ status: 'cancelled', pages: 0 });
    // The page of the scroll still runs: the aborted search did not clear its lock.
    expect(result.current.loadingOlder).toBe(true);
    expect(onPage).not.toHaveBeenCalled();
    await act(async () => release(answer([{ ...assistantText('mid', 'middle'), offset: 5000 }], { olderCursor: null })));
    await waitFor(() => expect(result.current.loadingOlder).toBe(false));
    // The entries of the page came once.
    expect(result.current.state.entries.filter((entry) => entry.key === 'mid').length).toBe(1);
  });

  it('with the whole transcript loaded and the target before the first held entry: start with 0 pages (the caller says the real situation)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(answer([{ ...assistantText('new', 'recent'), offset: 9000 }], { olderCursor: null }))));
    const { result } = renderHook(() => useLog('s2'));
    await waitFor(() => expect(result.current.state.entries.length).toBe(1));
    const outcome = await result.current.loadOlderUntil(100, { signal: new AbortController().signal, maxPages: 5, onPage: () => undefined });
    expect(outcome).toEqual({ status: 'start', pages: 0 });
  });

  it('with the whole transcript loaded and the target inside the held range: reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(answer([{ ...assistantText('a', 'first'), offset: 50 }, { ...assistantText('b', 'second'), offset: 9000 }], { olderCursor: null }))));
    const { result } = renderHook(() => useLog('s3'));
    await waitFor(() => expect(result.current.state.entries.length).toBe(2));
    const outcome = await result.current.loadOlderUntil(100, { signal: new AbortController().signal, maxPages: 5, onPage: () => undefined });
    expect(outcome).toEqual({ status: 'reached', pages: 0 });
  });
});
