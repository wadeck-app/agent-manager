import { getErrorMessage, readSessionRegistry, resolveSessionsDir, sortByStatusUpdatedDesc } from '@wadeck-app/agent-manager-core';
import { buildGroups } from './agentState.js';
import { sessionCards } from './cards.js';
import { herdrGroups } from './herdr.js';
import { parsePinBody, parseSessionId, readUserState, requireNoBody, updateUserState, UserStateError } from './userState.js';
import { sessionColumns } from './columns.js';
import { emptyText, hiddenDeadText, latestVersion, presentSession, summarize, unreadableText } from './present.js';
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

/**
 * GET /sessions[?show=alive|all]: the sessions of the Claude Code registry, most recent status change first, dead ones hidden unless show=all.
 * Always 200 when the route itself worked: a registry that cannot be read is `ok: false` with `error` and `errorText` (never an empty list that
 * looks like "no sessions"); the files that could not be read are in `unreadable`.
 */
function registerSessions(kit: RouteKit): void {
  kit.route('GET', '/sessions', async (req) => {
    const show = showOf(req.query);
    const now = Date.now();
    const generatedAt = new Date(now).toISOString();
    const dir = resolveSessionsDir(process.env);
    const registry = await readSessionRegistry(dir, { now });
    if (!registry.ok) {
      const { message, hint } = registry.error;
      const errorText = `${message}. ${hint}`;
      return ok({ ok: false, show, dir, generatedAt, sessions: [], cards: [], herdr: [], herdrError: '', unreadable: [], error: registry.error, errorText, summary: null });
    }
    const all = sortByStatusUpdatedDesc(registry.sessions);
    const latest = latestVersion(all);
    const shown = (show === 'all' ? all : all.filter((session) => session.alive)).map((session) => presentSession(session, latest));
    const hiddenDead = all.length - shown.length;
    // The pins and seen markers: unreadable ones are reported as data (herdrError), the other layouts keep working.
    let herdr: ReturnType<typeof herdrGroups> = [];
    let herdrError = '';
    try {
      const user = await readUserState(kit.dataDir);
      herdr = herdrGroups(buildGroups(shown, user, now), shown, now);
    } catch (error) {
      herdrError = error instanceof UserStateError ? `${getErrorMessage(error)}. ${error.hint}` : `The herdr layout failed: ${getErrorMessage(error)}`;
    }
    return ok({
      ok: true,
      show,
      dir,
      generatedAt,
      sessions: shown,
      latestVersion: latest,
      tableColumns: sessionColumns(shown),
      cards: sessionCards(shown),
      herdr,
      herdrError,
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
function registerSummary(kit: RouteKit): void {
  kit.route('GET', '/summary', async () => {
    const now = Date.now();
    const dir = resolveSessionsDir(process.env);
    const registry = await readSessionRegistry(dir, { now });
    const generatedAt = new Date(now).toISOString();
    if (!registry.ok) {
      const { message, hint } = registry.error;
      return ok({ ok: false, generatedAt, error: registry.error, errorText: `${message}. ${hint}` });
    }
    const counts = summarize(registry.sessions);
    return ok({ ok: true, generatedAt, ...counts, unreadable: registry.unreadable.length, unreadableText: unreadableText(registry.unreadable) });
  });
}

/** A user state that cannot be read or written is a server-side problem the user can fix: 500 with the file and what to do (never silently emptied). */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw error instanceof UserStateError ? new RequestError(500, getErrorMessage(error), error.hint) : error;
  }
}

/** Seen markers older than this are dropped when a marker is written: a session finished that long ago is Idle anyway (DONE_WINDOW_MS). */
const SEEN_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * POST /sessions/:sessionId/pin {"pinned": boolean}: pins or unpins a session (idempotent). Any well-formed session id is accepted, known or not:
 * a pin must be removable after the session ended.
 * POST /sessions/:sessionId/seen (no body): the user saw the finished work of the session; a Done session goes back to Idle until its status changes again.
 * The session must be in the registry (404 otherwise: nothing to mark).
 */
function registerUserState(kit: RouteKit): void {
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
    if (!registry.sessions.some((session) => session.sessionId.toLowerCase() === sessionId)) {
      throw new RequestError(404, `No session ${sessionId} in the registry ${dir}`, 'It may have been removed since the page was loaded: wait for the next refresh (5 s).');
    }
    await guarded(() =>
      updateUserState(kit.dataDir, (current) => {
        const seen = Object.fromEntries(Object.entries(current.seen).filter(([, at]) => now - at < SEEN_KEEP_MS));
        return { ...current, seen: { ...seen, [sessionId]: now } };
      }),
    );
    return ok({ ok: true, sessionId, seenAt: new Date(now).toISOString() });
  });
}

export function registerSessionsRoutes(kit: RouteKit): void {
  registerUserState(kit);
  registerSessions(kit);
  registerSummary(kit);
}
