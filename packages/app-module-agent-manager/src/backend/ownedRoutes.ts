import { LaunchError, parseDecisionBody, parseLaunchBody, parsePermissionModeBody } from '@wadeck-app/agent-manager-core/launch';
import { SAFE_ID } from '@wadeck-app/agent-manager-core/reply';
import type { OwnedDecisionOk, OwnedForgetOk, OwnedInterruptOk, OwnedListResponse, OwnedPermissionModeOk, OwnedPermissionsOk, OwnedSessionDto, OwnedSessionOk } from '../commons/api.js';
import { CodedRequestError, fail, shaped } from './apiError.js';
import { DaemonError } from './daemon/daemonApi.js';
import type { OwnedView } from './daemon/daemonApi.js';
import { apiErrorOf, errorTextOf } from './daemon/ownedSource.js';
import type { OwnedSource } from './daemon/ownedSource.js';
import type { RouteAnswer, RouteKit, RouteRequest } from './routeKit.js';
import { ok } from './routeKit.js';
import { SESSION_ID_PATTERN, requireNoBody } from './userState.js';

/*
 * The routes of the owned sessions: a thin, checked proxy of the daemon API (the daemon owns the sessions; this module only asks). Every write route goes
 * through the route kit, so it needs the CSRF header like the other write routes (T-08); the daemon adds its own bearer token (T-12). The daemon being
 * down is data on a GET (HTTP 200 `ok: false`, the fix in `error.hint`) and a 409 (not running) or 502 (unreachable, refused, bad answer) on a write.
 */

/** The DTO of an owned session: the daemon's view as it is (same fields; daemon/ownedContract.ts checks at compile time that they agree), typed for the UI. */
export function toOwnedDto(view: OwnedView): OwnedSessionDto {
  return view;
}

/** A failed write: not running is a state conflict (409), a refusal of the daemon keeps its 4xx, anything else is a bad gateway (502). */
function writeFailure(error: DaemonError): RouteAnswer {
  const { code, message, hint } = apiErrorOf(error);
  if (error.kind === 'not-running') {
    return fail(409, code, message, hint);
  }
  if (error.kind === 'rejected' && error.status !== undefined && error.status < 500) {
    return fail(error.status, code, message, hint);
  }
  return fail(502, code, message, hint);
}

/** Runs a write route: the daemon's errors and the checks of the body become `{ ok: false, error }` with the right status. */
function writing(run: (req: RouteRequest) => Promise<RouteAnswer>): (req: RouteRequest) => Promise<RouteAnswer> {
  return shaped(async (req) => {
    try {
      return await run(req);
    } catch (error) {
      if (error instanceof DaemonError) {
        return writeFailure(error);
      }
      // The core checks of a body (the same the daemon makes): the caller's mistake, with its fix.
      if (error instanceof LaunchError) {
        return fail(400, error.code, error.reason, error.fix);
      }
      throw error;
    }
  });
}

/** A read route: the daemon's errors are data (HTTP 200, `ok: false`), the page never goes blank for a stopped daemon. */
function reading(run: (req: RouteRequest) => Promise<RouteAnswer>): (req: RouteRequest) => Promise<RouteAnswer> {
  return shaped(async (req) => {
    try {
      return await run(req);
    } catch (error) {
      if (error instanceof DaemonError) {
        const { code, message, hint } = apiErrorOf(error);
        return fail(200, code, message, hint);
      }
      throw error;
    }
  });
}

function sessionIdOf(req: RouteRequest): string {
  const id = req.params?.['id'];
  if (id === undefined || !SESSION_ID_PATTERN.test(id)) {
    throw new CodedRequestError(400, 'invalid-id', `'${String(id).slice(0, 80)}' is not a session id`, 'Use the id of GET /owned (8-4-4-4-12 hexadecimal characters).');
  }
  return id.toLowerCase();
}

function requestIdOf(req: RouteRequest): string {
  const id = req.params?.['requestId'];
  if (id === undefined || !SAFE_ID.test(id)) {
    throw new CodedRequestError(400, 'invalid-id', `'${String(id).slice(0, 80)}' is not a permission request id`, 'Use the requestId of GET /owned/:id/permissions.');
  }
  return id;
}

/** The optional body of resume: nothing, {} or {"acknowledgeLeftover": true|false}. */
function parseResumeBody(body: unknown): boolean {
  if (body === undefined || body === null) {
    return false;
  }
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new CodedRequestError(400, 'bad-request', 'The body must be a JSON object', 'Send no body, or {"acknowledgeLeftover": true}.');
  }
  const extra = Object.keys(body).filter((key) => key !== 'acknowledgeLeftover');
  if (extra.length > 0) {
    throw new CodedRequestError(400, 'bad-request', `Unknown field(s) in the body: ${extra.map((key) => `'${key.slice(0, 40)}'`).join(', ')}`, 'The only field is acknowledgeLeftover.');
  }
  const value: unknown = Reflect.get(body, 'acknowledgeLeftover');
  if (value !== undefined && typeof value !== 'boolean') {
    throw new CodedRequestError(400, 'bad-request', "'acknowledgeLeftover' must be true or false", 'Send {"acknowledgeLeftover": true} only after checking that no claude process of this session still runs.');
  }
  return value === true;
}

export function registerOwnedRoutes(kit: RouteKit, source: OwnedSource): void {
  // GET /owned: the owned sessions and the status of the daemon, or the reason the daemon cannot be asked.
  kit.route(
    'GET',
    '/owned',
    reading(async () => {
      const generatedAt = new Date().toISOString();
      try {
        const [listed, daemon] = await Promise.all([source.list(), source.daemon.status()]);
        if (!listed.ok) {
          return ok({ ok: false, generatedAt, error: listed.error, errorText: errorTextOf(listed.error), daemon: null, sessions: [] } satisfies OwnedListResponse);
        }
        return ok({ ok: true, generatedAt, daemon, sessions: listed.sessions.map(toOwnedDto) } satisfies OwnedListResponse);
      } catch (error) {
        if (error instanceof DaemonError) {
          const api = apiErrorOf(error);
          return ok({ ok: false, generatedAt, error: api, errorText: errorTextOf(api), daemon: null, sessions: [] } satisfies OwnedListResponse);
        }
        throw error;
      }
    }),
  );

  kit.route(
    'POST',
    '/owned/launch',
    writing(async (req) => {
      const request = await parseLaunchBody(req.body);
      const session = await source.daemon.launch({ ...request });
      return ok({ ok: true, session: toOwnedDto(session) } satisfies OwnedSessionOk);
    }),
  );

  kit.route(
    'POST',
    '/owned/:id/interrupt',
    writing(async (req) => {
      const id = sessionIdOf(req);
      requireNoBody(req.body);
      const receipt = await source.daemon.interrupt(id);
      return ok({ ok: true, sessionId: id, stillQueued: receipt.stillQueued, cancelled: receipt.cancelled ?? [] } satisfies OwnedInterruptOk);
    }),
  );

  kit.route(
    'POST',
    '/owned/:id/permission-mode',
    writing(async (req) => {
      const id = sessionIdOf(req);
      const { mode } = parsePermissionModeBody(req.body);
      const applied = await source.daemon.setPermissionMode(id, mode);
      return ok({ ok: true, sessionId: id, mode: applied.mode } satisfies OwnedPermissionModeOk);
    }),
  );

  kit.route(
    'POST',
    '/owned/:id/stop',
    writing(async (req) => {
      const id = sessionIdOf(req);
      requireNoBody(req.body);
      return ok({ ok: true, session: toOwnedDto(await source.daemon.stop(id)) } satisfies OwnedSessionOk);
    }),
  );

  kit.route(
    'POST',
    '/owned/:id/resume',
    writing(async (req) => {
      const id = sessionIdOf(req);
      const acknowledge = parseResumeBody(req.body);
      return ok({ ok: true, session: toOwnedDto(await source.daemon.resume(id, acknowledge)) } satisfies OwnedSessionOk);
    }),
  );

  kit.route(
    'POST',
    '/owned/:id/forget',
    writing(async (req) => {
      const id = sessionIdOf(req);
      requireNoBody(req.body);
      const forgotten = await source.daemon.forget(id);
      return ok({ ok: true, id: forgotten.id } satisfies OwnedForgetOk);
    }),
  );

  // The full tool input of each pending request: what the user decides on.
  kit.route(
    'GET',
    '/owned/:id/permissions',
    reading(async (req) => {
      const id = sessionIdOf(req);
      const permissions = await source.daemon.permissions(id);
      return ok({ ok: true, sessionId: id, permissions } satisfies OwnedPermissionsOk);
    }),
  );

  kit.route(
    'POST',
    '/owned/:id/permissions/:requestId',
    writing(async (req) => {
      const id = sessionIdOf(req);
      const requestId = requestIdOf(req);
      const decision = parseDecisionBody(req.body);
      // An allow carries no message (the daemon refuses one); a deny carries the reason the model reads.
      const answer = await source.daemon.decide(id, requestId, decision.decision === 'allow' ? { decision: 'allow' } : { decision: 'deny', message: decision.message });
      return ok({ ok: true, sessionId: id, requestId: answer.requestId, decision: answer.decision } satisfies OwnedDecisionOk);
    }),
  );
}
