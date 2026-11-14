import { open, type FileHandle } from 'node:fs/promises';
import { countSkipped, createSink, type Sink } from './normalize.js';
import { cloneState, createTailerState, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINE_BYTES, notAFileError, processLines, readBytes, skippableType, toReadError } from './lines.js';
import type { ReadNewResult, ReadOptions, TailerState } from './types.js';

export type TailerOptions = {
  /** Lines longer than this are skipped with an oversize marker. Default 1 MiB. */
  maxLineBytes?: number;
  /** Set on every entry (`ownerAgentId`) of a sub-agent transcript. */
  agentId?: string;
};

/**
 * Incremental reader of a transcript, keyed by byte offset. The tailer holds no state of its own: everything it needs to continue is in the
 * TailerState returned by each read (plain JSON, persist it as is). Tool calls waiting for their result are part of that state, so a result that
 * arrives in a later read still completes its call (as an update entry with the same key).
 *
 * A read never throws for a missing or locked file: the result carries `error` (with `retry` and a `hint`) and the state is the one passed in.
 */
export class TranscriptTailer {
  private readonly maxLineBytes: number;
  private readonly agentId: string | undefined;

  constructor(options: TailerOptions = {}) {
    this.maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
    this.agentId = options.agentId;
  }

  /** The state of a transcript read from its start. */
  static initialState(): TailerState {
    return createTailerState();
  }

  /**
   * Reads what was appended since `state` (at most about `maxBytes` per call, `more` tells to call again at once).
   * - A partial last line stays unread: the offset stays at its start and it is read again once complete.
   * - An offset beyond the file size, or another file under the same path, restarts at 0 with `truncated: true`.
   * - A line longer than maxLineBytes is skipped (marker entry, counted), even across several reads.
   */
  async readNew(path: string, state: TailerState = createTailerState(), options: ReadOptions = {}): Promise<ReadNewResult> {
    const maxBytes = Math.max(4096, options.maxBytes ?? DEFAULT_MAX_BYTES);
    let fh;
    try {
      fh = await open(path, 'r');
    } catch (error) {
      return { entries: [], state, more: false, bytesRead: 0, error: toReadError(path, error) };
    }
    try {
      const stat = await fh.stat();
      if (!stat.isFile()) {
        return { entries: [], state, more: false, bytesRead: 0, error: notAFileError(path) };
      }
      const fileId = stat.ino !== 0 && Number.isFinite(stat.ino) ? String(stat.ino) : undefined;
      let next = cloneState(state);
      let truncated = false;
      if (next.offset > stat.size || (next.fileId !== undefined && fileId !== undefined && next.fileId !== fileId)) {
        next = createTailerState();
        truncated = true;
      }
      next.fileId = fileId;
      next.size = stat.size;
      const sink = createSink(next, this.agentId);
      let pos = next.offset;
      let bytesRead = 0;
      let reachedEnd = pos >= stat.size;
      while (pos < stat.size && bytesRead < maxBytes) {
        const grown = await this.readStep(fh, pos, stat.size, maxBytes, next, sink);
        if (grown === undefined) {
          reachedEnd = true;
          break;
        }
        pos += grown.consumed;
        bytesRead += grown.consumed;
        reachedEnd = grown.reachedEnd;
        if (grown.consumed === 0) {
          break;
        }
        if (grown.reachedEnd) {
          break;
        }
      }
      next.offset = pos;
      return { entries: sink.entries, state: next, ...(truncated ? { truncated: true } : {}), more: !reachedEnd && pos < stat.size, bytesRead };
    } catch (error) {
      return { entries: [], state, more: false, bytesRead: 0, error: toReadError(path, error) };
    } finally {
      await fh.close().catch(() => undefined);
    }
  }

  /**
   * One window at `pos`. Returns how many bytes were consumed and whether the window reached the end of the file, or undefined when only a partial
   * line is left (nothing consumed, offset stays).
   */
  private async readStep(
    fh: FileHandle,
    pos: number,
    size: number,
    maxBytes: number,
    state: TailerState,
    sink: Sink,
  ): Promise<{ consumed: number; reachedEnd: boolean } | undefined> {
    // Inside a line being discarded: drop bytes up to its newline.
    if (state.discarding !== undefined) {
      const want = Math.min(maxBytes, size - pos);
      const buf = await readBytes(fh, pos, want);
      const nl = buf.indexOf(10);
      const d = state.discarding;
      if (nl < 0) {
        d.bytes += buf.length;
        return { consumed: buf.length, reachedEnd: pos + buf.length >= size };
      }
      d.bytes += nl;
      state.discarding = undefined;
      if (d.lineType !== undefined) {
        countSkipped(state, d.lineType);
      } else {
        state.counts.lines += 1;
        state.counts.oversize += 1;
        sink.entries.push({ key: `${d.startOffset}.0`, offset: d.startOffset, kind: 'oversize', bytes: d.bytes, limit: this.maxLineBytes });
      }
      return { consumed: nl + 1, reachedEnd: pos + nl + 1 >= size };
    }
    let want = Math.min(maxBytes, size - pos);
    for (;;) {
      const buf = await readBytes(fh, pos, want);
      const lastNl = buf.lastIndexOf(10);
      if (lastNl >= 0) {
        processLines(buf, 0, lastNl + 1, pos, sink, this.maxLineBytes);
        return { consumed: lastNl + 1, reachedEnd: pos + buf.length >= size };
      }
      // No newline in the window.
      if (buf.length > this.maxLineBytes) {
        // Longer than a line may be: start discarding it, whatever comes next is dropped up to its newline.
        state.discarding = { startOffset: pos, bytes: buf.length, ...(skipTypeOfHead(buf) !== undefined ? { lineType: skipTypeOfHead(buf) } : {}) };
        return { consumed: buf.length, reachedEnd: pos + buf.length >= size };
      }
      if (pos + buf.length >= size) {
        // A partial last line: it stays unread.
        return undefined;
      }
      // The window ends inside a line shorter than the limit: widen it.
      want = Math.min(size - pos, Math.min(want * 2, this.maxLineBytes + 1));
    }
  }
}

function skipTypeOfHead(buf: Buffer): string | undefined {
  return skippableType(buf.toString('latin1', 0, Math.min(buf.length, 200)));
}
