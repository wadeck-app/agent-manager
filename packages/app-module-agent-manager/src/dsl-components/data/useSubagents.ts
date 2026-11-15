import { useCallback, useEffect, useState } from 'react';
import type { LogResponse, SubagentDto } from '../shared.js';
import { requestJson } from './http.js';

export type SubagentsState =
  | { status: 'loading' }
  | { status: 'ready'; subagents: SubagentDto[]; note: string }
  | { status: 'failed'; text: string };

/**
 * The sub-agent tree of one session, fetched once when `enabled` turns true (a session expanded in the tree list), through the cheapest log request
 * (one entry): the route sends the whole tree with any answer. `retry` asks again after a failure.
 */
export function useSubagents(sessionId: string, enabled: boolean): { state: SubagentsState; retry: () => void } {
  const [state, setState] = useState<SubagentsState>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    void requestJson<LogResponse>(`/sessions/${encodeURIComponent(sessionId)}/log?limit=1`, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) {
        return;
      }
      if (!result.ok) {
        setState({ status: 'failed', text: result.text });
      } else if (!result.value.ok) {
        const { message, hint } = result.value.error;
        setState({ status: 'failed', text: `${message}. ${hint}` });
      } else {
        setState({ status: 'ready', subagents: result.value.subagents, note: result.value.subagentsNote });
      }
    });
    return () => controller.abort();
  }, [sessionId, enabled, tick]);
  const retry = useCallback(() => setTick((value) => value + 1), []);
  return { state, retry };
}
