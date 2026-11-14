import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getErrorMessage } from '@wadeck-app/agent-manager-core';
import { RequestError } from './routeKit.js';

/** Strict form of a Claude Code session id: the 8-4-4-4-12 hexadecimal groups, lower or upper case, nothing around it. */
export const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Upper bound of the pins (and of the seen markers): a file that grows without limit is a bug or an abuse, and says so. */
export const MAX_ENTRIES = 500;

const FILE_NAME = 'agents-user-state.json';

/** What the user decided on the Agents page: the pinned sessions, and for each session the moment (epoch ms) the user last saw it finished. */
export interface UserState {
  pinned: string[];
  seen: Record<string, number>;
}

export class UserStateError extends Error {
  constructor(
    message: string,
    readonly hint: string,
  ) {
    super(message);
    this.name = 'UserStateError';
  }
}

export function parseSessionId(value: string | undefined): string {
  if (value === undefined || !SESSION_ID_PATTERN.test(value)) {
    throw new RequestError(400, `'${String(value).slice(0, 80)}' is not a session id`, 'Use the sessionId of the registry: 8-4-4-4-12 hexadecimal characters, e.g. 123e4567-e89b-12d3-a456-426614174000.');
  }
  return value.toLowerCase();
}

/** The body of POST /sessions/:sessionId/pin: exactly `{ "pinned": true | false }`. */
export function parsePinBody(body: unknown): boolean {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestError(400, 'The body must be a JSON object', 'Send {"pinned": true} to pin the session or {"pinned": false} to unpin it, with Content-Type: application/json.');
  }
  const keys = Object.keys(body);
  const extra = keys.filter((key) => key !== 'pinned');
  if (extra.length > 0) {
    throw new RequestError(400, `Unknown field(s) in the body: ${extra.map((key) => `'${key.slice(0, 40)}'`).join(', ')}`, 'The only field is "pinned" (boolean).');
  }
  const pinned: unknown = Reflect.get(body, 'pinned');
  if (typeof pinned !== 'boolean') {
    throw new RequestError(400, `'pinned' must be true or false, got ${pinned === undefined ? 'nothing' : JSON.stringify(pinned)}`, 'Send {"pinned": true} to pin the session or {"pinned": false} to unpin it.');
  }
  return pinned;
}

/** POST .../seen takes no body: anything but an empty body or an empty object is a mistake worth reporting. */
export function requireNoBody(body: unknown): void {
  if (body === undefined || body === null) {
    return;
  }
  if (typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0) {
    return;
  }
  throw new RequestError(400, 'This route takes no body', 'Send the request without a body (or with {}).');
}

function parseState(text: string, file: string): UserState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new UserStateError(`${file} is not valid JSON (${getErrorMessage(error)})`, `Fix or delete ${file}: the pins and the seen markers are kept there. Nothing was overwritten.`);
  }
  const fail = (what: string): never => {
    throw new UserStateError(`${file} has an unexpected content: ${what}`, `Fix or delete ${file}: the pins and the seen markers are kept there. Nothing was overwritten.`);
  };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('the root must be an object');
  }
  const pinned: unknown = Reflect.get(raw, 'pinned');
  const seen: unknown = Reflect.get(raw, 'seen');
  if (!Array.isArray(pinned) || !pinned.every((id) => typeof id === 'string' && SESSION_ID_PATTERN.test(id))) {
    return fail('"pinned" must be an array of session ids');
  }
  if (seen === null || typeof seen !== 'object' || Array.isArray(seen)) {
    return fail('"seen" must be an object');
  }
  const seenMap: Record<string, number> = {};
  for (const [id, at] of Object.entries(seen)) {
    if (!SESSION_ID_PATTERN.test(id) || typeof at !== 'number' || !Number.isFinite(at)) {
      return fail('"seen" must map session ids to epoch milliseconds');
    }
    seenMap[id] = at;
  }
  return { pinned: [...new Set(pinned as string[])], seen: seenMap };
}

/**
 * Reads the user state in `dataDir`. A missing file is the empty state (nothing was ever pinned); an unreadable or malformed one is a
 * UserStateError, never an empty state: writing over it would destroy the user's pins.
 */
export async function readUserState(dataDir: string): Promise<UserState> {
  const file = join(dataDir, FILE_NAME);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { pinned: [], seen: {} };
    }
    throw new UserStateError(`${file} cannot be read (${getErrorMessage(error)})`, 'Check the permissions of the module data folder.');
  }
  return parseState(text, file);
}

export async function writeUserState(dataDir: string, state: UserState): Promise<void> {
  const file = join(dataDir, FILE_NAME);
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(temp, file);
  } catch (error) {
    throw new UserStateError(`${file} cannot be written (${getErrorMessage(error)})`, 'Check the permissions and the free space of the module data folder.');
  }
}

/** Serializes the read-modify-write cycles of this process: two quick clicks must not lose one another's change. */
let queue: Promise<unknown> = Promise.resolve();
export function updateUserState(dataDir: string, change: (state: UserState) => UserState): Promise<UserState> {
  const run = queue.then(async () => {
    const current = await readUserState(dataDir);
    const next = change(current);
    // The same object back means "nothing to change": no write.
    if (next === current) {
      return current;
    }
    if (next.pinned.length > MAX_ENTRIES || Object.keys(next.seen).length > MAX_ENTRIES) {
      throw new RequestError(409, `Too many pinned or seen sessions (limit ${MAX_ENTRIES})`, 'Unpin some sessions.');
    }
    await writeUserState(dataDir, next);
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}
