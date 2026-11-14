import { join } from 'node:path';
import * as realFs from 'node:fs/promises';
import { errorCode } from './fsTypes.js';
import type { ReplyFs } from './fsTypes.js';
import type { ReplyPriority } from './types.js';

/** One web reply, as recorded (decision 11). The text is stored unmasked and kept for the retention period (T-11). */
export interface AuditRecord {
  sessionId: string;
  /** Epoch ms of the attempt. */
  time: number;
  /** The text the user typed (not the composed text). */
  text: string;
  imagePaths: string[];
  transport: string;
  priority: ReplyPriority;
  /** 'sent' (the transport wrote it) or 'failed: <reason>' / 'refused: <reason>' (nothing was sent). */
  outcome: string;
  msgId: string;
}

export interface AuditReadOptions {
  /** Most recent records to return. Default 200. */
  limit?: number;
  /** Only records at or after this epoch ms. */
  sinceMs?: number;
  fs?: ReplyFs;
}

export interface AuditReadResult {
  /** Newest first. */
  records: AuditRecord[];
  /** Lines that could not be read: reported, never dropped silently. */
  unreadable: { file: string; line: number; reason: string }[];
}

const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.ndjson$/;

/** The UTC day of an epoch ms, YYYY-MM-DD. */
export function auditDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/** Appends one line to `<configDir>/audit/<YYYY-MM-DD>.ndjson` (UTC day of `record.time`). Append-only: nothing here rewrites a line. */
export async function appendAudit(configDir: string, record: AuditRecord, fs: ReplyFs = realFs): Promise<void> {
  const dir = join(configDir, 'audit');
  await fs.mkdir(dir, { recursive: true });
  await fs.appendFile(join(dir, `${auditDay(record.time)}.ndjson`), `${JSON.stringify(record)}\n`, 'utf8');
}

async function dayFiles(fs: ReplyFs, configDir: string): Promise<string[]> {
  try {
    return (await fs.readdir(join(configDir, 'audit'))).filter((name) => DAY_FILE.test(name)).sort().reverse();
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function readFileRecords(fs: ReplyFs, configDir: string, file: string, filter: (line: string) => boolean, unreadable: AuditReadResult['unreadable']): Promise<AuditRecord[]> {
  const text = await fs.readFile(join(configDir, 'audit', file), 'utf8');
  const records: AuditRecord[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line === '' || !filter(line)) {
      continue;
    }
    try {
      records.push(JSON.parse(line) as AuditRecord);
    } catch {
      unreadable.push({ file, line: i + 1, reason: 'not valid JSON (a partial write?)' });
    }
  }
  return records;
}

/** The most recent records, newest first, optionally only those since `sinceMs`. */
export async function readAudit(configDir: string, options: AuditReadOptions = {}): Promise<AuditReadResult> {
  const fs = options.fs ?? realFs;
  const limit = options.limit ?? 200;
  const sinceDay = options.sinceMs === undefined ? undefined : auditDay(options.sinceMs);
  const unreadable: AuditReadResult['unreadable'] = [];
  const records: AuditRecord[] = [];
  for (const file of await dayFiles(fs, configDir)) {
    if (sinceDay !== undefined && file.slice(0, 10) < sinceDay) {
      break;
    }
    const inFile = await readFileRecords(fs, configDir, file, () => true, unreadable);
    for (const record of inFile.reverse()) {
      if (options.sinceMs === undefined || record.time >= options.sinceMs) {
        records.push(record);
      }
    }
    if (records.length >= limit) {
      break;
    }
  }
  return { records: records.sort((a, b) => b.time - a.time).slice(0, limit), unreadable };
}

/** The most recent record of this message id with outcome 'sent', newest day first; undefined when none. Used to dedupe after a restart. */
export async function findSentInAudit(configDir: string, msgId: string, fs: ReplyFs = realFs): Promise<AuditRecord | undefined> {
  const unreadable: AuditReadResult['unreadable'] = [];
  for (const file of await dayFiles(fs, configDir)) {
    const matches = await readFileRecords(fs, configDir, file, (line) => line.includes(msgId), unreadable);
    const found = matches.reverse().find((record) => record.msgId === msgId && record.outcome === 'sent');
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}
