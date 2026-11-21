import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { auditDay } from '../../reply/audit.js';

/*
 * The audit of the actions on owned sessions: `<config dir>/audit/owned-<YYYY-MM-DD>.ndjson`, append-only, METADATA ONLY (no message text, no tool
 * input, no token). It sits beside the reply audit but in its own files: the reply audit reader only reads `<YYYY-MM-DD>.ndjson`, so these lines never
 * show up as web replies, and the retention purge (by file age) covers them like the rest of `audit/`.
 */

export type HostAuditAction = 'launch' | 'resume' | 'send' | 'interrupt' | 'permission-mode' | 'permission-decision' | 'stop' | 'forget' | 'switch' | 'shutdown';

export interface HostAuditRecord {
  /** Epoch ms. */
  time: number;
  action: HostAuditAction;
  sessionId?: string;
  /** 'ok', or 'failed: <reason>' / 'refused: <reason>'. */
  outcome: string;
  /** Scalars only (ids, counts, names of modes): never user text. */
  details: Record<string, string | number | boolean | null>;
}

export function hostAuditFile(configDir: string, time: number): string {
  return join(configDir, 'audit', `owned-${auditDay(time)}.ndjson`);
}

export async function appendHostAudit(configDir: string, record: HostAuditRecord): Promise<void> {
  await mkdir(join(configDir, 'audit'), { recursive: true });
  await appendFile(hostAuditFile(configDir, record.time), `${JSON.stringify(record)}\n`, 'utf8');
}
