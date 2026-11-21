import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJson } from '../data/http.js';
import type { DenialsDto } from '../shared.js';

export interface Loaded<T> {
  /** The last answer (kept while a refresh runs or fails: a failed poll never blanks what is on screen). */
  value: T | undefined;
  /** Why the last request failed, empty when it worked. */
  error: string;
  loading: boolean;
}

export interface DenialFilter {
  day: string;
  category: string;
  session: string;
  limit: number;
}

export interface DenialsLoaded extends Loaded<DenialsDto> {
  reload: () => void;
  /** Why the command texts (PIN) could not be fetched; the list below it then has none. Empty when it worked or was not asked. */
  commandsError: string;
}

function queryOf(filter: DenialFilter): string {
  const params = new URLSearchParams();
  for (const [name, value] of [['day', filter.day], ['category', filter.category], ['session', filter.session]] as const) {
    if (value !== '') {
      params.set(name, value);
    }
  }
  params.set('limit', String(filter.limit));
  return `?${params.toString()}`;
}

/**
 * The denial timeline for a filter, requested when the filter changes and on `reload` (no polling: a PIN dialog must never open by itself). With
 * `wantCommands` it asks the PIN-protected route; when that fails (PIN cancelled, no PIN set) the reason is `commandsError` and the list is fetched
 * without the texts, and the PIN is not asked again until the user turns the option off and on.
 */
export function useDenials(filter: DenialFilter, wantCommands: boolean): DenialsLoaded {
  const [state, setState] = useState<Loaded<DenialsDto>>({ value: undefined, error: '', loading: true });
  const [commandsError, setCommandsError] = useState('');
  const [tick, setTick] = useState(0);
  const gaveUp = useRef(false);
  useEffect(() => {
    if (!wantCommands) {
      gaveUp.current = false;
      setCommandsError('');
    }
  }, [wantCommands]);
  const query = queryOf(filter);
  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({ ...previous, loading: true }));
    void (async () => {
      let result;
      if (wantCommands && !gaveUp.current) {
        result = await requestJson<DenialsDto>(`/guardrails/denials/commands${query}`, { signal: controller.signal });
        if (!result.ok && !controller.signal.aborted) {
          gaveUp.current = true;
          setCommandsError(result.text);
          result = undefined;
        }
      }
      result ??= await requestJson<DenialsDto>(`/guardrails/denials${query}`, { signal: controller.signal });
      if (controller.signal.aborted) {
        return;
      }
      const done = result;
      setState((previous) => (done.ok ? { value: done.value, error: '', loading: false } : { value: previous.value, error: done.text, loading: false }));
    })();
    return () => controller.abort();
  }, [query, wantCommands, tick]);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { ...state, reload, commandsError };
}
