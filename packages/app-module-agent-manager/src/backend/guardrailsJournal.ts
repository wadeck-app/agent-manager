import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { getErrorMessage } from '@wadeck-app/agent-manager-core';
import type { GuardrailsProblem } from '../commons/guardrails.js';
import { problem, schemaError } from './guardrailsFiles.js';
import { BLOCKED_SCHEMA, JOURNAL_DIR_PARTS, JOURNAL_PREFIX, JOURNAL_SUFFIX } from './guardrailsNames.js';

/*
 * The blocked journal of w-guardrails: one JSON line per deny or ask, one file per day, all projects together (235k lines, 56 MB on the author's machine).
 * It is read from the END only, in chunks, newest first, within a byte budget: never a whole file, never a whole folder.
 */

/** Size of one backward read. */
const CHUNK_BYTES = 64 * 1024;
/** Default and maximum bytes read by one request (all day files together). */
export const DEFAULT_BUDGET_BYTES = 2 * 1024 * 1024;
export const MAX_BUDGET_BYTES = 8 * 1024 * 1024;
export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;

export const journalDirOf = (home: string): string => path.join(home, ...JOURNAL_DIR_PARTS);

const DAY_FILE = new RegExp(`^${JOURNAL_PREFIX}(\\d{4}-\\d{2}-\\d{2})${JOURNAL_SUFFIX.replace('.', '\\.')}$`);
export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface JournalRecord {
  at: number;
  day: string;
  session: string;
  prefix: string;
  decision: 'deny' | 'ask';
  category: string;
  project: string;
  tool: string;
  file: string;
  command: string | null;
}

const RECORD_KEYS = ['schema', 'ts', 'session', 'decision', 'trigger', 'project', 'tool', 'command', 'file'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const textOrNull = (value: unknown): boolean => value === null || typeof value === 'string';

/** One journal line as a record, or why it does not have the known shape (unknown field, wrong type, not JSON). */
export function parseJournalLine(text: string, day: string): { record: JournalRecord } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { error: `not JSON (${getErrorMessage(error)})` };
  }
  if (!isRecord(value)) {
    return { error: 'not a JSON object' };
  }
  const wrongSchema = schemaError(value['schema'], BLOCKED_SCHEMA);
  if (wrongSchema !== undefined) {
    return { error: wrongSchema };
  }
  const extra = Object.keys(value).find((key) => !RECORD_KEYS.includes(key));
  if (extra !== undefined) {
    return { error: `unknown field '${extra}'` };
  }
  const at = typeof value['ts'] === 'string' ? Date.parse(value['ts']) : Number.NaN;
  if (!Number.isFinite(at)) {
    return { error: "'ts' is not an ISO date text" };
  }
  if (typeof value['session'] !== 'string' || value['session'] === '') {
    return { error: "'session' is not text" };
  }
  if (value['decision'] !== 'deny' && value['decision'] !== 'ask') {
    return { error: `'decision' is ${JSON.stringify(value['decision'])} (known: "deny", "ask")` };
  }
  if (typeof value['trigger'] !== 'string' || value['trigger'] === '') {
    return { error: "'trigger' is not text" };
  }
  for (const key of ['project', 'tool', 'command', 'file']) {
    if (value[key] !== undefined && !textOrNull(value[key])) {
      return { error: `'${key}' is neither text nor null` };
    }
  }
  const session = value['session'];
  return { record: {
    at,
    day,
    session,
    prefix: session.split(':')[0] ?? session,
    decision: value['decision'],
    category: value['trigger'],
    project: typeof value['project'] === 'string' ? value['project'] : '',
    tool: typeof value['tool'] === 'string' ? value['tool'] : '',
    file: typeof value['file'] === 'string' ? value['file'] : '',
    command: typeof value['command'] === 'string' ? value['command'] : null,
  } };
}

export interface JournalQuery {
  /** YYYY-MM-DD: only that day file. Absent: the newest days first. */
  day?: string;
  /** Exact category (the `trigger`). */
  category?: string;
  /** Lowercase hexadecimal prefix of the session (1 to 8 characters). */
  sessionPrefix?: string;
  limit: number;
  budgetBytes: number;
  /**
   * Epoch ms: stop at the first record older than this (the files are appended in time order, so everything after it in the newest-first walk is older too).
   * Reaching it is not a truncation. A line without a readable `ts` never reaches the records (it is skipped and reported), so it is never "recent".
   */
  sinceMs?: number;
}

export interface JournalTail {
  records: JournalRecord[];
  /** Day files of the folder, newest first. */
  days: string[];
  /** Categories among the records that passed the day and session filters (what the category filter can offer). */
  categories: string[];
  /** Older lines exist that were not read (limit or byte budget reached). */
  truncated: boolean;
  bytesRead: number;
  skipped: { count: number; example: string };
  problems: GuardrailsProblem[];
}

/** Calls `onLine` with the lines of the file from the last to the first, reading chunks from the end; stops when it returns false or `budget.left` runs out. Returns whether it reached the start. */
async function readLinesNewestFirst(file: string, size: number, budget: { left: number; used: number }, onLine: (line: string) => boolean): Promise<boolean> {
  const handle = await open(file, 'r');
  try {
    let position = size;
    // The bytes of a line whose start is in an earlier chunk (the head of the previous chunk, up to its first newline).
    let carry: Buffer = Buffer.alloc(0);
    while (position > 0) {
      if (budget.left <= 0) {
        return false;
      }
      const length = Math.min(CHUNK_BYTES, position, budget.left);
      position -= length;
      const chunk = Buffer.alloc(length);
      const { bytesRead } = await handle.read(chunk, 0, length, position);
      budget.left -= bytesRead;
      budget.used += bytesRead;
      const data = Buffer.concat([chunk.subarray(0, bytesRead), carry]);
      // Complete lines are those after the first newline; the part before it may continue in the earlier chunk. Newlines are 0x0A in UTF-8 too: splitting bytes is safe.
      const first = data.indexOf(0x0a);
      if (first === -1 && position > 0) {
        carry = data;
        continue;
      }
      const complete = first === -1 ? data : data.subarray(first + 1);
      carry = first === -1 ? Buffer.alloc(0) : data.subarray(0, first);
      const lines = complete.toString('utf8').split('\n');
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]!.trim();
        if (line !== '' && !onLine(line)) {
          return false;
        }
      }
    }
    const head = carry.toString('utf8').trim();
    return head === '' || onLine(head);
  } finally {
    await handle.close();
  }
}

/** The day files of the journal folder, newest first; the folder missing is a visible problem, not an empty list. */
export async function listJournalDays(dir: string): Promise<{ days: string[]; problems: GuardrailsProblem[] }> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    const code = error instanceof Error ? Reflect.get(error, 'code') : undefined;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { days: [], problems: [problem(dir, 'does not exist: the blocked journal has no file', 'Nothing was blocked yet, or w-guardrails is not installed on this machine, or it logs elsewhere (this module reads <home>/.claude/logs/w-guardrails).')] };
    }
    return { days: [], problems: [problem(dir, `cannot be read: ${getErrorMessage(error)}`, 'Check the permissions of the folder; the module only needs read access.')] };
  }
  const days = names.flatMap((name) => DAY_FILE.exec(name)?.[1] ?? []).sort().reverse();
  return { days, problems: [] };
}

/** The newest records of the journal that pass the filters, newest first, within the byte budget. */
export async function readJournalTail(dir: string, query: JournalQuery): Promise<JournalTail> {
  const listed = await listJournalDays(dir);
  const result: JournalTail = { records: [], days: listed.days, categories: [], truncated: false, bytesRead: 0, skipped: { count: 0, example: '' }, problems: [...listed.problems] };
  const selected = query.day === undefined ? listed.days : listed.days.filter((day) => day === query.day);
  const seen = new Set<string>();
  const budget = { left: Math.min(query.budgetBytes, MAX_BUDGET_BYTES), used: 0 };
  let stopped = false;
  let windowStartReached = false;
  for (const day of selected) {
    if (stopped) {
      result.truncated ||= !windowStartReached;
      break;
    }
    const file = path.join(dir, `${JOURNAL_PREFIX}${day}${JOURNAL_SUFFIX}`);
    try {
      const size = (await stat(file)).size;
      const reachedStart = await readLinesNewestFirst(file, size, budget, (line) => {
        const parsed = parseJournalLine(line, day);
        if ('error' in parsed) {
          result.skipped.count += 1;
          if (result.skipped.example === '') {
            result.skipped.example = `${file}: ${parsed.error}`;
          }
          return true;
        }
        const record = parsed.record;
        if (query.sinceMs !== undefined && record.at < query.sinceMs) {
          windowStartReached = true;
          stopped = true;
          return false;
        }
        if (query.sessionPrefix !== undefined && !record.prefix.toLowerCase().startsWith(query.sessionPrefix)) {
          return true;
        }
        seen.add(record.category);
        if (query.category === undefined || record.category === query.category) {
          result.records.push(record);
        }
        if (result.records.length >= query.limit) {
          stopped = true;
          return false;
        }
        return true;
      });
      if (!reachedStart && !windowStartReached) {
        // Either the limit was reached (stopped) or the byte budget ran out in the middle of this file: older lines exist.
        result.truncated = true;
        stopped = true;
      }
    } catch (error) {
      result.problems.push(problem(file, `cannot be read: ${getErrorMessage(error)}`, 'Check the permissions of the file; the module only needs read access. The older days were not read.'));
      stopped = true;
      result.truncated = true;
    }
  }
  result.bytesRead = budget.used;
  result.categories = [...seen].sort();
  if (result.skipped.count > 0) {
    result.problems.push(problem(dir, `${result.skipped.count} line(s) of the journal do not have the known shape and are not shown; first: ${result.skipped.example}`, 'The plugin may have changed the journal format since w-guardrails 1.29.0: update this module, or ask the plugin owner for the documented schema (request A1 of research/guardrails-management.md).'));
  }
  return result;
}
