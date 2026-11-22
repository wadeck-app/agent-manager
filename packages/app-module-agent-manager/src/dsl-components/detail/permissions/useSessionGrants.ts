import { useCallback, useEffect, useMemo, useState } from 'react';
import { permissionsOf, requestJson, type AgentRow, type GuardrailsOverviewDto, type Outcome, type PermissionsView, type SessionGrantsDto } from '../deps.js';

/** The guardrails files change when the user answers a bypass dialog: a slow refresh keeps the badge honest without hammering the folder scan. */
export const GRANTS_REFRESH_MS = 30_000;

/** What GET /guardrails/sessions/:sessionId/grants (the plugin's admin CLI) said, kept apart from the files because it does not fail the same way. */
export type CliGrantsState =
  | { kind: 'loading' }
  | { kind: 'ok'; data: SessionGrantsDto }
  /** The admin CLI is not installed (code not-installed): the panel reads the files and says so. `text` is the message with its fix. */
  | { kind: 'missing'; text: string }
  /** Any other failure: shown as an error, never as an empty list and never replaced by the files. */
  | { kind: 'error'; text: string; cwd: string; cwdNote: string };

function cliStateOf(result: Outcome<SessionGrantsDto>): CliGrantsState {
  if (!result.ok) {
    return { kind: 'error', text: result.text, cwd: '', cwdNote: '' };
  }
  const body = result.value;
  if (typeof body.ok !== 'boolean' || !Array.isArray(body.grants)) {
    return { kind: 'error', text: 'The answer of GET /guardrails/sessions/:sessionId/grants has no ok flag and grants list. Reload the page; if it persists, update agent-manager and restart app-core.', cwd: '', cwdNote: '' };
  }
  if (body.ok) {
    return { kind: 'ok', data: body };
  }
  return body.code === 'not-installed' ? { kind: 'missing', text: body.errorText } : { kind: 'error', text: body.errorText, cwd: body.cwd, cwdNote: body.cwdNote };
}

export interface SessionGrantsFeed {
  /** The bypasses of THIS session from the plugin's admin CLI (the only source that can revoke). */
  cli: CliGrantsState;
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
  const [cli, setCli] = useState<{ sessionId: string; state: CliGrantsState }>({ sessionId: session.sessionId, state: { kind: 'loading' } });
  const [tick, setTick] = useState(0);
  const { sessionId, cwd } = session;
  useEffect(() => {
    const controller = new AbortController();
    void requestJson<SessionGrantsDto>(`/guardrails/sessions/${encodeURIComponent(sessionId)}/grants`, { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) {
        setCli({ sessionId, state: cliStateOf(result) });
      }
    });
    return () => controller.abort();
  }, [sessionId, tick]);
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
  // The answer of another session (the user selected a new one) is not this session's: loading until its own arrives.
  return { ...state, cli: cli.sessionId === sessionId ? cli.state : { kind: 'loading' }, view, reload };
}
