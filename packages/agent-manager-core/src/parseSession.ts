import { lastDirectory } from './folder.js';
import type { Session, StatusGroup } from './session.js';

type Fields = Record<string, unknown>;

/** A file that is not a valid session: the message is the `reason` shown to the user, so it names the field and the expectation. */
export class SessionFormatError extends Error {}

function describe(value: unknown): string {
  return value === undefined ? 'nothing' : JSON.stringify(value);
}

/** A JSON null is read as absent. */
function present(fields: Fields, key: string): unknown {
  const value = fields[key];
  return value === null ? undefined : value;
}

function requiredString(fields: Fields, key: string): string {
  const value = present(fields, key);
  if (typeof value !== 'string' || value === '') {
    throw new SessionFormatError(`field "${key}" must be a non-empty string, got ${describe(value)}`);
  }
  return value;
}

function optionalString(fields: Fields, key: string): string | undefined {
  const value = present(fields, key);
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new SessionFormatError(`field "${key}" must be a string, got ${describe(value)}`);
  }
  return value;
}

function optionalNumber(fields: Fields, key: string): number | undefined {
  const value = present(fields, key);
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SessionFormatError(`field "${key}" must be a number, got ${describe(value)}`);
  }
  return value;
}

function groupOf(status: string): StatusGroup {
  return status === 'busy' || status === 'idle' ? status : 'other';
}

/** What `parseSession` needs besides the file: the clock and the liveness probe (both replaced in tests). */
export interface ParseContext {
  now: number;
  isAlive: (pid: number) => boolean;
}

/** Builds a Session from the parsed content of `<file>`. Throws SessionFormatError (or whatever `isAlive` throws) with the reason. */
export function parseSession(file: string, content: unknown, context: ParseContext): Session {
  if (content === null || typeof content !== 'object' || Array.isArray(content)) {
    throw new SessionFormatError('the file does not hold a JSON object');
  }
  const fields = content as Fields;
  const pid = fields['pid'];
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    throw new SessionFormatError(`field "pid" must be a positive integer, got ${describe(pid)}`);
  }
  const sessionId = requiredString(fields, 'sessionId');
  const cwd = requiredString(fields, 'cwd');
  const status = requiredString(fields, 'status');
  const statusUpdatedAt = optionalNumber(fields, 'statusUpdatedAt');
  // Optional fields are added only when present: a missing one is `undefined` in the type, never a made-up default.
  const optional: Partial<Session> = {
    startedAt: optionalNumber(fields, 'startedAt'),
    procStart: optionalString(fields, 'procStart'),
    version: optionalString(fields, 'version'),
    peerProtocol: optionalNumber(fields, 'peerProtocol'),
    kind: optionalString(fields, 'kind'),
    entrypoint: optionalString(fields, 'entrypoint'),
    name: optionalString(fields, 'name'),
    nameSource: optionalString(fields, 'nameSource'),
    waitingFor: optionalString(fields, 'waitingFor'),
    updatedAt: optionalNumber(fields, 'updatedAt'),
    statusUpdatedAt,
    statusAgeMs: statusUpdatedAt === undefined ? undefined : Math.max(0, context.now - statusUpdatedAt),
    messagingSocketPath: optionalString(fields, 'messagingSocketPath'),
  };
  const session: Session = {
    file,
    pid,
    sessionId,
    cwd,
    folder: lastDirectory(cwd),
    status,
    statusGroup: groupOf(status),
    alive: context.isAlive(pid),
    livenessCheck: 'pid-only',
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) {
      (session as unknown as Fields)[key] = value;
    }
  }
  return session;
}
