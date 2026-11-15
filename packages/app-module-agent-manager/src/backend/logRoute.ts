import { open, stat } from 'node:fs/promises';
import { getErrorMessage } from '@wadeck-app/agent-manager-core';
import {
  DEFAULT_MAX_LINE_BYTES,
  LIMITS,
  agentCallOwners,
  buildAgentTree,
  linkSubagents,
  listSubagents,
  mergeToolCallEntries,
  pageBackwards,
  readRange,
  readTail,
  resolveProjectsDir,
  summarizeActivity,
  transcriptPath,
  type Entry,
  type ReadError,
  type SubagentNode,
  type ToolCallEntry,
  type WindowResult,
} from '@wadeck-app/agent-manager-core/transcript';
import type { LogActivity, LogEntry, LogLimits, LogOk, LogTruncation, SubagentDto } from '../commons/api.js';
import { CodedRequestError, fail, shaped } from './apiError.js';
import { findSession } from './sessionLookup.js';
import { RequestError, type RouteKit, type RouteRequest, ok, queryValue } from './routeKit.js';

/** The limits this route applies, sent in every answer so the UI can say "N more characters". */
export const LOG_LIMITS: LogLimits = {
  textChars: 4000,
  inputChars: 2000,
  resultPreviewChars: LIMITS.resultPreviewChars,
  maxEntries: 500,
  maxBodyBytes: 1_000_000,
};

const DEFAULT_ENTRIES = 100;
/** Bytes of one backwards page; a request reads at most MAX_PAGES of them (1.5 MiB) however large the transcript is. */
const PAGE_BYTES = 256 * 1024;
const MAX_PAGES = 6;
/** Extra pages read to find the call of a result that is at the old edge of the window. */
const ORPHAN_EXTRA_PAGES = 2;
/** Bytes read after a `before` page to find the results of its still-running calls. */
const LOOKAHEAD_BYTES = 512 * 1024;
/** Bytes read by one `after` request. */
const AFTER_BYTES = 1024 * 1024;
/** An `after` request starts at the oldest running call only when it is at most this far behind the cursor. */
const LOOKBACK_BYTES = 512 * 1024;
const MAX_RUNNING_CARRIED = 32;
const MAX_RUNNING_REPORTED = 20;

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The cursor: a byte offset that starts a line, and the offsets of the calls still running at that point (so their results complete them).
// ---------------------------------------------------------------------------------------------------------------------------------------------------

interface Cursor {
  /** Offset of the first byte not sent yet (after) / of the first line sent (before). */
  o: number;
  /** Offsets of the lines of the tool calls that were still running when the cursor was made. */
  r: number[];
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor.r.length === 0 ? { o: cursor.o } : cursor), 'utf8').toString('base64url');
}

function decodeCursor(name: string, text: string): Cursor {
  const bad = (): never => {
    throw new CodedRequestError(400, 'cursor-invalid', `'${name}' is not a cursor of this API`, `Use the 'cursor' or 'olderCursor' of a previous answer unchanged, or reload the log without a cursor.`);
  };
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
  } catch {
    return bad();
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return bad();
  }
  const o: unknown = Reflect.get(value, 'o');
  const r: unknown = Reflect.get(value, 'r') ?? [];
  if (typeof o !== 'number' || !Number.isSafeInteger(o) || o < 0 || !Array.isArray(r) || r.length > MAX_RUNNING_CARRIED || !r.every((n) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n < o)) {
    return bad();
  }
  return { o, r: r as number[] };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------------------------------------------------------------------------------

const isCall = (entry: Entry): entry is ToolCallEntry => entry.kind === 'tool-call';
const isRunning = (entry: Entry): entry is ToolCallEntry => isCall(entry) && entry.status === 'running' && entry.orphan !== true;

/** The entries shortened by shrink(): counted in the answer (`truncated.fieldsCut`). */
const SHORTENED = new WeakSet<object>();

/** Shortens what the core kept (up to LIMITS) to what a log answer carries. */
function shrink(entry: Entry): Entry {
  let out = entry;
  if ((entry.kind === 'user-prompt' || entry.kind === 'assistant-text' || entry.kind === 'thinking') && entry.text.length > LOG_LIMITS.textChars) {
    out = { ...entry, text: entry.text.slice(0, LOG_LIMITS.textChars), textTruncated: true };
  } else if (isCall(entry) && JSON.stringify(entry.input).length > LOG_LIMITS.inputChars) {
    out = { ...entry, input: {}, inputTruncated: true };
  }
  if (out !== entry) {
    SHORTENED.add(out);
  }
  return out;
}

/** Whole lines: a tool call and its result share the entry of the call; two entries of one line stay together when the list is cut. */
function cutPoint(entries: readonly Entry[], wanted: number): number {
  let cut = Math.max(0, entries.length - wanted);
  while (cut > 0 && cut < entries.length && entries[cut]!.offset === entries[cut - 1]!.offset) {
    cut += 1;
  }
  return cut;
}

interface Collected {
  entries: Entry[];
  /** Start of the oldest line read. */
  startOffset: number;
  hasMoreBefore: boolean;
  /** End of the newest whole line read. */
  endOffset: number;
  size: number;
}

class LogReadError extends Error {
  constructor(readonly readError: ReadError) {
    super(readError.message);
  }
}

function checked(window: WindowResult): WindowResult {
  if (window.error !== undefined) {
    throw new LogReadError(window.error);
  }
  return window;
}

const orphans = (entries: readonly Entry[]): number => entries.filter((entry) => isCall(entry) && entry.orphan === true).length;

/** Reads backwards from `first` until `wanted` entries are merged (and the results at the old edge found their calls), within MAX_PAGES. */
async function collectBackwards(path: string, first: WindowResult, wanted: number): Promise<Collected> {
  let entries = mergeToolCallEntries(first.entries).filter((entry) => entry.kind !== 'usage');
  let startOffset = first.startOffset;
  let hasMoreBefore = first.hasMoreBefore;
  let pages = 1;
  let extra = 0;
  while (hasMoreBefore && pages < MAX_PAGES) {
    const needMore = entries.length < wanted;
    const needPair = orphans(entries) > 0 && extra < ORPHAN_EXTRA_PAGES;
    if (!needMore && !needPair) {
      break;
    }
    if (!needMore) {
      extra += 1;
    }
    const page = checked(await pageBackwards(path, startOffset, { bytes: PAGE_BYTES }));
    pages += 1;
    entries = mergeToolCallEntries([...page.entries, ...entries]).filter((entry) => entry.kind !== 'usage');
    startOffset = page.startOffset;
    hasMoreBefore = page.hasMoreBefore;
  }
  return { entries, startOffset, hasMoreBefore, endOffset: first.endOffset, size: first.state.size };
}

/** The results, written after `end`, of the calls still running at the end of a `before` page. */
async function completeRunning(path: string, entries: Entry[], end: number, size: number): Promise<Entry[]> {
  const running = new Set(entries.filter(isRunning).map((entry) => entry.key));
  if (running.size === 0 || end >= size) {
    return entries;
  }
  const look = checked(await readRange(path, end, Math.min(size, end + LOOKAHEAD_BYTES)));
  const results = look.entries.filter((entry): entry is ToolCallEntry => isCall(entry) && running.has(entry.key));
  return results.length === 0 ? entries : mergeToolCallEntries([...entries, ...results]);
}

function runningOffsets(entries: readonly Entry[]): number[] {
  return entries.filter(isRunning).map((entry) => entry.offset).slice(-MAX_RUNNING_CARRIED);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------------------------------------------------------------------------------

function subagentDto(node: SubagentNode): SubagentDto {
  const { info } = node;
  return {
    agentId: info.agentId,
    ...(info.agentType !== undefined ? { agentType: info.agentType } : {}),
    ...(info.description !== undefined ? { description: info.description } : {}),
    ...(info.name !== undefined ? { name: info.name } : {}),
    finished: info.finished,
    isFork: info.isFork,
    ...(info.model !== undefined ? { model: info.model } : {}),
    ...(info.toolUseId !== undefined ? { toolUseId: info.toolUseId } : {}),
    ...(node.parentAgentId !== undefined ? { parentAgentId: node.parentAgentId } : {}),
    children: node.children.map(subagentDto),
  };
}

function activityOf(entries: readonly Entry[]): LogActivity {
  const summary = summarizeActivity(entries);
  return {
    scope: 'window',
    ...(summary.lastPromptAt !== undefined ? { lastPromptAt: summary.lastPromptAt } : {}),
    ...(summary.lastAssistantAt !== undefined ? { lastAssistantAt: summary.lastAssistantAt } : {}),
    ...(summary.lastToolSummary !== undefined ? { lastToolSummary: summary.lastToolSummary } : {}),
    runningToolCalls: summary.runningToolCalls.slice(-MAX_RUNNING_REPORTED).map(shrink),
    tokensTotal: summary.tokensTotal,
    contextEstimate: summary.contextEstimate,
    turnsCount: summary.turnsCount,
    errorsCount: summary.errorsCount,
  };
}

function readFailure(failure: ReadError): ReturnType<typeof fail> {
  const { code, message, hint } = failure;
  if (code === 'invalid-range' || code === 'misaligned') {
    return fail(200, 'cursor-stale', `The cursor does not fit the transcript any more (${message})`, 'The transcript was replaced or rewritten: reload the log without a cursor.');
  }
  return fail(200, 'transcript-unreadable', message, hint);
}

function limitOf(query: RouteRequest['query']): number {
  const text = queryValue(query, 'limit');
  if (text === undefined) {
    return DEFAULT_ENTRIES;
  }
  const value = Number(text);
  if (!/^\d+$/.test(text) || value < 1 || value > LOG_LIMITS.maxEntries) {
    throw new RequestError(400, `'limit' must be a whole number from 1 to ${LOG_LIMITS.maxEntries}, got '${text.slice(0, 40)}'`, `Use ?limit=${DEFAULT_ENTRIES} or leave it out.`);
  }
  return value;
}

/** Keeps the entries that fit in the body cap: the newest ones for a tail/before answer, the first ones for an after answer. */
function capBody(entries: Entry[], from: 'newest' | 'oldest'): { kept: Entry[]; dropped: Entry[] } {
  let total = 0;
  const sizes = entries.map((entry) => Buffer.byteLength(JSON.stringify(entry), 'utf8'));
  if (from === 'newest') {
    let first = entries.length;
    while (first > 0 && total + sizes[first - 1]! <= LOG_LIMITS.maxBodyBytes) {
      total += sizes[first - 1]!;
      first -= 1;
    }
    while (first > 0 && first < entries.length && entries[first]!.offset === entries[first - 1]!.offset) {
      first += 1;
    }
    return { kept: entries.slice(first), dropped: entries.slice(0, first) };
  }
  let last = 0;
  while (last < entries.length && total + sizes[last]! <= LOG_LIMITS.maxBodyBytes) {
    total += sizes[last]!;
    last += 1;
  }
  while (last > 0 && last < entries.length && entries[last]!.offset === entries[last - 1]!.offset) {
    last -= 1;
  }
  return { kept: entries.slice(0, last), dropped: entries.slice(last) };
}

export function registerLogRoute(kit: RouteKit): void {
  kit.route(
    'GET',
    '/sessions/:sessionId/log',
    shaped(async (req) => {
      const beforeText = queryValue(req.query, 'before');
      const afterText = queryValue(req.query, 'after');
      if (beforeText !== undefined && afterText !== undefined) {
        throw new CodedRequestError(400, 'bad-request', "'before' and 'after' cannot be used together", 'Use before=<olderCursor> to scroll up, after=<cursor> to poll for new entries, or neither for the newest entries.');
      }
      const limit = limitOf(req.query);
      const before = beforeText === undefined ? undefined : decodeCursor('before', beforeText);
      const after = afterText === undefined ? undefined : decodeCursor('after', afterText);
      const found = await findSession(req.params?.['sessionId']);
      if ('registryError' in found) {
        return fail(200, 'registry-unreadable', `The session registry cannot be read: ${found.registryError.message}`, found.registryError.hint);
      }
      const { session } = found;
      const located = await transcriptPath(session.cwd, session.sessionId, resolveProjectsDir(process.env));
      if (!located.ok) {
        if (located.error.code === 'not-found') {
          return ok(emptyLog(session.sessionId, `No transcript yet for this session: ${located.error.fix}`));
        }
        const { message, fix } = located.error;
        return fail(200, 'transcript-unreadable', message, fix);
      }
      try {
        return ok(await readLog(located.path, located.projectDir, session.sessionId, limit, before, after));
      } catch (error) {
        if (error instanceof LogReadError) {
          if (error.readError.code === 'missing') {
            return ok(emptyLog(session.sessionId, `No transcript yet for this session: ${error.readError.hint}`));
          }
          return readFailure(error.readError);
        }
        return fail(200, 'transcript-unreadable', `Reading the transcript failed: ${getErrorMessage(error)}`, 'Check the file and its permissions, then reload; report it when it persists.');
      }
    }),
  );
}

function emptyLog(sessionId: string, note: string): LogOk {
  return {
    ok: true,
    sessionId,
    entries: [],
    // No cursor: the client asks for the tail again (a transcript that appears later is read from its end, not from byte 0).
    cursor: null,
    olderCursor: null,
    more: false,
    subagents: [],
    subagentsNote: '',
    activity: activityOf([]),
    truncated: { fieldsCut: 0, bodyCapped: false, unreadableLines: 0 },
    limits: LOG_LIMITS,
    note,
  };
}

/** The marker of the line that starts at `from` and is longer than an `after` window: its length (newline included) is found by scanning, nothing of it is kept. */
async function skipLongLine(path: string, from: number, size: number): Promise<Entry | undefined> {
  const fh = await open(path, 'r');
  try {
    const chunk = Buffer.allocUnsafe(AFTER_BYTES);
    let position = from;
    while (position < size) {
      const { bytesRead } = await fh.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) {
        break;
      }
      const newline = chunk.subarray(0, bytesRead).indexOf(10);
      if (newline >= 0) {
        return { key: `${from}.0`, offset: from, kind: 'oversize', bytes: position + newline + 1 - from, limit: DEFAULT_MAX_LINE_BYTES } as Entry;
      }
      position += bytesRead;
    }
  } finally {
    await fh.close().catch(() => undefined);
  }
  // The line is still being written: nothing to skip yet, the cursor stays and the next poll looks again.
  return undefined;
}

async function readLog(path: string, projectDir: string, sessionId: string, limit: number, before: Cursor | undefined, after: Cursor | undefined): Promise<LogOk> {
  let entries: Entry[];
  let cursor: string | null;
  let olderCursor: string | null = null;
  let more = false;
  let bodyCapped = false;
  // What the activity is computed from: the whole window, with the usage entries the answer does not carry.
  let activityEntries: Entry[];

  if (after !== undefined) {
    const size = (await stat(path)).size;
    const oldestRunning = after.r.length === 0 ? after.o : Math.min(...after.r);
    const from = after.o - oldestRunning <= LOOKBACK_BYTES ? oldestRunning : after.o;
    const window = checked(await readRange(path, from, from + AFTER_BYTES));
    let skipped: Entry | undefined;
    let stuck = false;
    if (window.endOffset === from && from + AFTER_BYTES < size) {
      // No whole line in a full window: the line at `from` is longer than the window. Skip it with a visible marker so the cursor always advances.
      skipped = await skipLongLine(path, from, size);
      stuck = skipped === undefined;
    }
    const carried = new Set(after.r);
    // Entries of lines before the cursor were sent already, except the running calls (their update is the point of reading back).
    const fresh = mergeToolCallEntries(skipped === undefined ? window.entries : [skipped]).filter((entry) => entry.offset >= after.o || (isCall(entry) && carried.has(entry.offset)));
    activityEntries = fresh;
    const visible = fresh.filter((entry) => entry.kind !== 'usage');
    const shrunk = visible.map(shrink);
    const capped = capBody(shrunk, 'oldest');
    bodyCapped = capped.dropped.length > 0;
    entries = capped.kept;
    const next = bodyCapped ? capped.dropped[0]!.offset : skipped === undefined ? window.endOffset : skipped.offset + (skipped.kind === 'oversize' ? skipped.bytes : 0);
    cursor = encodeCursor({ o: next, r: runningOffsets(entries).filter((offset) => offset < next) });
    more = bodyCapped || (!stuck && (skipped === undefined ? from + AFTER_BYTES < size : next < size));
  } else if (before !== undefined) {
    const first = checked(await pageBackwards(path, before.o, { bytes: PAGE_BYTES }));
    const collected = await collectBackwards(path, first, limit);
    const completed = await completeRunning(path, collected.entries, before.o, first.state.size);
    activityEntries = completed;
    ({ entries, olderCursor, bodyCapped } = trimToLimit(completed.map(shrink), collected, limit));
    cursor = null;
  } else {
    const first = checked(await readTail(path, { bytes: PAGE_BYTES }));
    const collected = await collectBackwards(path, first, limit);
    activityEntries = collected.entries;
    ({ entries, olderCursor, bodyCapped } = trimToLimit(collected.entries.map(shrink), collected, limit));
    cursor = encodeCursor({ o: first.endOffset, r: runningOffsets(entries).filter((offset) => offset < first.endOffset) });
  }

  const fieldsCut = entries.filter((entry) => SHORTENED.has(entry)).length;
  const subagentResult = await listSubagents(projectDir, sessionId);
  const subagents = subagentResult.ok ? subagentResult.subagents : [];
  const linked = linkSubagents(entries, subagents);
  const tree = buildAgentTree(subagents, agentCallOwners(activityEntries));
  const notes: string[] = [];
  if (!subagentResult.ok) {
    const { message, fix } = subagentResult.error;
    notes.push(`${message} ${fix}`);
  } else if (subagentResult.unreadable.length > 0) {
    notes.push(`${subagentResult.unreadable.length} sub-agent file(s) could not be read: ${subagentResult.unreadable.map((problem) => `${problem.file} (${problem.reason})`).join('; ')}`);
  }
  const truncated: LogTruncation = {
    fieldsCut,
    bodyCapped,
    unreadableLines: entries.filter((entry) => entry.kind === 'oversize' || entry.kind === 'unparsable').length,
  };
  return {
    ok: true,
    sessionId,
    entries: linked as LogEntry[],
    cursor,
    olderCursor,
    more,
    subagents: tree.map(subagentDto),
    subagentsNote: notes.join(' '),
    activity: activityOf(activityEntries),
    truncated,
    limits: LOG_LIMITS,
    note: '',
  };
}

/** The newest `limit` entries on whole lines, within the body cap, and the cursor for what is older. */
function trimToLimit(entries: Entry[], collected: Collected, limit: number): { entries: Entry[]; olderCursor: string | null; bodyCapped: boolean } {
  const cut = cutPoint(entries, limit);
  const limited = entries.slice(cut);
  const capped = capBody(limited, 'newest');
  const bodyCapped = capped.dropped.length > 0;
  const firstKept = capped.kept[0];
  let olderCursor: string | null = null;
  if (cut > 0 || bodyCapped) {
    // The first line that was left out of the answer's start is where the older page ends.
    olderCursor = firstKept === undefined ? null : encodeCursor({ o: firstKept.offset, r: [] });
  } else if (collected.hasMoreBefore) {
    olderCursor = encodeCursor({ o: collected.startOffset, r: [] });
  }
  return { entries: capped.kept, olderCursor, bodyCapped };
}
