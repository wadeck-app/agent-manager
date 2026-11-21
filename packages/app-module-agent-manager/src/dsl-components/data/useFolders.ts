import { useCallback, useEffect, useRef, useState } from 'react';
import type { FolderListResponse, FolderRecentResponse, FolderRootsResponse, FolderSearchResponse } from '../shared.js';
import { failureText, requestJson } from './http.js';

/** A request in flight, answered, or failed with what to do. `code` is the server's machine code of the failure, when it sent one. */
export type Loadable<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'failed'; text: string; code?: string };

type Answer<T> = { ok: true; value: T } | { ok: false; text: string; code?: string };

/** A failure sent as `{ ok: false, error }` with a 2xx status (nothing today: every folder failure is a 4xx) is still a failure, with its text. */
function unwrap<T extends { ok: boolean }>(result: { ok: true; value: T } | { ok: false; text: string; code?: string }): Answer<Extract<T, { ok: true }>> {
  if (!result.ok) {
    return result;
  }
  if (!result.value.ok) {
    return { ok: false, text: failureText(result.value, 200) };
  }
  return { ok: true, value: result.value as Extract<T, { ok: true }> };
}

export const loadFolderList = async (path: string, signal?: AbortSignal) => unwrap(await requestJson<FolderListResponse>(`/folders/list?path=${encodeURIComponent(path)}`, { signal }));
export const loadFolderRoots = async (signal?: AbortSignal) => unwrap(await requestJson<FolderRootsResponse>('/folders/roots', { signal }));
export const loadFolderRecent = async (signal?: AbortSignal) => unwrap(await requestJson<FolderRecentResponse>('/folders/recent', { signal }));
export const loadFolderSearch = async (query: string, signal?: AbortSignal) => unwrap(await requestJson<FolderSearchResponse>(`/folders/search?q=${encodeURIComponent(query)}`, { signal }));

function toLoadable<T>(answer: Answer<T>): Loadable<T> {
  return answer.ok ? { status: 'ready', value: answer.value } : { status: 'failed', text: answer.text, ...(answer.code === undefined ? {} : { code: answer.code }) };
}

/** Runs `load` when the component mounts and again on `retry`; an answer that arrives after the unmount or a newer request is dropped. */
function useLoaded<T>(load: (signal: AbortSignal) => Promise<Answer<T>>): { state: Loadable<T>; retry: () => void } {
  const [state, setState] = useState<Loadable<T>>({ status: 'loading' });
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    void loadRef.current(controller.signal).then((answer) => {
      if (!controller.signal.aborted) {
        setState(toLoadable(answer));
      }
    });
    return () => controller.abort();
  }, [tick]);
  const retry = useCallback(() => setTick((value) => value + 1), []);
  return { state, retry };
}

export const useFolderRoots = () => useLoaded(loadFolderRoots);
export const useFolderRecent = () => useLoaded(loadFolderRecent);

type ListOk = Extract<FolderListResponse, { ok: true }>;

/**
 * The listings a picker has opened, by path: `ensure` loads a folder once (nothing happens when it is loaded or loading), `reload` asks again after a failure.
 * Answers that arrive after the unmount are dropped. The listing of a folder is never refreshed behind the user's back: it is as it was when opened.
 */
export function useFolderLists(): { lists: Readonly<Record<string, Loadable<ListOk>>>; ensure: (path: string) => void; reload: (path: string) => void } {
  const [lists, setLists] = useState<Record<string, Loadable<ListOk>>>({});
  const asked = useRef(new Set<string>());
  // A flag, not an AbortController: React may run the effect twice (strict mode) and a request made in between must still be answered.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useCallback((path: string): void => {
    asked.current.add(path);
    setLists((current) => ({ ...current, [path]: { status: 'loading' } }));
    void loadFolderList(path).then((answer) => {
      if (mounted.current) {
        setLists((current) => ({ ...current, [path]: toLoadable(answer) }));
      }
    });
  }, []);
  const ensure = useCallback(
    (path: string): void => {
      if (!asked.current.has(path)) {
        run(path);
      }
    },
    [run],
  );
  return { lists, ensure, reload: run };
}

/** The search of the known projects: `query` is debounced (`delayMs`), an older answer never replaces a newer one. `undefined` asks nothing (the caller shows something else). */
export function useFolderSearch(query: string | undefined, delayMs = 180): Loadable<Extract<FolderSearchResponse, { ok: true }>> | undefined {
  const [state, setState] = useState<Loadable<Extract<FolderSearchResponse, { ok: true }>>>({ status: 'loading' });
  useEffect(() => {
    if (query === undefined) {
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    const timer = setTimeout(() => {
      void loadFolderSearch(query, controller.signal).then((answer) => {
        if (!controller.signal.aborted) {
          setState(toLoadable(answer));
        }
      });
    }, delayMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, delayMs]);
  return query === undefined ? undefined : state;
}
