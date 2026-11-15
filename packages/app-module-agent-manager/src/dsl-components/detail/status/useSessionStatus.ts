import { useSyncExternalStore } from 'react';
import type { AgentRow, SessionStatusDto } from '../deps.js';

/**
 * ONE source of truth for the status line data of the open session. The log poll (GET /log `status`, every 2 s) is the live one: LogViewerBody publishes
 * each answer here; the header reads it. Until the first log answer (or when it has none) the fields of the session row (GET /sessions, every 5 s) are used.
 * A whole object replaces the other, never a field-by-field mix of the two sources.
 */
const published = new Map<string, SessionStatusDto | undefined>();
const listeners = new Set<() => void>();

function key(sessionId: string): string {
  return sessionId.toLowerCase();
}

/** Called by the log viewer with the `status` of its newest answer (undefined when it unmounts or the answer has none). */
export function publishLogStatus(sessionId: string, status: SessionStatusDto | undefined): void {
  if (published.get(key(sessionId)) === status) {
    return;
  }
  published.set(key(sessionId), status);
  listeners.forEach((listener) => listener());
}

/** The status fields of a session row (the same keys as SessionStatusDto), for the time before the log answers. */
export function rowStatus(row: AgentRow): SessionStatusDto {
  const { model, previousModels, contextUsedPct, tokensIn, tokensOut, durationMs, gitBranch, gitBranchError, role, bypasses, bypassError, statusNote } = row;
  return {
    ...(model === undefined ? {} : { model }),
    ...(previousModels === undefined ? {} : { previousModels }),
    ...(contextUsedPct === undefined ? {} : { contextUsedPct }),
    ...(tokensIn === undefined ? {} : { tokensIn }),
    ...(tokensOut === undefined ? {} : { tokensOut }),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(gitBranch === undefined ? {} : { gitBranch }),
    ...(gitBranchError === undefined ? {} : { gitBranchError }),
    ...(role === undefined ? {} : { role }),
    ...(bypasses === undefined ? {} : { bypasses }),
    ...(bypassError === undefined ? {} : { bypassError }),
    ...(statusNote === undefined ? {} : { statusNote }),
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The status shown in the header of a session: the live one of the log when there is one, else the one of the row. */
export function useSessionStatus(row: AgentRow): SessionStatusDto {
  const live = useSyncExternalStore(
    subscribe,
    () => published.get(key(row.sessionId)),
    () => undefined,
  );
  return live ?? rowStatus(row);
}

/** Forgets everything published (tests). */
export function resetPublishedStatus(): void {
  published.clear();
  listeners.forEach((listener) => listener());
}
