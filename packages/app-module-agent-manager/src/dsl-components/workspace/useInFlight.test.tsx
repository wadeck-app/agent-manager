import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useInFlight } from './useInFlight.js';

function deferred(): { promise: Promise<void>; done: () => void } {
  let done = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    done = resolve;
  });
  return { promise, done };
}

describe('useInFlight', () => {
  it('stays busy until the LAST of several overlapping requests finishes, and clears when one fails', async () => {
    const { result } = renderHook(() => useInFlight());
    const first = deferred();
    const second = deferred();
    let firstDone: Promise<void> = Promise.resolve();
    let secondDone: Promise<void> = Promise.resolve();
    act(() => {
      firstDone = result.current.track(first.promise);
      secondDone = result.current.track(second.promise);
    });
    expect(result.current.busy).toBe(true);
    await act(async () => {
      first.done();
      await firstDone;
    });
    expect(result.current.busy).toBe(true);
    await act(async () => {
      second.done();
      await secondDone;
    });
    expect(result.current.busy).toBe(false);
    await act(async () => {
      await result.current.track(Promise.reject(new Error('x'))).catch(() => undefined);
    });
    expect(result.current.busy).toBe(false);
  });
});
