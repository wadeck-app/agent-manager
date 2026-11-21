import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Session } from '@wadeck-app/agent-manager-core';
import { getErrorMessage } from '@wadeck-app/agent-manager-core';
import {
  isSubagentRunning,
  listSubagents,
  mergeToolCallEntries,
  pageBackwards,
  parseModelId,
  readInFlight,
  readSubagentActivity,
  readTail,
  resolveProjectsDir,
  rollupModelUsage,
  toolSummary,
  transcriptPath,
  type Entry,
  type InFlightRead,
  type ModelInfoEntry,
  type ModelUsageRollup,
  type SubagentActivityRead,
} from '@wadeck-app/agent-manager-core/transcript';

/** What the list shows about the transcript of a session. */
export interface TranscriptDigest {
  /** Latest assistant text or tool call, one short line; empty when unknown. */
  lastActivity: string;
  /** Why lastActivity is empty or stale; empty when it is trustworthy. */
  note: string;
  subagentCount: number;
  /** Model and token figures of the tail window (see ModelUsageRollup); absent when there is no transcript or it could not be read. */
  usage?: ModelUsageRollup;
  /** What is in flight at the end of the transcript (open calls, background tasks, queued messages), or why it could not be read: the adopt readiness reads it. */
  inFlight: InFlightRead;
  /** The sub-agents as the readiness rule needs them (running ones are re-read at each call: their meta file is rewritten in place when they finish). */
  subagents: SubagentActivityRead;
}

/** Bytes of the end of the transcript read to find the latest activity: bounded whatever the size of the file. */
export const DIGEST_TAIL_BYTES = 64 * 1024;
/** Longest lastActivity (characters). */
export const DIGEST_TEXT_CHARS = 140;
/** A session with no transcript is looked for again at most this often (the lookup scans the project folders). */
const MISSING_RECHECK_MS = 15_000;
/** Bytes read backwards, once per model, to find the `model` attachment (exact name, 1M tag) when the tail does not hold it. */
export const MODEL_SCAN_BYTES = 2 * 1024 * 1024;
const MODEL_SCAN_PAGE = 256 * 1024;
/** Sessions remembered; beyond it the cache restarts (it only saves work). */
const MAX_CACHED = 200;

interface Cached {
  path: string;
  projectDir: string;
  mtimeMs: number;
  size: number;
  subMtimeMs: number | undefined;
  /** Why the tail could not be read; empty when it was. Kept apart from subNote so each is replaced by its own refresh. */
  tailNote: string;
  /** Why the sub-agents could not be listed; empty when they were. */
  subNote: string;
  lastActivity: string;
  subagentCount: number;
  usage: ModelUsageRollup | undefined;
  inFlight: InFlightRead;
  subs: SubagentActivityRead;
  /** The model attachments seen (tail or scan), by canonical model id: the exact names, kept while the session lives. */
  infos: Record<string, ModelInfoEntry>;
  /** Canonical ids whose attachment was already looked for backwards (found or not): the scan runs once per model. */
  scanned: string[];
}

const found = new Map<string, Cached>();
const missing = new Map<string, { until: number; note: string }>();

const joinNotes = (...notes: string[]): string => notes.filter((note) => note !== '').join(' ');

/** Forgets the sessions that are not in the registry any more, and the expired "no transcript" memos: the caches never outgrow the registry. */
export function pruneDigestCache(liveIds: ReadonlySet<string>, now: number): void {
  for (const id of [...found.keys()]) {
    if (!liveIds.has(id)) {
      found.delete(id);
    }
  }
  for (const [id, memo] of [...missing]) {
    if (!liveIds.has(id) || memo.until <= now) {
      missing.delete(id);
    }
  }
}

/** Sizes of the caches (tests). */
export function digestCacheSizes(): { found: number; missing: number } {
  return { found: found.size, missing: missing.size };
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > DIGEST_TEXT_CHARS ? `${flat.slice(0, DIGEST_TEXT_CHARS - 3)}...` : flat;
}

async function mtimeOf(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return undefined;
  }
}

/** Resets the cache (tests). */
export function clearDigestCache(): void {
  found.clear();
  missing.clear();
}

/**
 * The digest of a session, cached by the mtime and size of its transcript (and the mtime of its sub-agents folder): an unchanged file costs two
 * stat calls per poll. A changed file costs one read of its last DIGEST_TAIL_BYTES bytes, never the whole file. Never throws: a problem is the `note`.
 */
export async function digestOf(session: Session, now: number): Promise<TranscriptDigest> {
  const id = session.sessionId;
  const absent = missing.get(id);
  if (absent !== undefined && absent.until > now) {
    return missingDigest(absent.note);
  }
  try {
    let cached = found.get(id);
    if (cached === undefined) {
      const located = await transcriptPath(session.cwd, id, resolveProjectsDir(process.env));
      if (!located.ok) {
        const { code, message, fix } = located.error;
        const note = code === 'not-found' ? 'No transcript yet' : `Transcript not found: ${message} ${fix}`;
        if (missing.size >= MAX_CACHED) {
          missing.clear();
        }
        missing.set(id, { until: now + MISSING_RECHECK_MS, note });
        return missingDigest(note);
      }
      missing.delete(id);
      cached = { path: located.path, projectDir: located.projectDir, mtimeMs: -1, size: -1, subMtimeMs: undefined, tailNote: '', subNote: '', lastActivity: '', subagentCount: 0, usage: undefined, inFlight: { ok: false, reason: 'not read yet' }, subs: { ok: true, infos: [] }, infos: {}, scanned: [] };
    }
    const info = await stat(cached.path);
    const subMtime = await mtimeOf(join(cached.projectDir, id, 'subagents'));
    if (info.mtimeMs === cached.mtimeMs && info.size === cached.size && subMtime === cached.subMtimeMs) {
      // A sub-agent that runs rewrites its meta file in place when it ends: the folder does not change, so a running one is looked at again.
      if (cached.subs.ok && cached.subs.infos.some((sub) => isSubagentRunning(sub, now))) {
        cached.subs = await readSubagentActivity(cached.projectDir, id);
      }
      return answerOf(cached);
    }
    const next: Cached = { ...cached, mtimeMs: info.mtimeMs, size: info.size, subMtimeMs: subMtime };
    if (info.mtimeMs !== cached.mtimeMs || info.size !== cached.size) {
      const tail = await readTail(cached.path, { bytes: DIGEST_TAIL_BYTES });
      if (tail.error !== undefined) {
        const { message, hint } = tail.error;
        next.tailNote = `Transcript unreadable: ${message} ${hint}`;
        next.lastActivity = '';
        next.usage = undefined;
        next.inFlight = { ok: false, reason: `${message} ${hint}`.trim() };
      } else {
        next.tailNote = '';
        next.lastActivity = latestActivity(mergeToolCallEntries(tail.entries));
        await updateUsage(next, tail.entries, tail.startOffset);
        next.inFlight = await readInFlight(cached.path, { firstWindow: { entries: tail.entries, startOffset: tail.startOffset, endOffset: tail.endOffset } });
      }
    }
    if (subMtime !== cached.subMtimeMs || (next.subs.ok && next.subs.infos.some((sub) => isSubagentRunning(sub, now)))) {
      next.subs = await readSubagentActivity(cached.projectDir, id);
    }
    if (subMtime !== cached.subMtimeMs) {
      const subs = await listSubagents(cached.projectDir, id);
      next.subagentCount = subs.ok ? subs.subagents.length : 0;
      if (subs.ok) {
        next.subNote = '';
      } else {
        const { message } = subs.error;
        next.subNote = message;
      }
    }
    if (found.size >= MAX_CACHED) {
      found.clear();
    }
    found.set(id, next);
    return answerOf(next);
  } catch (error) {
    // The file vanished or cannot be read: forget it so that the next poll looks again, and say so.
    found.delete(id);
    return missingDigest(`Transcript unreadable: ${getErrorMessage(error)}`);
  }
}

function answerOf(cached: Cached): TranscriptDigest {
  return { lastActivity: cached.lastActivity, note: joinNotes(cached.tailNote, cached.subNote), subagentCount: cached.subagentCount, inFlight: cached.inFlight, subagents: cached.subs, ...(cached.usage !== undefined ? { usage: cached.usage } : {}) };
}

/** The digest of a session whose transcript is not there or cannot be read: nothing is known of what is in flight, and it says why. */
function missingDigest(note: string): TranscriptDigest {
  return { lastActivity: '', note, subagentCount: 0, inFlight: { ok: false, reason: note }, subagents: { ok: true, infos: [] } };
}

/**
 * The model and token figures of the tail window. The exact model name and the 1M tag live in the `model` attachment, written when the session starts and
 * when the model changes: when the tail does not hold the one of the current model, up to MODEL_SCAN_BYTES before it are read ONCE per model (found or
 * not, it is not looked for again until the model changes). A scan that finds nothing leaves the name derived from the model table.
 */
async function updateUsage(cached: Cached, tailEntries: readonly Entry[], tailStart: number): Promise<void> {
  for (const entry of tailEntries) {
    if (entry.kind === 'model-info') {
      cached.infos[parseModelId(entry.modelId).canonical] = entry;
    }
  }
  const known = (): readonly Entry[] => [...Object.values(cached.infos), ...tailEntries];
  let usage = rollupModelUsage(known());
  const current = usage.currentModel?.id;
  const canonical = current === undefined ? undefined : parseModelId(current).canonical;
  if (canonical !== undefined && cached.infos[canonical] === undefined && !cached.scanned.includes(canonical)) {
    cached.scanned.push(canonical);
    let start = tailStart;
    let read = 0;
    while (start > 0 && read < MODEL_SCAN_BYTES && cached.infos[canonical] === undefined) {
      const page = await pageBackwards(cached.path, start, { bytes: MODEL_SCAN_PAGE });
      if (page.error !== undefined || page.startOffset >= start) {
        break;
      }
      read += start - page.startOffset;
      start = page.startOffset;
      for (const entry of page.entries) {
        if (entry.kind === 'model-info' && parseModelId(entry.modelId).canonical === canonical) {
          // The newest attachment of the model wins: the entries of a page are in file order.
          cached.infos[canonical] = entry;
        }
      }
    }
    usage = rollupModelUsage(known());
  }
  cached.usage = usage;
}

function latestActivity(entries: ReturnType<typeof mergeToolCallEntries>): string {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind === 'assistant-text' && entry.text.trim() !== '') {
      return oneLine(entry.text);
    }
    if (entry.kind === 'tool-call') {
      return oneLine(toolSummary(entry));
    }
  }
  return '';
}
