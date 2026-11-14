import type { FileHandle } from 'node:fs/promises';
import { countSkipped, handleLine, SKIPPED_LINE_TYPES, type Sink } from './normalize.js';
import type { ReadError, TailerState } from './types.js';
import { getErrorMessage } from '../errors.js';
import { isRecord } from './text.js';

/** A line longer than this (bytes, newline excluded) is skipped with an oversize marker. Real transcripts hold lines up to about 1 MB. */
export const DEFAULT_MAX_LINE_BYTES = 1_048_576;

/** Window of one read when the caller gives none. */
export const DEFAULT_MAX_BYTES = 1_048_576;

export function createTailerState(): TailerState {
  return { offset: 0, size: 0, pending: {}, recentMessageIds: [], usageById: {}, counts: { lines: 0, skipped: {}, oversize: 0, parseErrors: 0, unknown: 0 } };
}

/** A copy a read can change without touching the state the caller passed in (pending entries are shared: they are never changed in place). */
export function cloneState(state: TailerState): TailerState {
  return {
    ...state,
    ...(state.discarding !== undefined ? { discarding: { ...state.discarding } } : {}),
    pending: { ...state.pending },
    recentMessageIds: [...state.recentMessageIds],
    usageById: { ...state.usageById },
    counts: { ...state.counts, skipped: { ...state.counts.skipped } },
  };
}

// The attachment line starts {"parentUuid":<uuid or null>,"isSidechain":<bool>,"attachment":{ ... (observed key order, 2.1.3xx): its type comes after
// the (large) attachment object, so the type check of the other lines does not apply.
const ATTACHMENT_HEAD = /^\{"parentUuid":(?:null|"[^"]*"),"isSidechain":(?:true|false),"attachment":\{/;

/**
 * The type of a line that must be skipped, decided from the first characters of the line (ASCII, `head` is the first ~200 bytes read as latin1),
 * or undefined when the line must be parsed. A line whose key order differs is simply parsed: it is still counted as skipped afterwards.
 */
export function skippableType(head: string): string | undefined {
  if (head.startsWith('{"type":"')) {
    const end = head.indexOf('"', 9);
    if (end > 9) {
      const type = head.slice(9, end);
      return SKIPPED_LINE_TYPES.has(type) ? type : undefined;
    }
    return undefined;
  }
  if (head.startsWith('{"parentUuid":') && ATTACHMENT_HEAD.test(head)) {
    return 'attachment';
  }
  return undefined;
}

const HEAD_BYTES = 200;

function headOf(buf: Buffer, start: number, end: number): string {
  return buf.toString('latin1', start, Math.min(end, start + HEAD_BYTES));
}

/**
 * Handles every complete line of buf[from, to) (`to` is just after a newline). `base` is the file offset of buf[0].
 * Entries land in the sink, counters in the sink state.
 */
export function processLines(buf: Buffer, from: number, to: number, base: number, sink: Sink, maxLineBytes: number): void {
  const { state } = sink;
  let start = from;
  while (start < to) {
    let nl = buf.indexOf(10, start);
    if (nl < 0 || nl >= to) {
      nl = to - 1;
    }
    const lineStart = start;
    let end = nl;
    if (end > lineStart && buf[end - 1] === 13) {
      end -= 1;
    }
    const offset = base + lineStart;
    const length = nl - lineStart;
    start = nl + 1;
    if (end === lineStart) {
      continue;
    }
    const skipType = skippableType(headOf(buf, lineStart, end));
    if (skipType !== undefined) {
      countSkipped(state, skipType);
      continue;
    }
    if (length > maxLineBytes) {
      state.counts.lines += 1;
      state.counts.oversize += 1;
      sink.entries.push({ key: `${offset}.0`, offset, kind: 'oversize', bytes: length, limit: maxLineBytes });
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(buf.toString('utf8', lineStart, end));
    } catch (error) {
      state.counts.lines += 1;
      state.counts.parseErrors += 1;
      sink.entries.push({ key: `${offset}.0`, offset, kind: 'unparsable', bytes: length, reason: getErrorMessage(error).slice(0, 200) });
      continue;
    }
    if (!isRecord(parsed)) {
      state.counts.lines += 1;
      state.counts.parseErrors += 1;
      sink.entries.push({ key: `${offset}.0`, offset, kind: 'unparsable', bytes: length, reason: 'the line is JSON but not an object' });
      continue;
    }
    handleLine(sink, parsed, offset, length);
  }
}

/** Reads up to `length` bytes at `position`. */
export async function readBytes(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.allocUnsafe(length);
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await fh.read(buf, filled, length - filled, position + filled);
    if (bytesRead === 0) {
      break;
    }
    filled += bytesRead;
  }
  return filled === length ? buf : buf.subarray(0, filled);
}

/** Turns what fs threw into an explicit error: missing file, locked file (retry), or anything else. Never throws. */
export function toReadError(path: string, error: unknown): ReadError {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const message = getErrorMessage(error);
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return {
      code: 'missing',
      path,
      message: `The transcript does not exist: ${path}`,
      hint: 'The session may not have written its transcript yet, or its project folder is named differently: use transcriptPath() to search by session id.',
      retry: true,
    };
  }
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES' || code === 'EMFILE' || code === 'ETXTBSY') {
    return {
      code: 'busy',
      path,
      message: `The transcript is locked or not readable right now (${code}): ${path}`,
      hint: 'Another process holds the file (Windows sharing violation). Try again in a moment; no data was lost, the offset is unchanged.',
      retry: true,
    };
  }
  return { code: 'io', path, message: `Reading the transcript failed (${code ?? 'no code'}): ${message}`, hint: 'Check the file and its permissions.', retry: false };
}

/** The path exists but is not a regular file (a folder): reading it would silently give nothing. */
export function notAFileError(path: string): ReadError {
  return { code: 'io', path, message: `Not a regular file: ${path}`, hint: 'Pass the path of the <sessionId>.jsonl file, not a folder.', retry: false };
}
