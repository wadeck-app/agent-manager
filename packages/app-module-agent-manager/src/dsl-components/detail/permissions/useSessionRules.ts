import { useEffect, useState } from 'react';
import { requestJson, type SessionRulesDto } from '../deps.js';

/** What GET /guardrails/sessions/:sessionId/rules (the plugin's admin CLI) said. */
export type RulesState =
  | { kind: 'loading' }
  | { kind: 'ok'; data: SessionRulesDto }
  /** Any failure, never an empty list: `text` is the message with its fix. */
  | { kind: 'error'; text: string };

/**
 * The categories of the guardrails for the folder of the session, read when the session is selected and again when `tick` changes (the refresh button, a bypass
 * that was just added). Not on the 30 s timer: each read starts the plugin's script, and the rules change when a file is edited, not by the minute.
 */
export function useSessionRules(sessionId: string, tick: number): RulesState {
  const [state, setState] = useState<{ sessionId: string; value: RulesState }>({ sessionId, value: { kind: 'loading' } });
  useEffect(() => {
    const controller = new AbortController();
    void requestJson<SessionRulesDto>(`/guardrails/sessions/${encodeURIComponent(sessionId)}/rules`, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) {
        return;
      }
      if (!result.ok) {
        setState({ sessionId, value: { kind: 'error', text: result.text } });
      } else if (typeof result.value.ok !== 'boolean' || !Array.isArray(result.value.categories)) {
        setState({ sessionId, value: { kind: 'error', text: 'The answer of GET /guardrails/sessions/:sessionId/rules has no ok flag and categories list. Reload the page; if it persists, update agent-manager and restart app-core.' } });
      } else {
        setState({ sessionId, value: result.value.ok ? { kind: 'ok', data: result.value } : { kind: 'error', text: result.value.errorText } });
      }
    });
    return () => controller.abort();
  }, [sessionId, tick]);
  // The answer of another session (the user selected a new one) is not this session's.
  return state.sessionId === sessionId ? state.value : { kind: 'loading' };
}
