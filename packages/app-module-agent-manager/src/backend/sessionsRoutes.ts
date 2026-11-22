import { getErrorMessage, readSessionRegistry, resolveSessionsDir, sortByStatusUpdatedDesc } from '@wadeck-app/agent-manager-core';
import type { CsrfOk, SessionRowDto } from '../commons/api.js';
import { CSRF_HEADER, CSRF_PATH } from '../commons/csrf.js';
import { stateOf } from './agentState.js';
import { adoptReadinessOf } from './adoptReadiness.js';
import { digestOf, pruneDigestCache } from './transcriptDigest.js';
import { statusOf } from './sessionStatus.js';
import { emptyUserState, guarded, parsePinBody, parseSessionId, readUserState, requireNoBody, updateUserState, UserStateError, type UserGroup, type UserState } from './userState.js';
import { groupDto, registerGroupsRoutes, registerMarksRoutes } from './groupsRoutes.js';
import { GROUP_ABSENT_PRUNE_MS } from '../commons/groups.js';
import { emptyText, hiddenDeadText, latestVersion, presentSession, summarize, unreadableText, type SessionRow } from './present.js';
import { guardrailBlocksFor, registerGuardrailsRoutes } from './guardrailsRoutes.js';
import { registerLogRoute } from './logRoute.js';
import { registerReplyRoutes, type ModuleOptions } from './replyRoutes.js';
import { createDaemonApi } from './daemon/daemonApi.js';
import { DISCOVERED, joinOwned } from './daemon/ownedJoin.js';
import { ownedDownOf } from './daemon/ownedDown.js';
import { createOwnedSource, errorTextOf, type OwnedSource } from './daemon/ownedSource.js';
import { registerOwnedRoutes } from './ownedRoutes.js';
import { registerHcPermissionRoutes } from './hcPermissionRoutes.js';
import { registerFoldersRoutes } from './foldersRoutes.js';
import { daemonNote } from './sessionLookup.js';
import { RequestError, type RouteKit, ok, queryValue } from './routeKit.js';

const SHOW_VALUES = ['alive', 'all'] as const;
type Show = (typeof SHOW_VALUES)[number];

function showOf(query: Parameters<typeof queryValue>[0]): Show {
  const value = queryValue(query, 'show');
  if (value === undefined) {
    return 'alive';
  }
  if (!(SHOW_VALUES as readonly string[]).includes(value)) {
    throw new RequestError(400, `'show' must be one of ${SHOW_VALUES.join(', ')}, got '${value}'`, "Use ?show=alive (default) or ?show=all to include the dead sessions.");
  }
  return value as Show;
}

/** The groups after the hourly pass: members present are stamped, members absent keep their clock (started now when they have none) and go after GROUP_ABSENT_PRUNE_MS. The same array when nothing changed. */
export function groupsAfterPass(groups: readonly UserGroup[], present: ReadonlySet<string>, now: number): UserGroup[] {
  let changed = false;
  const next = groups.map((group) => {
    const seenAt: Record<string, number> = {};
    const members: string[] = [];
    for (const id of group.members) {
      const before = group.seenAt[id];
      const stamp = present.has(id) ? now : (before ?? now);
      if (!present.has(id) && now - stamp > GROUP_ABSENT_PRUNE_MS) {
        continue;
      }
      members.push(id);
      seenAt[id] = stamp;
      changed ||= before !== stamp;
    }
    changed ||= members.length !== group.members.length;
    return members.length === group.members.length && group.members.every((id) => seenAt[id] === group.seenAt[id]) ? group : { ...group, members, seenAt };
  });
  return changed ? next : (groups as UserGroup[]);
}

/** The marks after the hourly pass: the mark of a session absent from the registry is dropped once it is older than GROUP_ABSENT_PRUNE_MS. The same object when nothing changed. */
export function marksAfterPass(marks: UserState['marks'], present: ReadonlySet<string>, now: number): UserState['marks'] {
  const kept = Object.entries(marks).filter(([id, mark]) => present.has(id) || now - mark.at <= GROUP_ABSENT_PRUNE_MS);
  return kept.length === Object.keys(marks).length ? marks : Object.fromEntries(kept);
}

/** Entries of the seen map whose session left the registry are dropped at most this often. */
const PRUNE_EVERY_MS = 60 * 60 * 1000;

/**
 * GET /sessions[?show=alive|all]: the sessions of the Claude Code registry, most recent status change first, dead ones hidden unless show=all.
 * Always 200 when the route itself worked: a registry that cannot be read is `ok: false` with `error` and `errorText` (never an empty list that
 * looks like "no sessions"); the files that could not be read are in `unreadable`.
 */
function registerSessions(kit: RouteKit, source: OwnedSource): void {
  let lastPruneAt = 0;
  kit.route('GET', '/sessions', async (req) => {
    const show = showOf(req.query);
    const now = Date.now();
    const generatedAt = new Date(now).toISOString();
    const dir = resolveSessionsDir(process.env);
    const registry = await readSessionRegistry(dir, { now });
    if (!registry.ok) {
      const { message, hint } = registry.error;
      const errorText = `${message}. ${hint}`;
      return ok({ ok: false, show, dir, generatedAt, sessions: [], customGroups: [], userStateError: '', unreadable: [], error: registry.error, errorText, summary: null });
    }
    // The registry rows joined with the owned records by session id (one daemon call, cached): a daemon that cannot be asked is data (`ownedError`), the rows stay.
    const joined = await joinOwned(registry.sessions, source, now);
    // Owned sessions whose daemon is down turned into plain rows: a persistent banner says why (only when owned-sessions.json lists some).
    const ownedDown = await ownedDownOf(joined.ownedError);
    const all = sortByStatusUpdatedDesc(joined.sessions);
    pruneDigestCache(new Set(all.map((session) => session.sessionId)), now);
    const latest = latestVersion(all);
    // An interrupted owned session stays listed when dead: a resume brings it back.
    const shown = (show === 'all' ? all : all.filter((session) => session.alive || joined.keep.has(session.sessionId.toLowerCase()))).map((session) => presentSession(session, latest));
    const hiddenDead = all.length - shown.length;
    // The pins and seen markers: unreadable ones are reported as data (userStateError), the sessions stay listed.
    let user: UserState = emptyUserState();
    let userStateError = '';
    try {
      user = await readUserState(kit.dataDir);
      // Baseline: a session first seen now starts as seen, one write for all the new ids of this poll; the prune rides on it, once an hour.
      const ids = new Set(all.map((session) => session.sessionId.toLowerCase()));
      const missing = [...ids].filter((id) => user.seen[id] === undefined);
      const pruneDue = now - lastPruneAt >= PRUNE_EVERY_MS;
      const stale = pruneDue ? Object.keys(user.seen).filter((id) => !ids.has(id)) : [];
      // The members of the groups: user-curated, so never dropped for one missing read (Claude Code restarting, a file being rewritten). Each member carries the
      // last time its session was in the registry; the hourly pass refreshes it, and drops only the members absent for more than 14 days.
      const groupsNext = pruneDue ? groupsAfterPass(user.groups, ids, now) : user.groups;
      const marksNext = pruneDue ? marksAfterPass(user.marks, ids, now) : user.marks;
      if (missing.length > 0 || stale.length > 0 || groupsNext !== user.groups || marksNext !== user.marks) {
        try {
          user = await updateUserState(kit.dataDir, (current) => {
            const seen = Object.fromEntries(Object.entries(current.seen).filter(([id]) => !stale.includes(id)));
            let changed = Object.keys(seen).length !== Object.keys(current.seen).length;
            // Computed again on the state read inside the update (a route may have written since the first read).
            const groups = pruneDue ? groupsAfterPass(current.groups, ids, now) : current.groups;
            changed ||= groups !== current.groups;
            const marks = pruneDue ? marksAfterPass(current.marks, ids, now) : current.marks;
            changed ||= marks !== current.marks;
            for (const id of missing) {
              if (seen[id] === undefined) {
                seen[id] = now;
                changed = true;
              }
            }
            return changed ? { ...current, seen, groups, marks } : current;
          });
          if (pruneDue) {
            lastPruneAt = now;
          }
        } catch (error) {
          // The page still works with the state as read (the unrecorded sessions are Idle); the failure is shown, never ignored.
          userStateError = `The first-seen markers could not be saved: ${getErrorMessage(error)}${error instanceof UserStateError ? `. ${error.hint}` : ''}`;
        }
      }
    } catch (error) {
      // The sessions stay listed with no pins and no seen markers (nothing is written, so an unreadable file is never overwritten); the error is shown.
      user = emptyUserState();
      userStateError = error instanceof UserStateError ? `${getErrorMessage(error)}. ${error.hint}` : `The pins and seen markers failed: ${getErrorMessage(error)}`;
    }
    const pinned = new Set(user.pinned);
    const groupOf = new Map(user.groups.flatMap((group) => group.members.map((id, position) => [id, { id: group.id, position }] as const)));
    const digests = await Promise.all(shown.map((row) => digestOf(row, now)));
    // The status line data (model, context, tokens, duration, branch, role, bypasses): read from the transcript digest and the registry folder of each session.
    const statuses = await Promise.all(shown.map((row, index) => statusOf(row, digests[index]!.usage, digests[index]!.note, now)));
    // The chip "blocked by a guardrail": the counters of the plugin in each session folder (a file that cannot be read is `guardrailsErrorText`, never silence).
    const guardrails = await guardrailBlocksFor(shown, now);
    const rows = shown.map((row, index): SessionRow & SessionRowDto => {
      const digest = digests[index]!;
      const seenAt = user.seen[row.sessionId.toLowerCase()];
      return {
        ...row,
        ...statuses[index],
        state: stateOf(row, user.seen, now),
        pinned: pinned.has(row.sessionId.toLowerCase()),
        pinOrder: user.pinned.indexOf(row.sessionId.toLowerCase()),
        customGroupId: groupOf.get(row.sessionId.toLowerCase())?.id ?? null,
        customGroupOrder: groupOf.get(row.sessionId.toLowerCase())?.position ?? -1,
        flagged: user.marks[row.sessionId.toLowerCase()]?.flag ?? false,
        unread: user.marks[row.sessionId.toLowerCase()]?.unread ?? false,
        seen: seenAt === undefined || row.statusUpdatedAt === undefined || row.statusUpdatedAt <= seenAt,
        reason: row.waitingFor ?? '',
        lastActivity: digest.lastActivity,
        activityNote: digest.note,
        subagentCount: digest.subagentCount,
        adoptReadiness: adoptReadinessOf({ status: row.status, ...(row.waitingFor === undefined ? {} : { waitingFor: row.waitingFor }), ...(row.statusAgeMs === undefined ? {} : { statusAgeMs: row.statusAgeMs }), alive: row.alive, pendingPermissions: (joined.fields.get(row.sessionId.toLowerCase()) ?? DISCOVERED).pendingPermissions }, digest, now),
        ...(joined.fields.get(row.sessionId.toLowerCase()) ?? DISCOVERED),
        ...(guardrails.byId.has(row.sessionId.toLowerCase()) ? { guardrailBlocks: guardrails.byId.get(row.sessionId.toLowerCase()) } : {}),
      };
    });
    return ok({
      ok: true,
      show,
      dir,
      generatedAt,
      sessions: rows,
      customGroups: user.groups.map(groupDto),
      latestVersion: latest,
      userStateError,
      guardrailsErrorText: guardrails.errorText,
      ownedError: joined.ownedError,
      ownedErrorText: joined.ownedError === null ? '' : errorTextOf(joined.ownedError),
      ownedDown: ownedDown.ownedDown,
      ownedDownText: ownedDown.ownedDownText,
      ownedStateErrorText: ownedDown.ownedStateErrorText,
      unreadable: registry.unreadable,
      unreadableText: unreadableText(registry.unreadable),
      hiddenDead,
      hiddenText: hiddenDeadText(hiddenDead),
      emptyText: emptyText(shown.length, hiddenDead),
      summary: summarize(all),
    });
  });
}

/** GET /summary: what the dashboard widget shows, counts of the alive sessions by status group (`alive` is their total). */
function registerSummary(kit: RouteKit, source: OwnedSource): void {
  kit.route('GET', '/summary', async () => {
    const now = Date.now();
    const dir = resolveSessionsDir(process.env);
    const registry = await readSessionRegistry(dir, { now });
    const generatedAt = new Date(now).toISOString();
    if (!registry.ok) {
      const { message, hint } = registry.error;
      return ok({ ok: false, generatedAt, error: registry.error, errorText: `${message}. ${hint}` });
    }
    // Joined with the owned sessions like GET /sessions (one cached daemon call): a pending permission counts as waiting, a session with no registry file yet is counted.
    const joined = await joinOwned(registry.sessions, source, now);
    const counts = summarize(joined.sessions);
    return ok({ ok: true, generatedAt, ...counts, ownedError: joined.ownedError, ownedErrorText: joined.ownedError === null ? '' : errorTextOf(joined.ownedError), unreadable: registry.unreadable.length, unreadableText: unreadableText(registry.unreadable) });
  });
}

/**
 * GET /health: the update test of app-core-cli (contract: app-core module-authoring.md, "Update test of app-core-cli"). Read-only, no side effect:
 * the Claude Code registry folder can be read (the one source this module cannot work without) and the user state file is readable or absent.
 * Single unreadable registry files are reported in the detail but do not fail the check (the page lists them itself).
 */
function registerHealth(kit: RouteKit): void {
  kit.route('GET', '/health', async () => {
    const dir = resolveSessionsDir(process.env);
    const registry = await readSessionRegistry(dir, { now: Date.now() });
    const checks: { name: string; ok: boolean; detail?: string }[] = [];
    if (registry.ok) {
      const unreadable = registry.unreadable.length > 0 ? `; ${registry.unreadable.length} unreadable file(s)` : '';
      checks.push({ name: 'session-registry', ok: true, detail: `${dir}: ${registry.sessions.length} session(s)${unreadable}` });
    } else {
      const { message, hint } = registry.error;
      checks.push({ name: 'session-registry', ok: false, detail: `${message}. ${hint}` });
    }
    try {
      await readUserState(kit.dataDir);
      checks.push({ name: 'user-state', ok: true });
    } catch (error) {
      checks.push({ name: 'user-state', ok: false, detail: `${getErrorMessage(error)}${error instanceof UserStateError ? `. ${error.hint}` : ''}` });
    }
    return ok({ ok: checks.every((check) => check.ok), checks });
  });
}

/** GET /csrf: the token every write route requires in the header X-Agent-Manager-Csrf (contract: commons/csrf.ts). */
function registerCsrf(kit: RouteKit): void {
  kit.route('GET', CSRF_PATH, () => Promise.resolve(ok({ ok: true, header: CSRF_HEADER, token: kit.csrfToken() } satisfies CsrfOk)));
}

/**
 * POST /sessions/:sessionId/pin {"pinned": boolean}: pins or unpins a session (idempotent). Any well-formed session id is accepted, known or not:
 * a pin must be removable after the session ended.
 * POST /sessions/:sessionId/seen (no body): the user saw the finished work of the session; a Done session goes back to Idle until its status changes again.
 * The session must be in the registry (404 otherwise: nothing to mark).
 */
function registerUserState(kit: RouteKit, source: OwnedSource): void {
  kit.route('POST', '/sessions/:sessionId/pin', async (req) => {
    const sessionId = parseSessionId(req.params?.['sessionId']);
    const pinned = parsePinBody(req.body);
    const state = await guarded(() => updateUserState(kit.dataDir, (current) => ({ ...current, pinned: pinned ? [...new Set([...current.pinned, sessionId])] : current.pinned.filter((id) => id !== sessionId) })));
    return ok({ ok: true, sessionId, pinned, pinnedCount: state.pinned.length });
  });
  kit.route('POST', '/sessions/:sessionId/seen', async (req) => {
    const sessionId = parseSessionId(req.params?.['sessionId']);
    requireNoBody(req.body);
    const now = Date.now();
    const dir = resolveSessionsDir(process.env);
    const registry = await readSessionRegistry(dir, { now });
    if (!registry.ok) {
      const { message, hint } = registry.error;
      throw new RequestError(409, `The session registry cannot be read: ${message}`, hint);
    }
    // An owned session has no registry file until its first message: the daemon's record is enough to mark it seen.
    const owned = registry.sessions.some((session) => session.sessionId.toLowerCase() === sessionId) ? undefined : await source.find(sessionId);
    const ownedKnown = owned !== undefined && owned.ok && owned.view !== undefined;
    if (owned !== undefined && !ownedKnown) {
      throw new RequestError(404, `No session ${sessionId} in the registry ${dir}`, `It may have been removed since the page was loaded: wait for the next refresh (5 s).${owned !== undefined && !owned.ok ? daemonNote(owned.error) : ''}`);
    }
    await guarded(() =>
      updateUserState(kit.dataDir, (current) => ({ ...current, seen: { ...current.seen, [sessionId]: now } })),
    );
    return ok({ ok: true, sessionId, seenAt: new Date(now).toISOString() });
  });
}

export function registerSessionsRoutes(kit: RouteKit, options: ModuleOptions = {}): void {
  const source = createOwnedSource(options.daemon ?? createDaemonApi());
  registerCsrf(kit);
  registerUserState(kit, source);
  registerGroupsRoutes(kit);
  registerMarksRoutes(kit);
  registerSessions(kit, source);
  registerSummary(kit, source);
  registerHealth(kit);
  registerLogRoute(kit, source);
  registerReplyRoutes(kit, options, source);
  registerOwnedRoutes(kit, source);
  registerHcPermissionRoutes(kit, options, source);
  registerFoldersRoutes(kit, source);
  registerGuardrailsRoutes(kit, options.guardrails ?? {}, source);
}
