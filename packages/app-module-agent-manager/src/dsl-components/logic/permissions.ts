import type { GrantDto, GuardrailsOverviewDto, SessionBlocksDto } from '../shared.js';

/*
 * The Permissions tab of the right rail (read-only): the active bypasses of the session and of its project, from GET /guardrails/overview.
 */

/** Revoke is live: the admin CLI of the plugin lists and removes the bypasses of a session (backend/guardrailsAdmin.ts), through a PIN-gated route (threat-model T-22). */
export const GUARDRAILS_REVOKE_ENABLED = true;

/**
 * The switch of ADD (Add bypass, and the batch "Add / remove bypass"). Granting needs the user to prove himself to the plugin from outside the session, which
 * waits for POST /api/auth/verify of app-core: the controls are drawn disabled with the reason. Turn it on only when that exists AND the routes are PIN-gated.
 */
export const GUARDRAILS_WRITE_ENABLED = false;

/** The tooltip of every disabled write control. */
export const GUARDRAILS_WRITE_NEEDS = 'Needs POST /api/auth/verify of app-core (pending)';

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
