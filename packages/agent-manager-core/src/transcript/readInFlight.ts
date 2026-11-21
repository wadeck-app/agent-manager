import { scanInFlight } from './inFlight.js';
import type { InFlightFacts } from './inFlight.js';
import type { SubagentActivity } from './readiness.js';
import { listSubagents } from './subagents.js';
import type { Entry } from './types.js';
import { pageBackwards, readTail } from './windows.js';

/** The first window read at the end of a transcript. */
export const IN_FLIGHT_WINDOW_BYTES = 128 * 1024;
/** The most that is read backwards to find the prompt that started the last turn (a big tool result can push it far); beyond it the answer is `unknown`. */
export const IN_FLIGHT_MAX_BYTES = 2 * 1024 * 1024;

export interface ReadInFlightOptions {
  windowBytes?: number;
  maxBytes?: number;
  /**
   * A tail the caller already read (readTail of the same file). Used instead of reading the first window again ONLY when it starts at the beginning of the
   * file (it then holds the whole file, exactly what the first window would): a shorter tail would give other facts, so it is ignored and the file is read.
   */
  firstWindow?: { entries: Entry[]; startOffset: number; endOffset: number };
}

export type InFlightRead = { ok: true; facts: InFlightFacts } | { ok: false; reason: string };

/**
 * Reads the end of a transcript, and goes back page by page until the start of the file (or `maxBytes` were read: then the
 * facts say `reachedStart: false` and older background tasks cannot be ruled out). Never throws: a file that cannot be read is a reason. Reads only the end of the file, whatever its size.
 */
export async function readInFlight(path: string, options: ReadInFlightOptions = {}): Promise<InFlightRead> {
  const windowBytes = options.windowBytes ?? IN_FLIGHT_WINDOW_BYTES;
  const maxBytes = options.maxBytes ?? IN_FLIGHT_MAX_BYTES;
  const reusable = options.firstWindow !== undefined && options.firstWindow.startOffset === 0 ? options.firstWindow : undefined;
  const tail = reusable !== undefined ? { entries: reusable.entries, startOffset: reusable.startOffset, endOffset: reusable.endOffset, error: undefined } : await readTail(path, { bytes: windowBytes });
  if (tail.error !== undefined) {
    // violations-suppress: ts/no-err-message-direct a TranscriptError value ({ message, hint }), not a caught Error
    return { ok: false, reason: `${tail.error.message} ${tail.error.hint}`.trim() };
  }
  let entries: Entry[] = tail.entries;
  let start = tail.startOffset;
  let read = tail.endOffset - tail.startOffset;
  let facts = scanInFlight(entries, { startsAtFileStart: start === 0 });
  let pageBytes = windowBytes;
  // Back to the start of the file (up to maxBytes), not only to the last prompt: a background task started before the window may still run (an unknown, never a free).
  while (start > 0 && read < maxBytes) {
    const page = await pageBackwards(path, start, { bytes: pageBytes });
    if (page.error !== undefined) {
      // violations-suppress: ts/no-err-message-direct a TranscriptError value ({ message, hint }), not a caught Error
      return { ok: false, reason: `${page.error.message} ${page.error.hint}`.trim() };
    }
    if (page.startOffset >= start) {
      // No whole line in this page (one line longer than the page, a big tool result): a longer page, until maxBytes.
      pageBytes *= 2;
      read += pageBytes / 2;
      continue;
    }
    read += start - page.startOffset;
    start = page.startOffset;
    entries = [...page.entries, ...entries];
    facts = scanInFlight(entries, { startsAtFileStart: start === 0 });
  }
  return { ok: true, facts };
}

export type SubagentActivityRead = { ok: true; infos: SubagentActivity[] } | { ok: false; reason: string };

/** The sub-agents of a session as the readiness rule needs them. A session with no sub-agents folder has none. `projectDir` is the one transcriptPath() returns. */
export async function readSubagentActivity(projectDir: string, sessionId: string): Promise<SubagentActivityRead> {
  const listed = await listSubagents(projectDir, sessionId);
  if (!listed.ok) {
    // violations-suppress: ts/no-err-message-direct a TranscriptError value ({ message, hint }), not a caught Error
    return { ok: false, reason: `${listed.error.message} ${listed.error.fix}` };
  }
  const infos = listed.subagents.map(
    (info): SubagentActivity => ({
      agentId: info.agentId,
      finished: info.finished,
      stoppedByUser: info.stoppedByUser,
      ...(info.lastWriteAt === undefined ? {} : { lastWriteAt: info.lastWriteAt }),
      ...(info.readError === undefined ? {} : { readError: info.readError }),
      ...(info.description === undefined ? {} : { description: info.description }),
    }),
  );
  // A meta file that could not be read is a sub-agent we cannot judge: listed as unreadable, so the rule says unknown instead of free.
  for (const problem of listed.unreadable) {
    infos.push({ agentId: problem.file, finished: false, stoppedByUser: false, readError: problem.reason });
  }
  return { ok: true, infos };
}
