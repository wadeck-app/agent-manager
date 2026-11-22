import { useCallback, useEffect, useMemo, useState } from 'react';
import { permissionsOf, requestJson, type AgentRow, type GuardrailsOverviewDto, type PermissionsView } from '../deps.js';

/** The guardrails files change when the user answers a bypass dialog: a slow refresh keeps the badge honest without hammering the folder scan. */
export const GRANTS_REFRESH_MS = 30_000;

export interface SessionGrantsFeed {
  /** The last good answer, kept while a refresh runs or fails. */
  overview: GuardrailsOverviewDto | undefined;
  view: PermissionsView | undefined;
  /** Why the last request failed ("message. hint"), empty when it worked. */
  error: string;
  loading: boolean;
  reload: () => void;
}

/** GET /guardrails/overview (read-only, no PIN) for the Permissions tab: on the session, then every 30 s and on `reload`. */
export function useSessionGrants(session: Pick<AgentRow, 'sessionId' | 'cwd'>): SessionGrantsFeed {
  const [state, setState] = useState<{ overview: GuardrailsOverviewDto | undefined; error: string; loading: boolean }>({ overview: undefined, error: '', loading: true });
  const [tick, setTick] = useState(0);
  const { sessionId, cwd } = session;
  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({ ...previous, loading: true }));
    void requestJson<GuardrailsOverviewDto>('/guardrails/overview', { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) {
        return;
      }
      if (result.ok && !(Array.isArray(result.value.grants) && Array.isArray(result.value.sessions))) {
        // An answer of another shape (an old module, a proxy page) is said, never read as "no bypass".
        setState((previous) => ({ overview: previous.overview, error: 'The answer of GET /guardrails/overview has no grants and sessions lists. Reload the page; if it persists, update agent-manager and restart app-core.', loading: false }));
        return;
      }
      setState((previous) => (result.ok ? { overview: result.value, error: '', loading: false } : { overview: previous.overview, error: result.text, loading: false }));
    });
    return () => controller.abort();
  }, [sessionId, tick]);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), GRANTS_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  const { overview } = state;
  const view = useMemo(() => (overview === undefined ? undefined : permissionsOf(overview, sessionId, cwd)), [overview, sessionId, cwd]);
  return { ...state, view, reload };
}
