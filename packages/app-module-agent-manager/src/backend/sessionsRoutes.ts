import { readSessionRegistry, resolveSessionsDir, sortByStatusUpdatedDesc } from '@wadeck-app/agent-manager-core';
import { sessionCards } from './cards.js';
import { emptyText, hiddenDeadText, presentSession, summarize, unreadableText } from './present.js';
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
      return ok({ ok: false, show, dir, generatedAt, sessions: [], cards: [], unreadable: [], error: registry.error, errorText, summary: null });
    }
    const all = sortByStatusUpdatedDesc(registry.sessions);
    const shown = (show === 'all' ? all : all.filter((session) => session.alive)).map(presentSession);
    const hiddenDead = all.length - shown.length;
    return ok({
      ok: true,
      show,
      dir,
      generatedAt,
      sessions: shown,
      cards: sessionCards(shown),
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

export function registerSessionsRoutes(kit: RouteKit): void {
  registerSessions(kit);
  registerSummary(kit);
}
