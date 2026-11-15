import { readSessionRegistry, resolveSessionsDir, type Session } from '@wadeck-app/agent-manager-core';
import { SESSION_ID_PATTERN } from './userState.js';
import { RequestError } from './routeKit.js';

/**
 * The registry session of a route parameter. An id that is not a session id (unsafe: it becomes part of file names) and an id that is not in the
 * registry are both a 404 with a hint; a registry that cannot be read is a 409-like error the caller shows (`registryError`).
 */
export async function findSession(rawId: string | undefined): Promise<{ session: Session } | { registryError: { message: string; hint: string } }> {
  if (rawId === undefined || !SESSION_ID_PATTERN.test(rawId)) {
    throw new RequestError(404, `'${String(rawId).slice(0, 80)}' is not a session id of the registry`, 'Use the sessionId of GET /sessions (8-4-4-4-12 hexadecimal characters).');
  }
  const dir = resolveSessionsDir(process.env);
  const registry = await readSessionRegistry(dir);
  if (!registry.ok) {
    return { registryError: registry.error };
  }
  const wanted = rawId.toLowerCase();
  const session = registry.sessions.find((candidate) => candidate.sessionId.toLowerCase() === wanted);
  if (session === undefined) {
    throw new RequestError(404, `No session ${wanted} in the registry ${dir}`, 'The session may have been removed since the list was loaded: wait for the next refresh of the list.');
  }
  return { session };
}
