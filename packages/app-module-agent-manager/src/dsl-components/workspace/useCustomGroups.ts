import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GroupsApi } from '../lists/common.js';
import { applyLayout, layoutOf, layoutsEqual, moveInLayout, type GroupLayout } from '../logic/customGroups.js';
import type { CustomGroupDto, SessionRowDto } from '../shared.js';

/** How long a local change is trusted before the server data wins whatever it says (same rule as the pins: a failed poll must not freeze a stale layout). */
export const LAYOUT_TTL_MS = 20_000;

/** Sends one write request: resolves with the parsed answer, or `ok: false` once the page has shown why (never throws). */
export type SendGroupRequest = (path: string, body: unknown, failure: string) => Promise<{ ok: true; value: unknown } | { ok: false }>;

export interface CustomGroups {
  /** The rows with the groups of the layout in force (the user's pending changes on top of the last server answer). */
  rows: SessionRowDto[];
  api: GroupsApi;
}

/** One change of the user that the server has not shown yet: a pure function of the layout, so the pending ones can be replayed on any server answer. */
interface PendingOp {
  id: number;
  at: number;
  apply: (layout: GroupLayout) => GroupLayout;
}

function groupOf(value: unknown): CustomGroupDto | undefined {
  const group = value !== null && typeof value === 'object' ? Reflect.get(value, 'group') : undefined;
  if (group === null || typeof group !== 'object') {
    return undefined;
  }
  const id: unknown = Reflect.get(group, 'id');
  const name: unknown = Reflect.get(group, 'name');
  return typeof id === 'string' && typeof name === 'string' ? (group as CustomGroupDto) : undefined;
}

function groupsOf(value: unknown): CustomGroupDto[] {
  const groups = value !== null && typeof value === 'object' ? Reflect.get(value, 'groups') : undefined;
  return Array.isArray(groups) ? groups.filter((group): group is CustomGroupDto => group !== null && typeof group === 'object' && typeof Reflect.get(group, 'id') === 'string' && typeof Reflect.get(group, 'name') === 'string') : [];
}

/**
 * The custom groups of the page: the server's groups and each row's group, with the user's own changes applied at once (a drop must not wait up to 5 s for
 * the next poll). Every change is a pending operation replayed on top of the last server answer. An operation is dropped when the server shows its effect,
 * after LAYOUT_TTL_MS, or when ITS request failed (the page says why): the other pending operations are not touched, so one refused drop never undoes another.
 */
export function useCustomGroups(rows: readonly SessionRowDto[], groups: readonly CustomGroupDto[], send: SendGroupRequest): CustomGroups {
  const server = useMemo(() => layoutOf(groups, rows), [groups, rows]);
  const [ops, setOps] = useState<readonly PendingOp[]>([]);
  const layout = useMemo(() => ops.reduce((current, op) => op.apply(current), server), [server, ops]);
  const latest = useRef(layout);
  latest.current = layout;
  const sendRef = useRef(send);
  sendRef.current = send;
  const counter = useRef(0);

  useEffect(() => {
    const now = Date.now();
    setOps((current) => {
      const kept = current.filter((op) => now - op.at < LAYOUT_TTL_MS && !layoutsEqual(op.apply(server), server));
      return kept.length === current.length ? current : kept;
    });
  }, [server]);

  const push = useCallback((apply: PendingOp['apply']): number => {
    counter.current += 1;
    const op: PendingOp = { id: counter.current, at: Date.now(), apply };
    // The layout in force moves on at once, so a second action started before the next render builds on the first.
    latest.current = apply(latest.current);
    setOps((current) => [...current, op]);
    return op.id;
  }, []);
  /** Sends the request of an operation; the operation is undone alone when it fails. */
  const settle = useCallback((id: number, path: string, body: unknown, failure: string): void => {
    void sendRef.current(path, body, failure).then((result) => {
      if (!result.ok) {
        setOps((current) => current.filter((op) => op.id !== id));
      }
    });
  }, []);

  const api = useMemo<GroupsApi>(
    () => ({
      groups: layout.groups,
      move: (sessionId, groupId, beforeId = null) => {
        if (moveInLayout(latest.current, sessionId, groupId, beforeId) === undefined) {
          return;
        }
        const id = push((current) => moveInLayout(current, sessionId, groupId, beforeId) ?? current);
        settle(id, `/sessions/${sessionId.toLowerCase()}/group`, groupId === null ? { groupId: null } : { groupId, beforeSessionId: beforeId }, 'Could not move the agent');
      },
      create: async (name, color = null) => {
        const result = await sendRef.current('/groups', color === null ? { name } : { name, color }, 'Could not create the group');
        const created = result.ok ? groupOf(result.value) : undefined;
        if (created !== undefined) {
          push((current) => (current.groups.some((group) => group.id === created.id) ? current : { groups: [...current.groups, created], members: { ...current.members, [created.id]: [] } }));
        }
        return created;
      },
      seedHerdr: async () => {
        const result = await sendRef.current('/groups/preset', { preset: 'herdr' }, 'Could not create the Herdr groups');
        const created = result.ok ? groupsOf(result.value) : [];
        if (created.length === 0) {
          return false;
        }
        push((current) => (current.groups.length > 0 ? current : { groups: created, members: Object.fromEntries(created.map((group) => [group.id, [] as string[]])) }));
        return true;
      },
      update: (id, patch) => {
        const op = push((current) => ({ ...current, groups: current.groups.map((group) => (group.id === id ? { ...group, ...patch } : group)) }));
        settle(op, `/groups/${id}`, patch, 'Could not change the group');
      },
      remove: (id) => {
        const op = push((current) => {
          const members = { ...current.members };
          delete members[id];
          return { groups: current.groups.filter((group) => group.id !== id), members };
        });
        settle(op, `/groups/${id}/delete`, undefined, 'Could not delete the group');
      },
      reorder: (ids) => {
        const known = new Set(latest.current.groups.map((group) => group.id));
        if (ids.length !== known.size || !ids.every((id) => known.has(id))) {
          return;
        }
        const op = push((current) => {
          const byId = new Map(current.groups.map((group) => [group.id, group] as const));
          const ordered = ids.flatMap((id, order) => {
            const group = byId.get(id);
            return group === undefined ? [] : [{ ...group, order }];
          });
          return ordered.length === current.groups.length ? { ...current, groups: ordered } : current;
        });
        settle(op, '/groups/order', { ids }, 'Could not reorder the groups');
      },
    }),
    [layout.groups, push, settle],
  );

  const view = useMemo(() => (ops.length === 0 ? [...rows] : applyLayout(rows, layout)), [rows, ops, layout]);
  return { rows: view, api };
}
