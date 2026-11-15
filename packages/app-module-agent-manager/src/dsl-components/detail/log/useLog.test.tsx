import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry, LogResponse } from '../deps.js';
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

describe('live polling: entries appended while the page is open', () => {
  let written: LogEntry[];
  let requests: string[];

  /** A tiny server: the cursor is how many entries it has sent; `after=<n>` returns the rest. */
  function serveAppendable(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requests.push(url);
        const after = new URL(url, 'http://x').searchParams.get('after');
        const from = after === null ? 0 : Number(after);
        return json(answer(written.slice(from), { cursor: String(written.length) }));
      }),
    );
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    written = [{ ...assistantText('a0', 'first'), offset: 0 }];
    requests = [];
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(document, 'hidden');
  });

  const oversize = { key: '1000.0', offset: 1000, kind: 'oversize', bytes: 1_300_000, limit: 1_048_576 } as LogEntry;

  it('shows the answer that arrives after a delivered message and a very large line, within one poll', async () => {
    serveAppendable();
    const { result } = renderHook(() => useLog('s-live'));
    await waitFor(() => expect(result.current.state.entries).toHaveLength(1));
    // The message is delivered (a peer entry), a huge line follows (the viewer gets a marker for it), then the answer.
    written.push({ ...assistantText('w', 'delivered'), offset: 100 }, oversize, { ...assistantText('answer', 'Salut ! the answer'), offset: 2_000_000 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(result.current.state.entries.map((entry) => entry.key)).toEqual(['a0', 'w', '1000.0', 'answer']);
    expect(result.current.state.appended).toBe(3);
  });

  it('a hidden tab does not poll, and refreshes at once when it shows again', async () => {
    serveAppendable();
    const { result } = renderHook(() => useLog('s-hidden'));
    await waitFor(() => expect(result.current.state.entries).toHaveLength(1));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    const before = requests.length;
    written.push({ ...assistantText('late', 'while hidden'), offset: 100 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(requests.length).toBe(before);
    expect(result.current.state.entries).toHaveLength(1);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(result.current.state.entries.map((entry) => entry.key)).toEqual(['a0', 'late']);
  });
});
