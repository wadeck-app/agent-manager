import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultConfigDir, getErrorMessage, type Session } from '@wadeck-app/agent-manager-core';
import type { CliGrantDto, GrantRevokedDto, SessionGrantsDto } from '../commons/guardrails.js';
import { remainingText } from '../commons/remainingText.js';
import { CodedRequestError, fail, shaped } from './apiError.js';
import type { OwnedSource } from './daemon/ownedSource.js';
import { GuardrailsAdminError, listBypasses, resolveAdminScript, revokeBypass, type AdminGrant, type AdminErrorCode } from './guardrailsAdmin.js';
import { ok, queryValue, type RouteAnswer, type RouteKit } from './routeKit.js';
import { findSession } from './sessionLookup.js';
import { latestTranscriptCwd } from './transcriptCwd.js';

/*
 * The bypasses of ONE session, listed and revoked through the plugin's own CLI (backend/guardrailsAdmin.ts). Threat-model T-22.
 *   GET  /guardrails/sessions/:sessionId/grants   read-only, no PIN: the list (the same data the Guardrails page already shows from the files)
 *   POST /guardrails/grants/:id/revoke            {sessionId}: PIN-sensitive and CSRF, listed in commons/routeClasses.ts
 * The module never writes a plugin state file: the revoke is the plugin's own script, run after a list that proves the grant belongs to the session.
 */

/** The plugin prints ids of 8 hexadecimal characters (crypto.randomBytes(4).toString('hex') in request-bypass.js). */
const GRANT_ID = /^[0-9a-f]{8}$/;

/** What a test replaces. */
export interface GrantsOptions {
  /** The home folder that holds .claude/plugins (the plugin cache). Default: the user's home. */
  homeDir?: string;
  /** The admin.js to run instead of the one found in the plugin cache. FOR TESTS (a fake script). */
  adminScript?: string;
  /** Milliseconds before a call of the CLI is killed. Default 10 s. */
  adminTimeoutMs?: number;
  /** Where the audit lines go (<dir>/audit). Default: the agent-manager config folder. */
  configDir?: string;
}

const normalize = (path: string): string => path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();

export interface Folder {
  /** '' when none could be found. */
  cwd: string;
  note: string;
}

/** The folder to ask the plugin about: the one Claude Code reports now (newest transcript line), else the registry's, saying why. */
export async function folderOf(session: Session): Promise<Folder> {
  const registry = session.cwd;
  const latest = await latestTranscriptCwd(session);
  if (latest.ok) {
    if (registry === '' || normalize(latest.cwd) !== normalize(registry)) {
      return { cwd: latest.cwd, note: registry === '' ? `cwd used: ${latest.cwd} (the registry has no folder for this session)` : `cwd used: ${latest.cwd} (the session moved from ${registry})` };
    }
    // The transcript spells it the way Claude Code reports it to the hook: that spelling is the one passed on.
    return { cwd: latest.cwd, note: '' };
  }
  if (registry === '') {
    return { cwd: '', note: '' };
  }
  return { cwd: registry, note: `cwd used: ${registry} (the registry folder; the transcript could not be read to check whether the session moved: ${latest.problem})` };
}

function toDto(grant: AdminGrant): CliGrantDto {
  return {
    id: grant.id,
    category: grant.category,
    mode: grant.mode,
    sessionId: grant.sessionId,
    expiresAt: Date.parse(grant.expires),
    remainingMs: grant.remainingMs,
    remainingText: remainingText(grant.remainingMs),
    usesLeft: grant.usesLeft,
    reason: grant.reason,
    origin: grant.origin,
  };
}

/** The message then the hint, one full stop between them: a plugin message that already ends with one ('contains .claude/.') must not get a second (QA3 R16). */
export const errorText = (failure: GuardrailsAdminError): string => `${getErrorMessage(failure).replace(/\.+$/, '')}.${failure.hint === '' ? '' : ` ${failure.hint}`}`;

/** HTTP status of a failed revoke by the code of the admin error. */
export function statusOf(code: AdminErrorCode): number {
  return code === 'not-installed' ? 503 : code === 'timeout' ? 504 : 502;
}

function parseRevokeBody(body: unknown): string {
  const example = '{"sessionId": "<full session id>"}';
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new CodedRequestError(400, 'bad-request', 'The body must be a JSON object', `Send ${example} with Content-Type: application/json.`);
  }
  const extra = Object.keys(body).filter((key) => key !== 'sessionId');
  if (extra.length > 0) {
    throw new CodedRequestError(400, 'bad-request', `Unknown field(s) in the body: ${extra.map((key) => `'${key.slice(0, 40)}'`).join(', ')}`, `The only field is sessionId, e.g. ${example}. The folder is never chosen by the caller.`);
  }
  const sessionId: unknown = Reflect.get(body, 'sessionId');
  if (typeof sessionId !== 'string' || sessionId === '') {
    throw new CodedRequestError(400, 'bad-request', `'sessionId' must be the session id, got ${sessionId === undefined ? 'nothing' : JSON.stringify(sessionId)?.slice(0, 40)}`, `Send ${example}.`);
  }
  return sessionId;
}

export interface Audit {
  time: number;
  kind: 'bypass-revoke' | 'bypass-grant';
  sessionId: string;
  id: string;
  category: string;
  cwd: string;
  /** 'revoked' / 'granted', or 'failed: <code>: <message>' / 'refused: <code>: <message>' (nothing was changed). */
  outcome: string;
  /** Other plain fields of the line (the grant: mode and rationale). NEVER a token. */
  [extra: string]: unknown;
}

const day = (time: number): string => new Date(time).toISOString().slice(0, 10);

/** The hint of a refusal with the problem of its audit line added (a refusal that could not be audited must still say so). */
export const withAuditProblem = (hint: string, problem: string): string => (problem === '' ? hint : `${hint} ${problem}`);

/** One line per attempt in <config>/audit/guardrails-<UTC day>.ndjson (its own file name: the reply audit reads only <day>.ndjson). Returns why it failed, '' when written. */
export async function writeAudit(configDir: string, record: Audit, done = 'The bypass IS revoked'): Promise<string> {
  try {
    const dir = join(configDir, 'audit');
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, `guardrails-${day(record.time)}.ndjson`), `${JSON.stringify(record)}\n`, 'utf8');
    return '';
  } catch (error) {
    return `The audit line could not be written to ${join(configDir, 'audit')}: ${getErrorMessage(error)}. ${done}; check the permissions of that folder.`;
  }
}

/** The script and the timeout of one call of the admin CLI (the script is resolved at each call: a plugin installed meanwhile is found). */
export function adminCallOf(options: GrantsOptions): { script: string; timeoutMs?: number } {
  return {
    script: options.adminScript ?? resolveAdminScript(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
    ...(options.adminTimeoutMs === undefined ? {} : { timeoutMs: options.adminTimeoutMs }),
  };
}

/** Why one revoke was not done: the HTTP status of the single route, and the machine code, message and fix. */
export interface RevokeRefusal {
  ok: false;
  status: number;
  code: string;
  message: string;
  hint: string;
}

export type RevokeOutcome = { ok: true; revoked: GrantRevokedDto } | RevokeRefusal;

const refusal = (status: number, code: string, message: string, hint: string): RevokeRefusal => ({ ok: false, status, code, message, hint });

/**
 * The whole logic of revoking ONE bypass of ONE session, shared by POST /guardrails/grants/:id/revoke and the batch route: the folder of the session, a list that proves
 * the grant is the session's, the plugin's revoke, the check of what it revoked, one audit line. A refusal or a failure of the plugin is the outcome, never thrown.
 * `auditExtra` adds plain fields to the audit line.
 */
export async function revokeGrant(options: GrantsOptions, session: Session, id: string, auditExtra: Record<string, unknown> = {}): Promise<RevokeOutcome> {
  const call = (): { script: string; timeoutMs?: number } => adminCallOf(options);
  const folder = await folderOf(session);
  if (folder.cwd === '') {
    return refusal(409, 'no-cwd', `The folder of session ${session.sessionId} is unknown, so nothing was revoked`, 'Send a message in the session so that Claude Code reports its folder, then refresh the list.');
  }
  const audit = async (category: string, outcome: string): Promise<string> => writeAudit(options.configDir ?? defaultConfigDir(process.env), { ...auditExtra, time: Date.now(), kind: 'bypass-revoke', sessionId: session.sessionId, id, category, cwd: folder.cwd, outcome });
  let target: AdminGrant | undefined;
  try {
    // List first: the plugin's revoke takes no session, so the proof that the grant is THIS session's is the list filtered by session.
    const listed = await listBypasses({ ...call(), cwd: folder.cwd, sessionId: session.sessionId });
    target = listed.grants.find((grant) => grant.id === id && grant.sessionId === session.sessionId);
    if (target === undefined) {
      const message = `No active bypass ${id} for session ${session.sessionId} in ${folder.cwd}`;
      const problem = await audit('', `refused: grant-not-found: ${message}`);
      return refusal(409, 'grant-not-found', message, withAuditProblem('It may have been used up, expired or revoked already, or it belongs to another session: refresh the list.', problem));
    }
    const revoked = await revokeBypass({ ...call(), cwd: folder.cwd, id });
    if (revoked.sessionId !== session.sessionId || revoked.category !== target.category) {
      const message = `The plugin revoked ${revoked.category} of session ${revoked.sessionId} when ${target.category} of ${session.sessionId} was listed`;
      const problem = await audit(revoked.category, `failed: bad-output: ${message}`);
      return refusal(502, 'bad-output', message, withAuditProblem('Refresh the list and check the plugin; the state may have changed between the list and the revoke.', problem));
    }
    const auditError = await audit(revoked.category, 'revoked');
    return { ok: true, revoked: { ok: true, id, category: revoked.category, sessionId: session.sessionId, cwd: folder.cwd, auditError } };
  } catch (error) {
    if (error instanceof GuardrailsAdminError) {
      // Not installed: nothing ran, so there is nothing to audit.
      const problem = error.code === 'not-installed' ? '' : await audit(target?.category ?? '', `failed: ${error.code}: ${getErrorMessage(error)}`.slice(0, 500));
      return refusal(statusOf(error.code), error.code, getErrorMessage(error), withAuditProblem(error.hint === '' ? 'Refresh the list and retry.' : error.hint, problem));
    }
    throw error;
  }
}

export function registerGrantsRoutes(kit: RouteKit, options: GrantsOptions, owned: OwnedSource): void {
  const configDirOf = (): string => options.configDir ?? defaultConfigDir(process.env);
  const call = (): { script: string; timeoutMs?: number } => adminCallOf(options);

  kit.route('GET', '/guardrails/sessions/:sessionId/grants', async (req) => {
    queryValue(req.query, 'inlineErrors');
    const found = await findSession(req.params?.['sessionId'], owned);
    const empty = (sessionId: string, cwd: string, cwdNote: string, code: string, text: string): RouteAnswer => ok({ ok: false, code, sessionId, cwd, cwdNote, grants: [], errorText: text } satisfies SessionGrantsDto);
    if ('registryError' in found) {
      return empty(req.params?.['sessionId'] ?? '', '', '', 'registry-unreadable', `The session registry cannot be read: ${found.registryError.message}. ${found.registryError.hint}`);
    }
    const { session } = found;
    const folder = await folderOf(session);
    if (folder.cwd === '') {
      return empty(session.sessionId, '', '', 'no-cwd', 'The folder of this session is unknown (neither the registry nor the transcript give one), so the plugin cannot be asked. Send a message in the session so that Claude Code reports it, then refresh.');
    }
    try {
      const listed = await listBypasses({ ...call(), cwd: folder.cwd, sessionId: session.sessionId });
      return ok({ ok: true, code: '', sessionId: session.sessionId, cwd: folder.cwd, cwdNote: folder.note, grants: listed.grants.map(toDto), errorText: '' } satisfies SessionGrantsDto);
    } catch (error) {
      if (error instanceof GuardrailsAdminError) {
        return empty(session.sessionId, folder.cwd, folder.note, error.code, errorText(error));
      }
      throw error;
    }
  });

  kit.route(
    'POST',
    '/guardrails/grants/:id/revoke',
    shaped(async (req) => {
      const id = req.params?.['id'] ?? '';
      if (!GRANT_ID.test(id)) {
        return fail(400, 'bad-grant-id', `'${id.slice(0, 40)}' is not a bypass id (8 lowercase hexadecimal characters)`, 'Use the id of GET /guardrails/sessions/:sessionId/grants.');
      }
      const sessionId = parseRevokeBody(req.body);
      const found = await findSession(sessionId, owned);
      if ('registryError' in found) {
        return fail(409, 'registry-unreadable', `The session registry cannot be read: ${found.registryError.message}`, found.registryError.hint);
      }
      const outcome = await revokeGrant(options, found.session, id);
      return outcome.ok ? ok(outcome.revoked) : fail(outcome.status, outcome.code, outcome.message, outcome.hint);
    }),
    { sensitive: true },
  );
}
