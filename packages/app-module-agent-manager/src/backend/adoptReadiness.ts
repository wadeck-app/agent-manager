import { classifyReadiness } from '@wadeck-app/agent-manager-core/transcript';
import type { AdoptReadinessDto } from '../commons/api.js';
import type { TranscriptDigest } from './transcriptDigest.js';

/*
 * The adopt readiness of a row of GET /sessions (#71 phase 1): the pure rule of core (`classifyReadiness`) fed with what this side knows of the session: the
 * status of the row (registry, corrected by the daemon: a permission request is `waiting` at once), the pending permissions of an owned Web session, and the
 * digest of its transcript (open calls, background tasks, queued messages, sub-agents). NOT read here: the state of an hc terminal (one `hc get` per terminal
 * per poll is not worth a hint; the daemon reads it when the switch is asked, and its answer wins), a background session's state, the version of claude.
 */

export interface ReadinessRow {
  status: string;
  waitingFor?: string;
  statusAgeMs?: number;
  alive: boolean;
  pendingPermissions: number;
}

export function adoptReadinessOf(row: ReadinessRow, digest: TranscriptDigest, now: number): AdoptReadinessDto {
  return classifyReadiness({
    now,
    turn: { status: row.status, ...(row.waitingFor === undefined ? {} : { waitingFor: row.waitingFor }), ...(row.statusAgeMs === undefined ? {} : { ageMs: row.statusAgeMs }), alive: row.alive },
    transcript: digest.inFlight,
    subagents: digest.subagents,
    pendingPermissions: row.pendingPermissions,
  });
}
