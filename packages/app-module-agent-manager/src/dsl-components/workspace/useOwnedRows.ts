import { useCallback, useEffect, useMemo, useState } from 'react';
import { applyOwnedDto, rowFromOwned } from '../logic/owned.js';
import type { OwnedSessionDto, SessionRowDto } from '../shared.js';

/** How long a local change is trusted before the poll wins whatever it says (a failed poll must not freeze a stale state forever). */
export const OWNED_TTL_MS = 30_000;

/** What the user just did to an owned session, as the daemon answered it. */
export type OwnedChange = { kind: 'launched'; session: OwnedSessionDto } | { kind: 'updated'; session: OwnedSessionDto } | { kind: 'forgotten'; id: string };

interface Stamped {
  change: OwnedChange;
  at: number;
}

const idOf = (change: OwnedChange): string => (change.kind === 'forgotten' ? change.id : change.session.id).toLowerCase();

/** True when the polled rows already show what the change did (so the local copy can go). */
export function reflectedByPoll(polled: readonly SessionRowDto[], change: OwnedChange): boolean {
  const id = idOf(change);
  const row = polled.find((candidate) => candidate.sessionId.toLowerCase() === id);
  switch (change.kind) {
    case 'launched':
      return row !== undefined;
    case 'updated':
      return row !== undefined && row.ownedState === change.session.state;
    case 'forgotten':
      return row === undefined;
    default:
      throw new Error('reflectedByPoll: unknown change');
  }
}

export interface OwnedRows {
  rows: SessionRowDto[];
  /** Shows the daemon's answer at once: a launched session is listed before its registry file exists, a stopped or resumed one changes state. */
  apply: (change: OwnedChange) => void;
}

/**
 * The rows with the user's launch, stop, resume and forget applied at once, so the list answers in the same frame instead of up to 5 seconds later (the page
 * polls every 5 s). A change is dropped when the next poll shows it, or after OWNED_TTL_MS.
 */
export function useOwnedRows(rows: readonly SessionRowDto[]): OwnedRows {
  const [changes, setChanges] = useState<Record<string, Stamped>>({});
  const apply = useCallback((change: OwnedChange) => setChanges((current) => ({ ...current, [idOf(change)]: { change, at: Date.now() } })), []);

  useEffect(() => {
    setChanges((current) => {
      const now = Date.now();
      const kept = Object.entries(current).filter(([, stamped]) => !reflectedByPoll(rows, stamped.change) && now - stamped.at < OWNED_TTL_MS);
      return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept);
    });
  }, [rows]);

  const view = useMemo(() => {
    const stamped = Object.values(changes);
    if (stamped.length === 0) {
      return [...rows];
    }
    const forgotten = new Set(stamped.filter((entry) => entry.change.kind === 'forgotten').map((entry) => idOf(entry.change)));
    const updated = new Map(stamped.flatMap((entry) => (entry.change.kind === 'updated' ? [[idOf(entry.change), entry.change.session] as const] : [])));
    const present = new Set(rows.map((row) => row.sessionId.toLowerCase()));
    const polled = rows
      .filter((row) => !forgotten.has(row.sessionId.toLowerCase()))
      .map((row) => {
        const dto = updated.get(row.sessionId.toLowerCase());
        return dto === undefined ? row : applyOwnedDto(row, dto);
      });
    const launched = stamped.flatMap((entry) => (entry.change.kind === 'launched' && !present.has(idOf(entry.change)) ? [rowFromOwned(entry.change.session, entry.at)] : []));
    return [...launched, ...polled];
  }, [rows, changes]);

  return { rows: view, apply };
}
