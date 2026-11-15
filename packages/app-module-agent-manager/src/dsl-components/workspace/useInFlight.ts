import { useCallback, useState } from 'react';

/** True while at least one tracked request is in flight: a counter, so the first request to finish does not clear the flag of the others. */
export function useInFlight(): { busy: boolean; track: <T>(work: Promise<T>) => Promise<T> } {
  const [count, setCount] = useState(0);
  const track = useCallback(async <T,>(work: Promise<T>): Promise<T> => {
    setCount((current) => current + 1);
    try {
      return await work;
    } finally {
      setCount((current) => current - 1);
    }
  }, []);
  return { busy: count > 0, track };
}
