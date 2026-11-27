import { open, stat } from 'node:fs/promises';
import { defaultConfigDir, getErrorMessage, type Session } from '@wadeck-app/agent-manager-core';
import {
  DEFAULT_MAX_LINE_BYTES,
  LIMITS,
  agentCallOwners,
  buildAgentTree,
  createModelTrackerState,
  parseModelId,
  insertModelChanges,
  isSubagentRunning,
  linkSubagents,
  listSubagents,
  mergeToolCallEntries,
  pageBackwards,
  readRange,
  readTail,
  resolveProjectsDir,
  RUNNING_FRESH_MS,
  summarizeActivity,
  transcriptPath,
  type Entry,
  type ModelTrackerState,
  type ReadError,
  type SubagentNode,
  type ToolCallEntry,
  type WindowResult,
} from '@wadeck-app/agent-manager-core/transcript';
import { subagentUsageOf, type SubagentUsageAnswer } from './subagentUsage.js';
import type { LogActivity, LogEntry, LogLimits, LogOk, LogTruncation, SessionStatusDto, SubagentDto } from '../commons/api.js';
import { CodedRequestError, fail, shaped } from './apiError.js';
import { registerLocateRoute } from './locateCall.js';
import { sessionCostOf } from './sessionCost.js';
import { statusOf } from './sessionStatus.js';
import { linkWebReplies } from './webReplyLinks.js';
import { digestOf } from './transcriptDigest.js';
import type { OwnedSource } from './daemon/ownedSource.js';
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
  /** The model the transcript had at this point (see CursorModel): the next `after` answer notices a change against it. Absent before the first assistant message. */
  m?: CursorModel;
}

/**
 * Compact form of the model tracker state carried by a cursor: id (i), display name (n) and known flag (k) of the current model (absent before the first
 * assistant message), 1 while a /model command waits for its first message (p), and the exact names of the models announced by an attachment but not yet used
 * by a message (a, [id, name] pairs, at most MAX_CARRIED_NAMES: the 1M tag lives only there, and it is used by the first message of that model).
 */
interface CursorModel {
  i?: string;
  n?: string;
  k?: boolean;
  p?: 1;
  a?: [string, string][];
}

const MAX_CARRIED_NAMES = 4;

function cursorModelOf(state: ModelTrackerState): CursorModel | undefined {
  const { current } = state;
  const names = Object.values(state.names).slice(-MAX_CARRIED_NAMES).map((entry): [string, string] => [entry.modelId, entry.displayName]);
  if (current === undefined && names.length === 0) {
    return undefined;
  }
  return {
    ...(current === undefined ? {} : { ...(current.id !== undefined ? { i: current.id } : {}), n: current.displayName, k: current.known }),
    ...(state.commandPending === true ? { p: 1 as const } : {}),
    ...(names.length === 0 ? {} : { a: names }),
  };
}

function trackerOf(model: CursorModel | undefined): ModelTrackerState {
  const state = createModelTrackerState();
  if (model !== undefined) {
    if (model.n !== undefined && model.k !== undefined) {
      state.current = { ...(model.i !== undefined ? { id: model.i } : {}), displayName: model.n, known: model.k };
    }
    if (model.p === 1) {
      state.commandPending = true;
    }
    for (const [modelId, displayName] of model.a ?? []) {
      state.names[parseModelId(modelId).canonical] = { modelId, displayName };
    }
  }
  return state;
}

function validModel(value: unknown): CursorModel | undefined | 'bad' {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return 'bad';
  }
  const [i, n, k, p, a] = ['i', 'n', 'k', 'p', 'a'].map((name): unknown => Reflect.get(value, name));
  const short = (text: unknown): text is string => typeof text === 'string' && text.length > 0 && text.length <= 200;
  const currentOk = n === undefined ? k === undefined && i === undefined : short(n) && typeof k === 'boolean' && (i === undefined || short(i));
  const names: [string, string][] = [];
  if (a !== undefined) {
    if (!Array.isArray(a) || a.length > MAX_CARRIED_NAMES) {
      return 'bad';
    }
    for (const pair of a as unknown[]) {
      if (!Array.isArray(pair) || pair.length !== 2 || !short(pair[0]) || !short(pair[1])) {
        return 'bad';
      }
      names.push([pair[0], pair[1]]);
    }
  }
  if (!currentOk || (p !== undefined && p !== 1)) {
    return 'bad';
  }
  return { ...(i !== undefined ? { i: i as string } : {}), ...(n === undefined ? {} : { n: n as string, k: k as boolean }), ...(p === 1 ? { p: 1 as const } : {}), ...(names.length === 0 ? {} : { a: names }) };
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify({ o: cursor.o, ...(cursor.r.length === 0 ? {} : { r: cursor.r }), ...(cursor.m === undefined ? {} : { m: cursor.m }) }), 'utf8').toString('base64url');
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
  const m = validModel(Reflect.get(value, 'm'));
  if (m === 'bad') {
    return bad();
  }
  return { o, r: r as number[], ...(m === undefined ? {} : { m }) };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/** Entries the answer never carries: the token counts and the model attachments (they feed the status and the model-change notices). */
const isHidden = (entry: Entry): boolean => entry.kind === 'usage' || entry.kind === 'model-info';
const visible = (entries: readonly Entry[]): Entry[] => entries.filter((entry) => !isHidden(entry));

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
  // The usage and model-info entries stay: the model tracker needs them (an assistant message with only tool calls has no model but its usage entry).
  let entries = mergeToolCallEntries(first.entries);
  let startOffset = first.startOffset;
  let hasMoreBefore = first.hasMoreBefore;
  let pages = 1;
  let extra = 0;
  while (hasMoreBefore && pages < MAX_PAGES) {
    const needMore = visible(entries).length < wanted;
    const needPair = orphans(entries) > 0 && extra < ORPHAN_EXTRA_PAGES;
    if (!needMore && !needPair) {
      break;
    }
    if (!needMore) {
      extra += 1;
    }
    const page = checked(await pageBackwards(path, startOffset, { bytes: PAGE_BYTES }));
    pages += 1;
    entries = mergeToolCallEntries([...page.entries, ...entries]);
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

/** A sub-agent that is not marked finished counts as active (probably running: a heuristic) while its transcript was written within this time (the rule is core's, shared with the adopt readiness). */
export { RUNNING_FRESH_MS };

/** The status of a sub-agent from facts only (see SubagentDto.status). */
export function subagentStatus(info: SubagentNode['info'], now: number): SubagentDto['status'] {
  // A transcript that exists but cannot be read says nothing: never "just started".
  if (info.readError !== undefined) {
    return 'unknown';
  }
  if (info.stoppedByUser) {
    return 'failed';
  }
  if (info.finished) {
    return 'finished';
  }
  // No transcript yet: just started, nothing says otherwise (the same rule as the adopt readiness).
  return isSubagentRunning(info, now) ? 'active' : 'idle';
}

/** The usage of every sub-agent (incremental per transcript, see subagentUsage.ts), a few at a time. */
async function usagesOf(subagents: readonly SubagentNode['info'][]): Promise<Map<string, SubagentUsageAnswer>> {
  const usages = new Map<string, SubagentUsageAnswer>();
  for (let i = 0; i < subagents.length; i += 16) {
    await Promise.all(
      subagents.slice(i, i + 16).map(async (info) => {
        usages.set(info.agentId, await subagentUsageOf(info));
      }),
    );
  }
  return usages;
}

function subagentDto(node: SubagentNode, now: number, usages: ReadonlyMap<string, SubagentUsageAnswer>): SubagentDto {
  const { info } = node;
  const status = subagentStatus(info, now);
  const usage = usages.get(info.agentId);
  return {
    agentId: info.agentId,
    status,
    ...(status === 'failed' ? { failureReason: 'Stopped by the user' } : {}),
    ...(info.readError !== undefined ? { readError: info.readError } : {}),
    ...(info.startedAt !== undefined ? { startedAt: info.startedAt } : {}),
    ...(info.lastWriteAt !== undefined ? { lastActivityAt: info.lastWriteAt } : {}),
    ...((status === 'finished' || status === 'failed') && info.lastWriteAt !== undefined ? { endedAt: info.lastWriteAt } : {}),
    ...(info.agentType !== undefined ? { agentType: info.agentType } : {}),
    ...(info.description !== undefined ? { description: info.description } : {}),
    ...(info.name !== undefined ? { name: info.name } : {}),
    finished: info.finished,
    isFork: info.isFork,
    ...(info.model !== undefined ? { model: info.model } : {}),
    ...(usage?.usage !== undefined ? { usage: usage.usage } : {}),
    ...(usage?.note !== undefined ? { usageNote: usage.note } : {}),
    ...(info.toolUseId !== undefined ? { toolUseId: info.toolUseId } : {}),
    ...(node.parentAgentId !== undefined ? { parentAgentId: node.parentAgentId } : {}),
    children: node.children.map((child) => subagentDto(child, now, usages)),
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

export function registerLogRoute(kit: RouteKit, owned: OwnedSource): void {
  registerLocateRoute(kit, owned);
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
      const found = await findSession(req.params?.['sessionId'], owned);
      if ('registryError' in found) {
        return fail(200, 'registry-unreadable', `The session registry cannot be read: ${found.registryError.message}`, found.registryError.hint);
      }
      const { session } = found;
      const located = await transcriptPath(session.cwd, session.sessionId, resolveProjectsDir(process.env));
      if (!located.ok) {
        if (located.error.code === 'not-found') {
          return ok(await emptyLog(session, `No transcript yet for this session: ${located.error.fix}`));
        }
        const { message, fix } = located.error;
        return fail(200, 'transcript-unreadable', message, fix);
      }
      try {
        const log = await readLog(session, located.path, located.projectDir, limit, before, after);
        // The replies sent from this page are recognized by origin.msg_id and their exact text, not by a marker (replyMarker none is the default).
        const linked = await linkWebReplies(log.entries, session.sessionId, defaultConfigDir(process.env));
        return ok({ ...log, entries: linked.entries, note: [log.note, linked.note].filter((part) => part !== '').join(' ') });
      } catch (error) {
        if (error instanceof LogReadError) {
          if (error.readError.code === 'missing') {
            return ok(await emptyLog(session, `No transcript yet for this session: ${error.readError.hint}`));
          }
          return readFailure(error.readError);
        }
        return fail(200, 'transcript-unreadable', `Reading the transcript failed: ${getErrorMessage(error)}`, 'Check the file and its permissions, then reload; report it when it persists.');
      }
    }),
  );
}

/** The status line data of the open session: the cached transcript digest (model, usage) and the registry folder (branch, role, bypasses). */
async function statusFor(session: Session, cost?: { path: string; usages: ReadonlyMap<string, SubagentUsageAnswer> }): Promise<SessionStatusDto> {
  const now = Date.now();
  const digest = await digestOf(session, now);
  const status = await statusOf(session, digest.usage, digest.note, now);
  // The cost reads every message of the transcripts (incrementally, cached), so only the log of an open session asks for it.
  return cost === undefined ? status : { ...status, cost: await sessionCostOf(cost.path, cost.usages) };
}

async function emptyLog(session: Session, note: string): Promise<LogOk> {
  return {
    ok: true,
    sessionId: session.sessionId,
    entries: [],
    // No cursor: the client asks for the tail again (a transcript that appears later is read from its end, not from byte 0).
    cursor: null,
    olderCursor: null,
    more: false,
    subagents: [],
    subagentsNote: '',
    activity: activityOf([]),
    status: await statusFor(session),
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

async function readLog(session: Session, path: string, projectDir: string, limit: number, before: Cursor | undefined, after: Cursor | undefined): Promise<LogOk> {
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
    // The model changes against the model the cursor carries; the notices are part of the answer, the usage and model-info entries are not.
    const initial = trackerOf(after.m);
    const tracked = insertModelChanges(fresh, initial);
    activityEntries = tracked.entries;
    const shrunk = visible(tracked.entries).map(shrink);
    const capped = capBody(shrunk, 'oldest');
    bodyCapped = capped.dropped.length > 0;
    entries = capped.kept;
    const next = bodyCapped ? capped.dropped[0]!.offset : skipped === undefined ? window.endOffset : skipped.offset + (skipped.kind === 'oversize' ? skipped.bytes : 0);
    // When the body cap cut the answer, the state is the one just before the first entry left out: it is read again with the next cursor.
    const stateAtNext = bodyCapped ? insertModelChanges(fresh.filter((entry) => entry.offset < next), initial).state : tracked.state;
    const model = cursorModelOf(stateAtNext);
    cursor = encodeCursor({ o: next, r: runningOffsets(entries).filter((offset) => offset < next), ...(model !== undefined ? { m: model } : {}) });
    more = bodyCapped || (!stuck && (skipped === undefined ? from + AFTER_BYTES < size : next < size));
  } else if (before !== undefined) {
    const first = checked(await pageBackwards(path, before.o, { bytes: PAGE_BYTES }));
    const collected = await collectBackwards(path, first, limit);
    const completed = await completeRunning(path, collected.entries, before.o, first.state.size);
    const tracked = insertModelChanges(completed);
    activityEntries = tracked.entries;
    ({ entries, olderCursor, bodyCapped } = trimToLimit(visible(tracked.entries).map(shrink), collected, limit));
    cursor = null;
  } else {
    const first = checked(await readTail(path, { bytes: PAGE_BYTES }));
    const collected = await collectBackwards(path, first, limit);
    // The tracker runs over everything read (more than the answer keeps), so a change near the start of the answer still finds the model before it.
    const tracked = insertModelChanges(collected.entries);
    activityEntries = tracked.entries;
    ({ entries, olderCursor, bodyCapped } = trimToLimit(visible(tracked.entries).map(shrink), collected, limit));
    const model = cursorModelOf(tracked.state);
    cursor = encodeCursor({ o: first.endOffset, r: runningOffsets(entries).filter((offset) => offset < first.endOffset), ...(model !== undefined ? { m: model } : {}) });
  }

  const sessionId = session.sessionId;
  const fieldsCut = entries.filter((entry) => SHORTENED.has(entry)).length;
  const subagentResult = await listSubagents(projectDir, sessionId);
  const subagents = subagentResult.ok ? subagentResult.subagents : [];
  const linked = linkSubagents(entries, subagents);
  const tree = buildAgentTree(subagents, agentCallOwners(activityEntries));
  const usages = await usagesOf(subagents);
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
    subagents: tree.map((node) => subagentDto(node, Date.now(), usages)),
    subagentsNote: notes.join(' '),
    activity: activityOf(activityEntries),
    status: await statusFor(session, { path, usages }),
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
