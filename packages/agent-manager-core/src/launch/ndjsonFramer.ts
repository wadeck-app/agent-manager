import { StringDecoder } from 'node:string_decoder';

/** One unit read from the stream: a complete line, or a line that was too large and was dropped (never delivered in pieces). */
export type Frame = { kind: 'line'; text: string } | { kind: 'oversize'; chars: number };

/** A line may hold a base64 image (the replay of a user message repeats it), so the default is generous; the caller can lower it. */
export const DEFAULT_MAX_LINE_CHARS = 32 * 1024 * 1024;

/**
 * Newline-delimited framing of a byte stream: a chunk may hold several lines, a part of a line, or split a multi-byte character. Each chunk is
 * scanned once (only its own text is searched for a newline, never the accumulated buffer), so a very long line costs linear time. A line above
 * `maxLineChars` is dropped as a whole and reported as one `oversize` frame; the framer then continues at the next line. Empty lines are skipped,
 * a trailing '\r' is removed.
 */
export class NdjsonFramer {
  readonly #decoder = new StringDecoder('utf8');
  readonly #maxLineChars: number;
  #parts: string[] = [];
  #length = 0;
  #discarding = false;

  constructor(maxLineChars: number = DEFAULT_MAX_LINE_CHARS) {
    if (!Number.isInteger(maxLineChars) || maxLineChars < 1) {
      throw new RangeError(`maxLineChars must be a positive integer (got ${String(maxLineChars)})`);
    }
    this.#maxLineChars = maxLineChars;
  }

  /** Adds a chunk; returns the frames it completed, in order. */
  push(chunk: string | Buffer): Frame[] {
    const text = typeof chunk === 'string' ? chunk : this.#decoder.write(chunk);
    const frames: Frame[] = [];
    let start = 0;
    for (;;) {
      const newline = text.indexOf('\n', start);
      if (newline === -1) {
        break;
      }
      this.#append(text.slice(start, newline));
      const frame = this.#complete();
      if (frame !== undefined) {
        frames.push(frame);
      }
      start = newline + 1;
    }
    this.#append(text.slice(start));
    return frames;
  }

  /** The stream ended: the last line without a newline, if any. */
  end(): Frame[] {
    this.#append(this.#decoder.end());
    const frame = this.#complete();
    return frame === undefined ? [] : [frame];
  }

  /** Adds a piece of the current line (no newline in it). */
  #append(piece: string): void {
    if (piece === '') {
      return;
    }
    this.#length += piece.length;
    if (this.#discarding) {
      return;
    }
    if (this.#length > this.#maxLineChars) {
      // Too large: free the memory now, keep only the count until the newline.
      this.#discarding = true;
      this.#parts = [];
      return;
    }
    this.#parts.push(piece);
  }

  #complete(): Frame | undefined {
    const chars = this.#length;
    const discarded = this.#discarding;
    const joined = discarded ? '' : this.#parts.join('');
    this.#parts = [];
    this.#length = 0;
    this.#discarding = false;
    if (discarded) {
      return { kind: 'oversize', chars };
    }
    const text = joined.endsWith('\r') ? joined.slice(0, -1) : joined;
    return text.trim() === '' ? undefined : { kind: 'line', text };
  }
}
