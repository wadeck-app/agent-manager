import { randomUUID } from 'node:crypto';
import { checkGroupName, GROUP_COLORS, isGroupColor, MAX_GROUPS, placeMember, type GroupColor } from '../commons/groups.js';
import type { CustomGroupDto } from '../commons/api.js';
import { RequestError, ok, type RouteKit } from './routeKit.js';
import { guarded, parseSessionId, SESSION_ID_PATTERN, updateUserState, type UserGroup, type UserState } from './userState.js';

/** What GET /sessions and the group routes send for a group (the members are the `customGroupId` of the rows). */
export function groupDto(group: UserGroup): CustomGroupDto {
  return { id: group.id, name: group.name, color: group.color, collapsed: group.collapsed, order: group.order };
}

function bodyObject(body: unknown, allowed: readonly string[], example: string): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestError(400, 'The body must be a JSON object', `Send ${example} with Content-Type: application/json.`);
  }
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    throw new RequestError(400, `Unknown field(s) in the body: ${extra.map((key) => `'${key.slice(0, 40)}'`).join(', ')}`, `The fields are: ${allowed.join(', ')}.`);
  }
  return Object.fromEntries(Object.entries(body));
}

function parseGroupId(value: unknown): string {
  if (typeof value !== 'string' || !SESSION_ID_PATTERN.test(value)) {
    throw new RequestError(400, `'${String(value).slice(0, 80)}' is not a group id`, 'Use the id of a group of GET /sessions (customGroups): a UUID.');
  }
  return value.toLowerCase();
}

function parseName(value: unknown): string {
  const checked = checkGroupName(value);
  if (!checked.ok) {
    throw new RequestError(400, checked.text, 'Send a name of 1 to 60 characters without control characters.');
  }
  return checked.name;
}

function parseColor(value: unknown): GroupColor | null {
  if (value === null) {
    return null;
  }
  if (!isGroupColor(value)) {
    throw new RequestError(400, `'color' must be one of ${GROUP_COLORS.join(', ')} or null, got ${JSON.stringify(value)}`, 'Send null to remove the color.');
  }
  return value;
}

function findGroup(state: UserState, id: string): UserGroup {
  const group = state.groups.find((candidate) => candidate.id === id);
  if (group === undefined) {
    throw new RequestError(404, `No group ${id}`, 'It may have been deleted since the page was loaded (from another tab): wait for the next refresh (5 s).');
  }
  return group;
}

/** The groups with `order` renumbered 0..n-1 in the array order (the file never holds gaps or duplicates). */
function renumbered(groups: readonly UserGroup[]): UserGroup[] {
  return groups.map((group, order) => (group.order === order ? group : { ...group, order }));
}

/**
 * The custom groups: user-defined groups of agents. The routes only organize the user's view (names and session ids in the module state file), so they are not
 * PIN-sensitive (routeClasses.ts); the CSRF guard still applies.
 *
 * - POST /groups {name, color?}: creates a group at the end.
 * - POST /groups/order {ids}: the new order; `ids` must be exactly the current groups (409 otherwise: another tab changed them).
 * - POST /groups/:id {name?, color?, collapsed?}: at least one field.
 * - POST /groups/:id/delete: its members become ungrouped.
 * - POST /sessions/:sessionId/group {groupId: id | null, beforeSessionId?: id | null}: moves a session into a group (at the end, or before a member), or out (null).
 */
export function registerGroupsRoutes(kit: RouteKit): void {
  kit.route('POST', '/groups', async (req) => {
    const fields = bodyObject(req.body, ['name', 'color'], '{"name": "Backend", "color": "blue"}');
    const name = parseName(fields['name']);
    const color = fields['color'] === undefined ? null : parseColor(fields['color']);
    let created: UserGroup | undefined;
    await guarded(() =>
      updateUserState(kit.dataDir, (current) => {
        if (current.groups.length >= MAX_GROUPS) {
          throw new RequestError(409, `Too many groups (limit ${MAX_GROUPS})`, 'Delete a group you no longer use.');
        }
        created = { id: randomUUID(), name, color, collapsed: false, order: current.groups.length, members: [], seenAt: {} };
        return { ...current, groups: [...current.groups, created] };
      }),
    );
    return ok({ ok: true, group: groupDto(created as UserGroup) });
  });

  // Registered before '/groups/:id' (a static segment first): 'order' is never a group id (those are UUIDs).
  kit.route('POST', '/groups/order', async (req) => {
    const fields = bodyObject(req.body, ['ids'], '{"ids": ["<group id>", "<group id>"]}');
    const ids: unknown = fields['ids'];
    if (!Array.isArray(ids)) {
      throw new RequestError(400, "'ids' must be an array of group ids", 'Send every group id once, in the new order.');
    }
    const wanted = ids.map(parseGroupId);
    await guarded(() =>
      updateUserState(kit.dataDir, (current) => {
        const known = current.groups.map((group) => group.id);
        if (wanted.length !== known.length || new Set(wanted).size !== wanted.length || !wanted.every((id) => known.includes(id))) {
          throw new RequestError(409, 'The ids are not exactly the current groups', 'Another tab created or deleted a group: wait for the next refresh (5 s), then reorder again.');
        }
        const next = renumbered(wanted.map((id) => findGroup(current, id)));
        return next.every((group, index) => group === current.groups[index]) ? current : { ...current, groups: next };
      }),
    );
    return ok({ ok: true, ids: wanted });
  });

  kit.route('POST', '/groups/:id', async (req) => {
    const id = parseGroupId(req.params?.['id']);
    const fields = bodyObject(req.body, ['name', 'color', 'collapsed'], '{"name": "New name"}, {"color": "teal"} or {"collapsed": true}');
    if (Object.keys(fields).length === 0) {
      throw new RequestError(400, 'The body has no field to change', 'Send name, color (or null) and/or collapsed.');
    }
    const name = fields['name'] === undefined ? undefined : parseName(fields['name']);
    const color = fields['color'] === undefined ? undefined : parseColor(fields['color']);
    const collapsed: unknown = fields['collapsed'];
    if (collapsed !== undefined && typeof collapsed !== 'boolean') {
      throw new RequestError(400, `'collapsed' must be true or false, got ${JSON.stringify(collapsed)}`);
    }
    let result: UserGroup | undefined;
    await guarded(() =>
      updateUserState(kit.dataDir, (current) => {
        const group = findGroup(current, id);
        const next: UserGroup = { ...group, ...(name === undefined ? {} : { name }), ...(color === undefined ? {} : { color }), ...(collapsed === undefined ? {} : { collapsed }) };
        result = next;
        return next.name === group.name && next.color === group.color && next.collapsed === group.collapsed ? current : { ...current, groups: current.groups.map((candidate) => (candidate.id === id ? next : candidate)) };
      }),
    );
    return ok({ ok: true, group: groupDto(result as UserGroup) });
  });

  kit.route('POST', '/groups/:id/delete', async (req) => {
    const id = parseGroupId(req.params?.['id']);
    let freed = 0;
    await guarded(() =>
      updateUserState(kit.dataDir, (current) => {
        const group = findGroup(current, id);
        freed = group.members.length;
        return { ...current, groups: renumbered(current.groups.filter((candidate) => candidate.id !== id)) };
      }),
    );
    return ok({ ok: true, id, ungrouped: freed });
  });

  kit.route('POST', '/sessions/:sessionId/group', async (req) => {
    const sessionId = parseSessionId(req.params?.['sessionId']);
    const fields = bodyObject(req.body, ['groupId', 'beforeSessionId'], '{"groupId": "<group id>", "beforeSessionId": "<session id>"} or {"groupId": null}');
    if (!('groupId' in fields)) {
      throw new RequestError(400, "'groupId' is missing", 'Send a group id to move the session into that group, or null to take it out of its group.');
    }
    const groupId = fields['groupId'] === null ? null : parseGroupId(fields['groupId']);
    const rawBefore: unknown = fields['beforeSessionId'];
    const before = rawBefore === undefined || rawBefore === null ? null : parseSessionId(typeof rawBefore === 'string' ? rawBefore : undefined);
    if (groupId === null && before !== null) {
      throw new RequestError(400, "'beforeSessionId' needs a 'groupId'", 'The ungrouped agents are ordered by the page (state, workspace): there is no position to give.');
    }
    if (before === sessionId) {
      throw new RequestError(400, "'beforeSessionId' is the session itself", 'Name the member the session must be placed before.');
    }
    await guarded(() =>
      updateUserState(kit.dataDir, (current) => {
        if (groupId !== null) {
          findGroup(current, groupId);
        }
        let changed = false;
        const groups = current.groups.map((group) => {
          if (group.id === groupId) {
            const members = placeMember(group.members, sessionId, before);
            if (members === undefined) {
              throw new RequestError(409, `The session ${before ?? ''} is not in the group ${group.name}`, 'The group changed since the page was loaded (another tab): wait for the next refresh (5 s), then move again.');
            }
            if (members.length !== group.members.length || members.some((member, index) => member !== group.members[index])) {
              changed = true;
              // The placement starts the absence clock of the member (see GROUP_ABSENT_PRUNE_MS).
              return { ...group, members, seenAt: { ...group.seenAt, [sessionId]: Date.now() } };
            }
            return group;
          }
          if (group.members.includes(sessionId)) {
            changed = true;
            const { [sessionId]: _left, ...seenAt } = group.seenAt;
            return { ...group, members: group.members.filter((member) => member !== sessionId), seenAt };
          }
          return group;
        });
        return changed ? { ...current, groups } : current;
      }),
    );
    return ok({ ok: true, sessionId, groupId, beforeSessionId: before });
  });
}
