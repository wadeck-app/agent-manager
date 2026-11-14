import { open, type FileHandle } from 'node:fs/promises';
import { createSink } from './normalize.js';
import { createTailerState, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINE_BYTES, notAFileError, processLines, readBytes, toReadError } from './lines.js';
import type { ReadError, WindowResult } from './types.js';

export type WindowOptions = {
  /** Size of the window, default 1 MiB (the window is widened when it holds no line boundary). */
  bytes?: number;
  /** Lines longer than this are skipped with an oversize marker. Default 1 MiB. */
  maxLineBytes?: number;
  /** Set as `ownerAgentId` on every entry (sub-agent transcripts). */
  agentId?: string;
};

/** Largest range readRange() accepts. */
export const MAX_RANGE_BYTES = 64 * 1024 * 1024;

function failed(path: string, error: ReadError): WindowResult {
  return { entries: [], startOffset: 0, endOffset: 0, hasMoreBefore: false, state: createTailerState(), bytesRead: 0, error };
}

function invalid(path: string, code: 'misaligned' | 'invalid-range', message: string, hint: string): WindowResult {
  return failed(path, { code, path, message, hint, retry: false });
}

async function withFile(path: string, run: (fh: FileHandle, size: number, fileId: string | undefined) => Promise<WindowResult>): Promise<WindowResult> {
  let fh: FileHandle;
  try {
    fh = await open(path, 'r');
  } catch (error) {
    return failed(path, toReadError(path, error));
  }
  try {
    const stat = await fh.stat();
    if (!stat.isFile()) {
      return failed(path, notAFileError(path));
    }
    return await run(fh, stat.size, stat.ino !== 0 && Number.isFinite(stat.ino) ? String(stat.ino) : undefined);
  } catch (error) {
    return failed(path, toReadError(path, error));
  } finally {
    await fh.close().catch(() => undefined);
  }
}

/** True when the byte before `offset` is a newline (or offset is 0): `offset` starts a line. */
async function startsLine(fh: FileHandle, offset: number): Promise<boolean> {
  if (offset === 0) {
    return true;
  }
  const byte = await readBytes(fh, offset - 1, 1);
  return byte.length === 1 && byte[0] === 10;
}

/**
 * The initial window of a transcript: the last `bytes` bytes, the partial first line dropped, the partial last line (being written) left out.
 * `startOffset` is where the window starts; page backwards from it with pageBackwards(). `state` continues with TranscriptTailer.readNew.
 */
export function readTail(path: string, options: WindowOptions = {}): Promise<WindowResult> {
  return backwards(path, undefined, options);
}

/**
 * The window of `bytes` bytes that ends at `beforeOffset` (a `startOffset` returned by readTail / pageBackwards, so it starts a line), whole lines
 * only. Calling it with the returned `startOffset` again walks the file backwards until `hasMoreBefore` is false.
 */
export function pageBackwards(path: string, beforeOffset: number, options: WindowOptions = {}): Promise<WindowResult> {
  return backwards(path, beforeOffset, options);
}

function backwards(path: string, end: number | undefined, options: WindowOptions): Promise<WindowResult> {
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  return withFile(path, async (fh, size, fileId) => {
    let endLimit = size;
    if (end !== undefined) {
      if (!Number.isInteger(end) || end < 0 || end > size) {
        return invalid(path, 'invalid-range', `beforeOffset ${end} is outside the file (size ${size}).`, 'Pass a startOffset returned by readTail() or pageBackwards() of the same file.');
      }
      if (!(await startsLine(fh, end))) {
        return invalid(path, 'misaligned', `Offset ${end} is not at the start of a line.`, 'Pass a startOffset returned by readTail() or pageBackwards() of the same file.');
      }
      endLimit = end;
    }
    let bytes = Math.max(4096, options.bytes ?? DEFAULT_MAX_BYTES);
    const maxWindow = Math.max(bytes, 4 * maxLineBytes);
    for (;;) {
      const windowStart = Math.max(0, endLimit - bytes);
      // One byte before the window tells whether the window starts on a line boundary.
      const readStart = windowStart > 0 ? windowStart - 1 : 0;
      const buf = await readBytes(fh, readStart, endLimit - readStart);
      let first = 0;
      if (windowStart > 0) {
        const nl = buf[0] === 10 ? 0 : buf.indexOf(10);
        first = nl < 0 ? -1 : nl + 1;
      }
      if (first < 0 && windowStart > 0) {
        if (bytes >= maxWindow) {
          return failed(path, {
            code: 'io',
            path,
            message: `No line boundary within ${bytes} bytes before offset ${endLimit}.`,
            hint: 'The transcript holds a line longer than the window; raise the window or check the file.',
            retry: false,
          });
        }
        bytes = Math.min(bytes * 2, maxWindow);
        continue;
      }
      const completeEnd = end !== undefined ? buf.length : buf.lastIndexOf(10) + 1;
      return finishWindow(buf, first, completeEnd, readStart, size, fileId, options.agentId, maxLineBytes);
    }
  });
}

/**
 * The entries of the lines in [fromOffset, toOffset): both must start a line (offsets returned by readTail / pageBackwards, or `resultOffset` /
 * `offset` of an entry). A last line cut by `toOffset` or by the end of the file is left out (see `endOffset`).
 */
export function readRange(path: string, fromOffset: number, toOffset: number, options: WindowOptions = {}): Promise<WindowResult> {
  const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  return withFile(path, async (fh, size, fileId) => {
    if (!Number.isInteger(fromOffset) || !Number.isInteger(toOffset) || fromOffset < 0 || toOffset < fromOffset || fromOffset > size) {
      return invalid(path, 'invalid-range', `Range [${fromOffset}, ${toOffset}) is not valid for a file of ${size} bytes.`, 'Use integers with 0 <= from <= to, from within the file.');
    }
    const to = Math.min(toOffset, size);
    if (to - fromOffset > MAX_RANGE_BYTES) {
      return invalid(path, 'invalid-range', `Range of ${to - fromOffset} bytes exceeds ${MAX_RANGE_BYTES}.`, 'Read the range in several calls.');
    }
    if (!(await startsLine(fh, fromOffset))) {
      return invalid(path, 'misaligned', `Offset ${fromOffset} is not at the start of a line.`, 'Use an offset returned by readTail(), pageBackwards() or an entry.');
    }
    const buf = await readBytes(fh, fromOffset, to - fromOffset);
    return finishWindow(buf, 0, buf.lastIndexOf(10) + 1, fromOffset, size, fileId, options.agentId, maxLineBytes);
  });
}

function finishWindow(
  buf: Buffer,
  first: number,
  completeEnd: number,
  base: number,
  size: number,
  fileId: string | undefined,
  agentId: string | undefined,
  maxLineBytes: number,
): WindowResult {
  const state = createTailerState();
  state.size = size;
  if (fileId !== undefined) {
    state.fileId = fileId;
  }
  const sink = createSink(state, agentId);
  const hasLines = completeEnd > first;
  if (hasLines) {
    processLines(buf, first, completeEnd, base, sink, maxLineBytes);
  }
  const startOffset = base + Math.min(first, buf.length);
  const endOffset = hasLines ? base + completeEnd : startOffset;
  state.offset = endOffset;
  return { entries: sink.entries, startOffset, endOffset, hasMoreBefore: startOffset > 0, state, bytesRead: buf.length };
}
