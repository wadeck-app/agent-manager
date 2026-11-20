import { readSessionRegistry, resolveSessionsDir, type Session } from '@wadeck-app/agent-manager-core';
import { sessionFromOwned } from './daemon/ownedJoin.js';
import { errorTextOf, type OwnedSource } from './daemon/ownedSource.js';
import { SESSION_ID_PATTERN } from './userState.js';
import { RequestError } from './routeKit.js';

/** The sentence that says why the daemon could not tell whether a session is owned (for the 404 of an unknown id), with its fix. */
export function daemonNote(error: { message: string; hint: string }): string {
  return ` If it was launched by agent-manager: ${errorTextOf(error)}`;
}

/**
 * The session of a route parameter: the registry session, else (an owned session that has no registry file yet: a stream-json child writes it with its first
 * message) the one made from the daemon's record. An id that is not a session id (unsafe: it becomes part of file names) and an id that is in neither are both a
 * 404 with a hint (naming the daemon when it could not be asked); a registry that cannot be read is a 409-like error the caller shows (`registryError`).
 */
export async function findSession(rawId: string | undefined, owned?: OwnedSource): Promise<{ session: Session } | { registryError: { message: string; hint: string } }> {
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
  if (session !== undefined) {
    return { session };
  }
  let note = '';
  if (owned !== undefined) {
    const found = await owned.find(wanted);
    if (found.ok && found.view !== undefined) {
      return { session: sessionFromOwned(found.view, Date.now()) };
    }
    // The session may be one the daemon owns: say why that could not be checked (and the fix), never leave a bare 404.
    if (!found.ok) {
      note = daemonNote(found.error);
    }
  }
  throw new RequestError(404, `No session ${wanted} in the registry ${dir}`, `The session may have been removed since the list was loaded: wait for the next refresh of the list.${note}`);
}
