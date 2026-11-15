import { open } from 'node:fs/promises';
import { getErrorMessage } from '@wadeck-app/agent-manager-core';
import { resolveProjectsDir, transcriptPath } from '@wadeck-app/agent-manager-core/transcript';
import type { LocateOk } from '../commons/api.js';
import { fail, shaped } from './apiError.js';
import { RequestError, type RouteKit, ok, queryValue } from './routeKit.js';
import { findSession } from './sessionLookup.js';

/** Bytes read at a time while looking for the call. */
const CHUNK_BYTES = 1024 * 1024;
/** Bytes read at a time while walking back from the call to the start of its line. */
const BACK_BYTES = 64 * 1024;
const NEWLINE = 10;

/** A tool_use id as Claude Code writes it (`toolu_...`): letters, digits, underscore, dash, dot. Anything else cannot be in a transcript as an id. */
export const TOOL_USE_ID = /^[A-Za-z0-9_.-]{1,128}$/;

/** The offset of the first byte of the line that holds `position`, walking backwards from it in blocks. */
async function lineStart(fh: Awaited<ReturnType<typeof open>>, position: number): Promise<number> {
  const block = Buffer.allocUnsafe(BACK_BYTES);
  let end = position;
  while (end > 0) {
    const from = Math.max(0, end - BACK_BYTES);
    const { bytesRead } = await fh.read(block, 0, end - from, from);
    const at = block.subarray(0, bytesRead).lastIndexOf(NEWLINE);
    if (at >= 0) {
      return from + at + 1;
    }
    end = from;
  }
  return 0;
}

type FileHandle = Awaited<ReturnType<typeof open>>;

/** A line longer than this is not read to be checked (a line of a transcript is a few KB, at most a few MB): it is skipped, so the call is then reported as not found. */
const MAX_LINE_BYTES = 32 * 1024 * 1024;

/** The offset of the first byte of the line after the one that holds `position` (the size of the file for the last line). */
async function lineEnd(fh: FileHandle, position: number, size: number): Promise<number> {
  const block = Buffer.allocUnsafe(BACK_BYTES);
  let at = position;
  while (at < size) {
    const { bytesRead } = await fh.read(block, 0, Math.min(BACK_BYTES, size - at), at);
    if (bytesRead === 0) {
      break;
    }
    const found = block.subarray(0, bytesRead).indexOf(NEWLINE);
    if (found >= 0) {
      return at + found + 1;
    }
    at += bytesRead;
  }
  return size;
}

/** True when the line is a parsed assistant line with a tool_use block of this id (a tool result, a text or a copy of the id in a prompt is not). */
function holdsToolUse(line: string, toolUseId: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null || !('message' in parsed)) {
    return false;
  }
  const message = parsed.message;
  if (typeof message !== 'object' || message === null || !('content' in message) || !Array.isArray(message.content)) {
    return false;
  }
  return message.content.some((block: unknown) => typeof block === 'object' && block !== null && 'type' in block && block.type === 'tool_use' && 'id' in block && block.id === toolUseId);
}

/** The position of the first occurrence of one of the byte sequences at or after `from`, reading the file in chunks (nothing is kept). */
async function nextMatch(fh: FileHandle, needles: readonly Buffer[], from: number, size: number): Promise<number | undefined> {
  const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
  const overlap = Math.max(...needles.map((needle) => needle.length)) - 1;
  let carry: Buffer = Buffer.alloc(0);
  let position = from;
  while (position < size) {
    const { bytesRead } = await fh.read(chunk, 0, CHUNK_BYTES, position);
    if (bytesRead === 0) {
      break;
    }
    const window = Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
    const hits = needles.map((needle) => window.indexOf(needle)).filter((at) => at >= 0);
    if (hits.length > 0) {
      return position - carry.length + Math.min(...hits);
    }
    carry = Buffer.from(window.subarray(Math.max(0, window.length - overlap)));
    position += bytesRead;
  }
  return undefined;
}

/**
 * The offset of the line (the `offset` of its entry) holding the tool call `toolUseId` in the transcript, or undefined when no line has it. A byte search for the
 * id as a tool_use block writes it (`"id":"<id>"`, or `"id": "<id>"` when the JSON is spaced), reading the file once in chunks. Each line that has the bytes is then
 * PARSED and kept only when it holds a tool_use block with that id (a tool result that embeds the id, or a prompt that quotes it, is not the call): the search goes
 * on after it otherwise. Only the candidate lines are parsed, so it stays cheap on a large transcript.
 */
export async function findToolCallLine(path: string, toolUseId: string): Promise<{ offset?: number; size: number }> {
  const needles = [Buffer.from(`"id":"${toolUseId}"`, 'utf8'), Buffer.from(`"id": "${toolUseId}"`, 'utf8')];
  const fh = await open(path, 'r');
  try {
    const size = (await fh.stat()).size;
    let from = 0;
    while (from < size) {
      const hit = await nextMatch(fh, needles, from, size);
      if (hit === undefined) {
        break;
      }
      const start = await lineStart(fh, hit);
      const end = await lineEnd(fh, hit, size);
      if (end - start <= MAX_LINE_BYTES) {
        const buf = Buffer.allocUnsafe(end - start);
        const { bytesRead } = await fh.read(buf, 0, end - start, start);
        if (holdsToolUse(buf.toString('utf8', 0, bytesRead), toolUseId)) {
          return { offset: start, size };
        }
      }
      from = end;
    }
    return { size };
  } finally {
    await fh.close().catch(() => undefined);
  }
}

/** GET /sessions/:sessionId/log/locate?toolUseId=<id> (see commons/api.ts). */
export function registerLocateRoute(kit: RouteKit): void {
  kit.route(
    'GET',
    '/sessions/:sessionId/log/locate',
    shaped(async (req) => {
      const toolUseId = queryValue(req.query, 'toolUseId');
      if (toolUseId === undefined || !TOOL_USE_ID.test(toolUseId)) {
        throw new RequestError(400, `'toolUseId' must be a tool_use id (letters, digits, '_', '-', '.', at most 128 characters), got '${(toolUseId ?? '').slice(0, 40)}'`, 'Pass the toolUseId of a sub-agent of the log answer.');
      }
      const found = await findSession(req.params?.['sessionId']);
      if ('registryError' in found) {
        return fail(200, 'registry-unreadable', `The session registry cannot be read: ${found.registryError.message}`, found.registryError.hint);
      }
      const { session } = found;
      const located = await transcriptPath(session.cwd, session.sessionId, resolveProjectsDir(process.env));
      if (!located.ok) {
        if (located.error.code === 'not-found') {
          const body: LocateOk = { ok: true, sessionId: session.sessionId, toolUseId, found: false, transcriptBytes: 0 };
          return ok(body);
        }
        const failure = located.error;
        return fail(200, 'transcript-unreadable', failure.message, failure.fix);
      }
      try {
        const result = await findToolCallLine(located.path, toolUseId);
        const body: LocateOk = { ok: true, sessionId: session.sessionId, toolUseId, found: result.offset !== undefined, ...(result.offset !== undefined ? { offset: result.offset } : {}), transcriptBytes: result.size };
        return ok(body);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          const body: LocateOk = { ok: true, sessionId: session.sessionId, toolUseId, found: false, transcriptBytes: 0 };
          return ok(body);
        }
        return fail(200, 'transcript-unreadable', `Reading the transcript failed: ${getErrorMessage(error)}`, 'Check the file and its permissions, then retry; report it when it persists.');
      }
    }),
  );
}
