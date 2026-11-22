import type { GrantDto, GuardrailsOverviewDto, SessionBlocksDto } from '../shared.js';

/*
 * The Permissions tab of the right rail (read-only): the active bypasses of the session and of its project, from GET /guardrails/overview.
 */

/**
 * The one switch of the write controls (Add bypass, Revoke). The plugin w-guardrails has no API to list, revoke or grant from outside the session yet, so
 * the module cannot do any of it: the controls are drawn disabled with the reason. Turn it on only when that API exists AND the routes are PIN-gated.
 */
export const GUARDRAILS_WRITE_ENABLED = false;

/** The tooltip of every disabled write control. */
export const GUARDRAILS_WRITE_NEEDS = 'Needs the w-guardrails API (list/revoke/grant): not available yet';

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
