import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Session } from '@wadeck-app/agent-manager-core';
import { getErrorMessage } from '@wadeck-app/agent-manager-core';
import { listSubagents, mergeToolCallEntries, readTail, resolveProjectsDir, toolSummary, transcriptPath } from '@wadeck-app/agent-manager-core/transcript';

/** What the list shows about the transcript of a session. */
export interface TranscriptDigest {
  /** Latest assistant text or tool call, one short line; empty when unknown. */
  lastActivity: string;
  /** Why lastActivity is empty or stale; empty when it is trustworthy. */
  note: string;
  subagentCount: number;
}

/** Bytes of the end of the transcript read to find the latest activity: bounded whatever the size of the file. */
export const DIGEST_TAIL_BYTES = 64 * 1024;
/** Longest lastActivity (characters). */
export const DIGEST_TEXT_CHARS = 140;
/** A session with no transcript is looked for again at most this often (the lookup scans the project folders). */
const MISSING_RECHECK_MS = 15_000;
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
    return { lastActivity: '', note: absent.note, subagentCount: 0 };
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
        return { lastActivity: '', note, subagentCount: 0 };
      }
      missing.delete(id);
      cached = { path: located.path, projectDir: located.projectDir, mtimeMs: -1, size: -1, subMtimeMs: undefined, tailNote: '', subNote: '', lastActivity: '', subagentCount: 0 };
    }
    const info = await stat(cached.path);
    const subMtime = await mtimeOf(join(cached.projectDir, id, 'subagents'));
    if (info.mtimeMs === cached.mtimeMs && info.size === cached.size && subMtime === cached.subMtimeMs) {
      return answerOf(cached);
    }
    const next: Cached = { ...cached, mtimeMs: info.mtimeMs, size: info.size, subMtimeMs: subMtime };
    if (info.mtimeMs !== cached.mtimeMs || info.size !== cached.size) {
      const tail = await readTail(cached.path, { bytes: DIGEST_TAIL_BYTES });
      if (tail.error !== undefined) {
        const { message, hint } = tail.error;
        next.tailNote = `Transcript unreadable: ${message} ${hint}`;
        next.lastActivity = '';
      } else {
        next.tailNote = '';
        next.lastActivity = latestActivity(mergeToolCallEntries(tail.entries));
      }
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
    return { lastActivity: '', note: `Transcript unreadable: ${getErrorMessage(error)}`, subagentCount: 0 };
  }
}

function answerOf(cached: Cached): TranscriptDigest {
  return { lastActivity: cached.lastActivity, note: joinNotes(cached.tailNote, cached.subNote), subagentCount: cached.subagentCount };
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
