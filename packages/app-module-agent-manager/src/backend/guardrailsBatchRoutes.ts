import { getErrorMessage, type Session } from '@wadeck-app/agent-manager-core';
import { SAFE_ID } from '@wadeck-app/agent-manager-core/reply';
import { MAX_BATCH_REVOKE_ITEMS, type BatchGrantResult, type BatchGrantStatus, type BatchGrantsOk, type BatchRevokeOk, type BatchRevokeResult, type BatchRevokeStatus } from '../commons/guardrails.js';
import { BATCH_CONCURRENCY, MAX_BATCH_RECIPIENTS } from '../commons/batch.js';
import { CodedRequestError, fail, shaped } from './apiError.js';
import type { OwnedSource } from './daemon/ownedSource.js';
import { bearerOf, parseGrantFields, type AddBody, type GrantCore, type GrantRefusal } from './guardrailsAddRoutes.js';
import { revokeGrant, type GrantsOptions, type RevokeRefusal } from './guardrailsGrantsRoutes.js';
import { mapLimit } from './mapLimit.js';
import { ok, RequestError, type RouteAnswer, type RouteKit } from './routeKit.js';
import { findSession } from './sessionLookup.js';
import { SESSION_ID_PATTERN } from './userState.js';

/*
 * Add and revoke bypasses for a SELECTION of sessions. Threat-model T-24.
 *   POST /guardrails/batch/grants   {requestId, category, mode, rationale, sessions: [full session ids]}: PIN-sensitive and CSRF (commons/routeClasses.ts)
 *   POST /guardrails/batch/revoke   {requestId, items: [{sessionId, grantId}]}: PIN-sensitive and CSRF
 * One PIN prompt of the shell covers the batch: the grant route runs the logic of the single route (GrantCore.grantOne, backend/guardrailsAddRoutes.ts) once per session, at most
 * 2 at the same time, each with ITS OWN folder, and hands the one access token of the request to the plugin's CLI (stdin only: this file never logs, audits or answers it).
 * The token lives 10 minutes: when the plugin says it expired (or that no PIN is set), no new grant is launched and the rest is reported as not-attempted. Nothing is retried
 * by the module; a retry is the user's click, with a new requestId for the remaining sessions. The same requestId and body answers the previous results (nothing runs twice).
 */

/** The fields of the grant body. */
const GRANT_FIELDS = ['requestId', 'category', 'mode', 'rationale', 'sessions'];
const MAX_REQUEST_ID = 64;
/** Answers kept for a replay, and for how long. */
const KEPT_ANSWERS = 100;
const KEPT_MS = 60 * 60 * 1000;
/** The codes after which the next grants of the same token would fail the same way: nothing more is launched. */
const TOKEN_CODES = ['pin-expired', 'pin-not-set'];

const bad = (message: string, hint: string): never => {
  throw new CodedRequestError(400, 'bad-request', message, hint);
};

function objectOf(body: unknown, example: string): object {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return bad('The body must be a JSON object', `Send ${example} with Content-Type: application/json.`);
  }
  return body;
}

function noExtra(body: object, fields: readonly string[], example: string): void {
  const extra = Object.keys(body).filter((key) => !fields.includes(key));
  if (extra.length > 0) {
    bad(`Unknown field(s) in the body: ${extra.map((key) => `'${key.slice(0, 40)}'`).join(', ')}`, `The fields are ${fields.join(', ')}, e.g. ${example}. The folders come from the sessions, never from the body.`);
  }
}

function requestIdOf(body: object, example: string): string {
  const requestId: unknown = Reflect.get(body, 'requestId');
  if (typeof requestId !== 'string' || !SAFE_ID.test(requestId) || requestId.length > MAX_REQUEST_ID) {
    return bad(`'requestId' must be 1 to ${MAX_REQUEST_ID} letters, digits, '_' or '-', got ${JSON.stringify(requestId)?.slice(0, 40)}`, `Send a new requestId for each batch, e.g. ${example}. The same requestId answers the previous results instead of running again.`);
  }
  return requestId;
}

const sessionIdOf = (value: unknown): string => {
  if (typeof value !== 'string' || !SESSION_ID_PATTERN.test(value)) {
    return bad(`'${String(value).slice(0, 80)}' is not a session id`, 'Use the sessionId of GET /sessions (8-4-4-4-12 hexadecimal characters).');
  }
  return value.toLowerCase();
};

export interface GrantBatch {
  requestId: string;
  grant: AddBody;
  sessionIds: string[];
}

/** The body of POST /guardrails/batch/grants, checked as a whole before anything runs: a bad request grants nothing for anybody. */
export function parseGrantBatch(body: unknown): GrantBatch {
  const example = '{"requestId": "b-1", "category": "rm", "mode": "once", "rationale": "why", "sessions": ["<sessionId>", ...]}';
  const object = objectOf(body, example);
  noExtra(object, GRANT_FIELDS, example);
  const requestId = requestIdOf(object, 'b-1');
  const grant = parseGrantFields(object);
  const sessions: unknown = Reflect.get(object, 'sessions');
  if (!Array.isArray(sessions) || sessions.length === 0) {
    bad("'sessions' must be a list of at least one session id", 'Select the sessions to give the bypass to, then send again.');
  }
  const list = sessions as unknown[];
  if (list.length > MAX_BATCH_RECIPIENTS) {
    bad(`A batch has at most ${MAX_BATCH_RECIPIENTS} sessions, got ${list.length}`, `Send the batch in parts of ${MAX_BATCH_RECIPIENTS} or fewer.`);
  }
  const sessionIds = list.map(sessionIdOf);
  if (new Set(sessionIds).size !== sessionIds.length) {
    bad('A session is listed twice', 'List each session once: a bypass is never made twice for the same session by one batch.');
  }
  return { requestId, grant, sessionIds };
}

export interface RevokeItem {
  sessionId: string;
  grantId: string;
}

export interface RevokeBatch {
  requestId: string;
  items: RevokeItem[];
}

/** What the plugin prints as an id of a bypass: 8 lowercase hexadecimal characters. */
const GRANT_ID = /^[0-9a-f]{8}$/;

/** The body of POST /guardrails/batch/revoke, checked as a whole before anything runs. */
export function parseRevokeBatch(body: unknown): RevokeBatch {
  const example = '{"requestId": "b-1", "items": [{"sessionId": "<sessionId>", "grantId": "c0ffee01"}, ...]}';
  const object = objectOf(body, example);
  noExtra(object, ['requestId', 'items'], example);
  const requestId = requestIdOf(object, 'b-1');
  const items: unknown = Reflect.get(object, 'items');
  if (!Array.isArray(items) || items.length === 0) {
    bad("'items' must be a list of at least one {sessionId, grantId}", `Send ${example}.`);
  }
  const list = items as unknown[];
  if (list.length > MAX_BATCH_REVOKE_ITEMS) {
    bad(`A batch revokes at most ${MAX_BATCH_REVOKE_ITEMS} bypasses, got ${list.length}`, `Send the batch in parts of ${MAX_BATCH_REVOKE_ITEMS} or fewer.`);
  }
  const parsed = list.map((item): RevokeItem => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return bad('Each item must be an object {sessionId, grantId}', `Send ${example}.`);
    }
    noExtra(item, ['sessionId', 'grantId'], '{"sessionId": "<sessionId>", "grantId": "c0ffee01"}');
    const grantId: unknown = Reflect.get(item, 'grantId');
    if (typeof grantId !== 'string' || !GRANT_ID.test(grantId)) {
      return bad(`'${String(grantId).slice(0, 40)}' is not a bypass id (8 lowercase hexadecimal characters)`, 'Use the id of GET /guardrails/sessions/:sessionId/grants.');
    }
    return { sessionId: sessionIdOf(Reflect.get(item, 'sessionId')), grantId };
  });
  const keys = parsed.map((item) => `${item.sessionId}|${item.grantId}`);
  if (new Set(keys).size !== keys.length) {
    bad('A bypass is listed twice', 'List each bypass once.');
  }
  const sessions = new Set(parsed.map((item) => item.sessionId));
  if (sessions.size > MAX_BATCH_RECIPIENTS) {
    bad(`A batch has at most ${MAX_BATCH_RECIPIENTS} sessions, got ${sessions.size}`, `Send the batch in parts of ${MAX_BATCH_RECIPIENTS} sessions or fewer.`);
  }
  return { requestId, items: parsed };
}

const textOf = (failure: Pick<GrantRefusal | RevokeRefusal, 'message' | 'hint'>): string => `${failure.message.replace(/\.$/, '')}. ${failure.hint}`;

const nameOf = (session: Session): string => session.name ?? session.folder;

/**
 * The answers of finished requests by requestId, to answer a retry with the previous results (and to refuse a requestId that comes back with another body).
 * Kept in memory for an hour at most (100 answers): a restart forgets them, and the 3 s guard of the grant core still refuses a double click.
 */
class Answers<T> {
  private readonly done = new Map<string, { fingerprint: string; at: number; body: T }>();
  private readonly running = new Set<string>();

  /** The answer to give at once (a replay, or a refusal), or undefined: the request may run (and must call `finish` or `abort`). */
  check(requestId: string, fingerprint: string): { replay: T } | { refusal: RouteAnswer } | undefined {
    const now = Date.now();
    for (const [key, entry] of this.done) {
      if (now - entry.at > KEPT_MS) {
        this.done.delete(key);
      }
    }
    if (this.running.has(requestId)) {
      return { refusal: fail(409, 'duplicate-request', `The request ${requestId} is still running`, 'Wait for its answer: the same requestId is never run twice at the same time.') };
    }
    const known = this.done.get(requestId);
    if (known === undefined) {
      this.running.add(requestId);
      return undefined;
    }
    if (known.fingerprint !== fingerprint) {
      return { refusal: fail(409, 'request-id-reused', `The requestId ${requestId} was already used for another request`, 'Send a new requestId for each batch; reuse one only to retry the very same request.') };
    }
    return { replay: known.body };
  }

  finish(requestId: string, fingerprint: string, body: T): void {
    this.running.delete(requestId);
    this.done.set(requestId, { fingerprint, at: Date.now(), body });
    while (this.done.size > KEPT_ANSWERS) {
      const oldest = this.done.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.done.delete(oldest);
    }
  }

  abort(requestId: string): void {
    this.running.delete(requestId);
  }
}

const notAttemptedText = (code: string): string =>
  code === 'pin-not-set'
    ? 'Not attempted: no PIN is set in app-core. Run app-core-cli pin set once in a terminal, then retry the remaining sessions.'
    : 'Not attempted: the PIN access token expired while the batch ran (it lives 10 minutes). Enter the PIN again and retry the remaining sessions.';

export function registerBatchGrantRoutes(kit: RouteKit, options: GrantsOptions, owned: OwnedSource, core: GrantCore): void {
  const grantAnswers = new Answers<BatchGrantsOk>();
  const revokeAnswers = new Answers<BatchRevokeOk>();

  /** One session of a grant batch. Never throws: every outcome is a result, the others must still run. */
  async function grantSession(id: string, batch: GrantBatch, token: string, stopped: () => string | undefined, stop: (code: string) => void): Promise<BatchGrantResult> {
    const extra = { batchRequestId: batch.requestId };
    let session: Session;
    try {
      const found = await findSession(id, owned);
      if ('registryError' in found) {
        return { sessionId: id, name: id, status: 'failed', code: 'registry-unreadable', text: `The session registry cannot be read: ${found.registryError.message}. ${found.registryError.hint}` };
      }
      session = found.session;
    } catch (error) {
      if (error instanceof RequestError) {
        return { sessionId: id, name: id, status: 'refused', code: 'unknown-session', text: error.hint === undefined ? getErrorMessage(error) : `${getErrorMessage(error).replace(/\.$/, '')}. ${error.hint}` };
      }
      return { sessionId: id, name: id, status: 'failed', code: 'unexpected', text: `Unexpected failure: ${getErrorMessage(error)}. Look at the app-core output and report it.` };
    }
    const name = nameOf(session);
    const base = { sessionId: session.sessionId, name };
    const earlier = stopped();
    if (earlier !== undefined) {
      const text = notAttemptedText(earlier);
      const problem = await core.auditSkipped(session, batch.grant, `not-attempted: ${earlier}`, extra);
      return { ...base, status: 'not-attempted', code: earlier, text: problem === '' ? text : `${text} ${problem}` };
    }
    try {
      const outcome = await core.grantOne(session, batch.grant, token, extra);
      if (outcome.ok) {
        const { added } = outcome;
        const text = `Granted ${added.category} (${added.mode})${added.auditError === '' ? '' : `. ${added.auditError}`}`;
        return { ...base, status: 'granted', code: '', text, id: added.id, cwd: added.cwd };
      }
      if (TOKEN_CODES.includes(outcome.code)) {
        stop(outcome.code);
      }
      const status: BatchGrantStatus = outcome.status < 500 && !TOKEN_CODES.includes(outcome.code) ? 'refused' : 'failed';
      return { ...base, status, code: outcome.code, text: textOf(outcome) };
    } catch (error) {
      return { ...base, status: 'failed', code: 'unexpected', text: `Unexpected failure: ${getErrorMessage(error)}. Look at the app-core output and report it.` };
    }
  }

  kit.route(
    'POST',
    '/guardrails/batch/grants',
    shaped(async (req) => {
      // The token first, as in the single route: without it nothing else is looked at.
      const token = bearerOf(req);
      const batch = parseGrantBatch(req.body);
      const fingerprint = JSON.stringify([batch.grant, [...batch.sessionIds].sort()]);
      const early = grantAnswers.check(batch.requestId, fingerprint);
      if (early !== undefined) {
        return 'replay' in early ? ok({ ...early.replay, replayed: true }) : early.refusal;
      }
      try {
        let tokenFailure: string | undefined;
        const results = await mapLimit(
          batch.sessionIds,
          BATCH_CONCURRENCY,
          (id) =>
            grantSession(
              id,
              batch,
              token,
              () => tokenFailure,
              (code) => {
                tokenFailure ??= code;
              },
            ),
        );
        const counts: Record<BatchGrantStatus, number> = { granted: 0, refused: 0, failed: 0, 'not-attempted': 0 };
        for (const result of results) {
          counts[result.status] += 1;
        }
        const body: BatchGrantsOk = { ok: true, requestId: batch.requestId, category: batch.grant.category, mode: batch.grant.mode, replayed: false, results, counts };
        grantAnswers.finish(batch.requestId, fingerprint, body);
        return ok(body);
      } catch (error) {
        grantAnswers.abort(batch.requestId);
        throw error;
      }
    }),
    { sensitive: true },
  );

  /** One bypass of a revoke batch. Never throws. */
  async function revokeItem(item: RevokeItem, requestId: string): Promise<BatchRevokeResult> {
    const base = { sessionId: item.sessionId, grantId: item.grantId, category: '' };
    let session: Session;
    try {
      const found = await findSession(item.sessionId, owned);
      if ('registryError' in found) {
        return { ...base, name: item.sessionId, status: 'failed', code: 'registry-unreadable', text: `The session registry cannot be read: ${found.registryError.message}. ${found.registryError.hint}` };
      }
      session = found.session;
    } catch (error) {
      if (error instanceof RequestError) {
        return { ...base, name: item.sessionId, status: 'refused', code: 'unknown-session', text: error.hint === undefined ? getErrorMessage(error) : `${getErrorMessage(error).replace(/\.$/, '')}. ${error.hint}` };
      }
      return { ...base, name: item.sessionId, status: 'failed', code: 'unexpected', text: `Unexpected failure: ${getErrorMessage(error)}. Look at the app-core output and report it.` };
    }
    const name = nameOf(session);
    try {
      const outcome = await revokeGrant(options, session, item.grantId, { batchRequestId: requestId });
      if (outcome.ok) {
        return { ...base, sessionId: session.sessionId, name, category: outcome.revoked.category, status: 'revoked', code: '', text: `Revoked ${outcome.revoked.category}${outcome.revoked.auditError === '' ? '' : `. ${outcome.revoked.auditError}`}` };
      }
      return { ...base, sessionId: session.sessionId, name, status: outcome.status < 500 ? 'refused' : 'failed', code: outcome.code, text: textOf(outcome) };
    } catch (error) {
      return { ...base, sessionId: session.sessionId, name, status: 'failed', code: 'unexpected', text: `Unexpected failure: ${getErrorMessage(error)}. Look at the app-core output and report it.` };
    }
  }

  kit.route(
    'POST',
    '/guardrails/batch/revoke',
    shaped(async (req) => {
      const batch = parseRevokeBatch(req.body);
      const fingerprint = JSON.stringify(batch.items.map((item) => `${item.sessionId}|${item.grantId}`).sort());
      const early = revokeAnswers.check(batch.requestId, fingerprint);
      if (early !== undefined) {
        return 'replay' in early ? ok({ ...early.replay, replayed: true }) : early.refusal;
      }
      try {
        const results = await mapLimit(batch.items, BATCH_CONCURRENCY, (item) => revokeItem(item, batch.requestId));
        const counts: Record<BatchRevokeStatus, number> = { revoked: 0, refused: 0, failed: 0 };
        for (const result of results) {
          counts[result.status] += 1;
        }
        const body: BatchRevokeOk = { ok: true, requestId: batch.requestId, replayed: false, results, counts };
        revokeAnswers.finish(batch.requestId, fingerprint, body);
        return ok(body);
      } catch (error) {
        revokeAnswers.abort(batch.requestId);
        throw error;
      }
    }),
    { sensitive: true },
  );
}
