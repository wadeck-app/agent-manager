import type { GrantDto, GuardrailsOverviewDto, SessionBlocksDto } from '../shared.js';

/*
 * The Permissions tab of the right rail: the active bypasses of the session and of its project, from GET /guardrails/overview (Add and Revoke are PIN-gated routes, T-22 and T-23).
 */

/** Revoke is live: the admin CLI of the plugin lists and removes the bypasses of a session (backend/guardrailsAdmin.ts), through a PIN-gated route (threat-model T-22). */
export const GUARDRAILS_REVOKE_ENABLED = true;

/** The same folder, whatever the case and the slash (the registry and the plugin files write Windows paths differently). */
export function sameFolder(a: string, b: string): boolean {
  const norm = (path: string): string => path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  return a !== '' && b !== '' && norm(a) === norm(b);
}

export interface PermissionsView {
  /** The grants of this session. */
  mine: GrantDto[];
  /** The grants of the other sessions working in the same project folder. */
  project: GrantDto[];
  /** What the badge says: every grant listed. */
  active: number;
  /** The plugin's counters of this session (refused requests, timeout), absent when it has none. */
  session: SessionBlocksDto | undefined;
}

export function permissionsOf(overview: GuardrailsOverviewDto, sessionId: string, cwd: string): PermissionsView {
  const id = sessionId.toLowerCase();
  const mine = overview.grants.filter((grant) => grant.sessionId.toLowerCase() === id);
  const project = overview.grants.filter((grant) => grant.sessionId.toLowerCase() !== id && sameFolder(grant.project, cwd));
  const session = overview.sessions.find((entry) => entry.sessionId.toLowerCase() === id);
  return { mine, project, active: mine.length + project.length, session };
}
