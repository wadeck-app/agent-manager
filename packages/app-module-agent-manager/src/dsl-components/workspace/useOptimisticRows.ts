import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SessionRowDto } from '../shared.js';

/** How long a local change is trusted before the server data wins whatever it says (a failed poll must not freeze a stale pin forever). */
export const PATCH_TTL_MS = 20_000;

export type RowPatch = { kind: 'pin'; pinned: boolean; pinOrder: number } | { kind: 'seen' };

interface Stamped {
  patch: RowPatch;
  at: number;
}

/** The row with the local change applied. A Done session marked seen is Idle (the server's rule). */
export function applyPatch(row: SessionRowDto, patch: RowPatch): SessionRowDto {
  if (patch.kind === 'pin') {
    return { ...row, pinned: patch.pinned, pinOrder: patch.pinned ? patch.pinOrder : -1 };
  }
  return row.state === 'done' ? { ...row, state: 'idle', seen: true } : { ...row, seen: true };
}

/** True when the server's row already shows what the patch did. */
export function reflected(row: SessionRowDto, patch: RowPatch): boolean {
  return patch.kind === 'pin' ? row.pinned === patch.pinned : row.state !== 'done';
}

export interface OptimisticRows {
  rows: SessionRowDto[];
  patch: (sessionId: string, change: RowPatch) => void;
  /** Drops the local change of a session (the request failed). */
  revert: (sessionId: string) => void;
  /** The pin order a session pinned now gets. */
  nextPinOrder: () => number;
}

/**
 * The rows of the page poll with the user's pin and seen clicks applied at once, so the list answers in the same frame instead of up to 5 seconds later.
 * A change is dropped when the next poll shows it, when the request failed (`revert`), or after PATCH_TTL_MS.
 */
export function useOptimisticRows(rows: readonly SessionRowDto[]): OptimisticRows {
  const [patches, setPatches] = useState<Record<string, Stamped>>({});

  const patch = useCallback((sessionId: string, change: RowPatch) => setPatches((current) => ({ ...current, [sessionId.toLowerCase()]: { patch: change, at: Date.now() } })), []);
  const revert = useCallback(
    (sessionId: string) =>
      setPatches((current) => {
        const rest = { ...current };
        delete rest[sessionId.toLowerCase()];
        return rest;
      }),
    [],
  );

  // Drop what the poll now shows, and what is too old.
  useEffect(() => {
    setPatches((current) => {
      const now = Date.now();
      const kept = Object.entries(current).filter(([id, stamped]) => {
        const row = rows.find((candidate) => candidate.sessionId.toLowerCase() === id);
        return row !== undefined && !reflected(row, stamped.patch) && now - stamped.at < PATCH_TTL_MS;
      });
      return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept);
    });
  }, [rows]);

  const view = useMemo(
    () =>
      Object.keys(patches).length === 0
        ? [...rows]
        : rows.map((row) => {
            const stamped = patches[row.sessionId.toLowerCase()];
            return stamped === undefined ? row : applyPatch(row, stamped.patch);
          }),
    [rows, patches],
  );
  const nextPinOrder = useCallback(() => Math.max(-1, ...view.map((row) => row.pinOrder)) + 1, [view]);
  return { rows: view, patch, revert, nextPinOrder };
}
