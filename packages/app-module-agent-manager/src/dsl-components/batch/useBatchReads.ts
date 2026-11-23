import { useEffect, useState } from 'react';
import { requestJson } from '../data/http.js';
import type { AgentRow } from '../data/types.js';
import type { RuleCategoryDto, SessionGrantsDto, SessionRulesDto } from '../shared.js';
import { commonCategories, MAX_BATCH_GRANT_SESSIONS, type GrantEntry } from './batchBypass.js';

/** Reads in flight at once: each one starts the plugin's script on the server, so 20 at the same time would be a burst. */
const READ_CONCURRENCY = 2;

/** Runs `run` over `items`, at most READ_CONCURRENCY at a time, stopping early when `signal` aborts. `run` must not throw. */
async function eachLimited<T>(items: readonly T[], signal: AbortSignal, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length && !signal.aborted) {
      const item = items[next] as T;
      next += 1;
      await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, items.length) }, worker));
}

const folderKey = (row: AgentRow): string => row.cwd.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();

/** A read that failed, with the sessions it concerns and the server's words (message and fix). */
export interface ReadProblem {
  names: string[];
  text: string;
}

export interface BatchRules {
  loading: boolean;
  /** The categories that a bypass can lift in every folder that could be read. */
  categories: RuleCategoryDto[];
  /** The folders whose rules could not be read: their sessions are not part of `categories`, and the server refuses them one by one if the batch includes them. */
  problems: ReadProblem[];
}

/**
 * The rules of the plugin for the folders of the selected sessions: ONE read per distinct folder (the first session of it), at most 2 at a time. The category
 * list is the intersection of what a bypass can lift in each readable folder, so that the batch offers only what every session can get; a folder that cannot
 * be read is reported with its sessions (never dropped silently). The server checks each session against its OWN folder again when it grants.
 */
export function useBatchRules(rows: readonly AgentRow[]): BatchRules {
  const key = rows.map((row) => row.sessionId).join(',');
  const [state, setState] = useState<BatchRules>({ loading: true, categories: [], problems: [] });
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true, categories: [], problems: [] });
    const folders = new Map<string, AgentRow[]>();
    for (const row of rows.slice(0, MAX_BATCH_GRANT_SESSIONS)) {
      folders.set(folderKey(row), [...(folders.get(folderKey(row)) ?? []), row]);
    }
    const lists: RuleCategoryDto[][] = [];
    const problems: ReadProblem[] = [];
    void eachLimited([...folders.values()], controller.signal, async (group) => {
      const [first] = group;
      if (first === undefined) {
        return;
      }
      const result = await requestJson<SessionRulesDto>(`/guardrails/sessions/${encodeURIComponent(first.sessionId)}/rules`, { signal: controller.signal });
      if (controller.signal.aborted) {
        return;
      }
      const names = group.map((row) => row.displayName);
      if (!result.ok) {
        problems.push({ names, text: result.text });
      } else if (typeof result.value.ok !== 'boolean' || !Array.isArray(result.value.categories)) {
        problems.push({ names, text: 'The answer of the rules route has no ok flag and categories list. Reload the page; if it persists, update agent-manager and restart app-core.' });
      } else if (!result.value.ok) {
        problems.push({ names, text: result.value.errorText });
      } else {
        lists.push(result.value.categories);
      }
    }).then(() => {
      if (!controller.signal.aborted) {
        setState({ loading: false, categories: commonCategories(lists), problems });
      }
    });
    return () => controller.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export interface BatchGrants {
  loading: boolean;
  done: number;
  total: number;
  entries: GrantEntry[];
  /** Sessions that were read and have no active bypass. */
  empty: string[];
  /** Sessions whose list could not be read: said, never shown as "no bypass". */
  problems: ReadProblem[];
}

/** The active bypasses of every selected session: one read per session (GET .../grants), at most 2 at a time, with the progress. */
export function useBatchGrants(rows: readonly AgentRow[]): BatchGrants {
  const key = rows.map((row) => row.sessionId).join(',');
  const [state, setState] = useState<BatchGrants>({ loading: true, done: 0, total: rows.length, entries: [], empty: [], problems: [] });
  useEffect(() => {
    const controller = new AbortController();
    const wanted = rows.slice(0, MAX_BATCH_GRANT_SESSIONS);
    setState({ loading: true, done: 0, total: wanted.length, entries: [], empty: [], problems: [] });
    const found = new Map<string, GrantEntry[]>();
    const empty: string[] = [];
    const problems: ReadProblem[] = [];
    let done = 0;
    void eachLimited(wanted, controller.signal, async (row) => {
      const result = await requestJson<SessionGrantsDto>(`/guardrails/sessions/${encodeURIComponent(row.sessionId)}/grants`, { signal: controller.signal });
      if (controller.signal.aborted) {
        return;
      }
      if (!result.ok) {
        problems.push({ names: [row.displayName], text: result.text });
      } else if (typeof result.value.ok !== 'boolean' || !Array.isArray(result.value.grants)) {
        problems.push({ names: [row.displayName], text: 'The answer of the grants route has no ok flag and grants list. Reload the page; if it persists, update agent-manager and restart app-core.' });
      } else if (!result.value.ok) {
        problems.push({ names: [row.displayName], text: result.value.errorText });
      } else if (result.value.grants.length === 0) {
        empty.push(row.displayName);
      } else {
        found.set(row.sessionId, result.value.grants.map((grant) => ({ sessionId: row.sessionId, name: row.displayName, grant })));
      }
      done += 1;
      setState((previous) => ({ ...previous, done }));
    }).then(() => {
      if (!controller.signal.aborted) {
        // In the order of the selection, whatever order the answers came in.
        const entries = wanted.flatMap((row) => found.get(row.sessionId) ?? []);
        setState({ loading: false, done: wanted.length, total: wanted.length, entries, empty, problems });
      }
    });
    return () => controller.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
