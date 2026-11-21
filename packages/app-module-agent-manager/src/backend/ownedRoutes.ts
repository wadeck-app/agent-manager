import { LaunchError, MAX_QUOTE_CHARS, assertResumeSessionAt, parseDecisionBody, parseLaunchBody, parsePermissionModeBody } from '@wadeck-app/agent-manager-core/launch';
import { SAFE_ID } from '@wadeck-app/agent-manager-core/reply';
import { forkNameOf } from '../commons/forkName.js';
import type { OwnedDecisionOk, OwnedForgetOk, OwnedForkOk, OwnedInterruptOk, OwnedListResponse, OwnedPermissionModeOk, OwnedPermissionsOk, OwnedSessionDto, OwnedSessionOk } from '../commons/api.js';
import { CodedRequestError, fail, shaped } from './apiError.js';
import { DaemonError } from './daemon/daemonApi.js';
import type { OwnedView } from './daemon/daemonApi.js';
import { overlayOwned } from './daemon/ownedJoin.js';
import { apiErrorOf, errorTextOf } from './daemon/ownedSource.js';
import type { OwnedSource } from './daemon/ownedSource.js';
import type { RouteAnswer, RouteKit, RouteRequest } from './routeKit.js';
import { ok } from './routeKit.js';
import { findSession } from './sessionLookup.js';
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

interface ForkBody {
  sourceSessionId: string;
  name?: string;
  model?: string;
  permissionMode?: string;
  /** A thread: the uuid of the log row (transcript entry) the fork stops at. */
  atMessageId?: string;
  atMessageQuote?: string;
}

const FORK_FIELDS = ['sourceSessionId', 'name', 'model', 'permissionMode', 'atMessageId', 'atMessageQuote'];

/** The body of POST /owned/fork: the source id (required) and three optional texts; a typo in a field name is refused, never ignored. */
function parseForkBody(body: unknown): ForkBody {
  const example = '{"sourceSessionId":"<id of a session of the list>","name":"fork of x"}';
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new CodedRequestError(400, 'bad-request', 'The body must be a JSON object', `Send ${example}.`);
  }
  const extra = Object.keys(body).filter((key) => !FORK_FIELDS.includes(key));
  if (extra.length > 0) {
    throw new CodedRequestError(400, 'bad-request', `Unknown field(s) in the body: ${extra.map((key) => `'${key.slice(0, 40)}'`).join(', ')}`, `The fields are: ${FORK_FIELDS.join(', ')}.`);
  }
  const text = (key: string): string | undefined => {
    const value: unknown = Reflect.get(body, key);
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== 'string' || value === '') {
      throw new CodedRequestError(400, 'bad-request', `'${key}' must be a non-empty string`, `Give '${key}' a value, or leave it out.`);
    }
    return value;
  };
  const sourceSessionId = text('sourceSessionId');
  if (sourceSessionId === undefined) {
    throw new CodedRequestError(400, 'bad-request', "'sourceSessionId' is required", `Send ${example}.`);
  }
  const name = text('name');
  const model = text('model');
  const permissionMode = text('permissionMode');
  const atMessageId = text('atMessageId');
  if (atMessageId !== undefined) {
    // The shape first (a LaunchError, 400 with its fix): a bad value never costs a call to the daemon.
    assertResumeSessionAt(atMessageId);
  }
  const atMessageQuote = text('atMessageQuote');
  if (atMessageQuote !== undefined && atMessageId === undefined) {
    throw new CodedRequestError(400, 'bad-request', "'atMessageQuote' needs 'atMessageId'", "Send the uuid of the message in 'atMessageId', or leave the quote out.");
  }
  if (atMessageQuote !== undefined && (atMessageQuote.length > MAX_QUOTE_CHARS || /[\u0000-\u001f\u007f]/.test(atMessageQuote))) {
    throw new CodedRequestError(400, 'bad-request', `'atMessageQuote' must be one line of at most ${MAX_QUOTE_CHARS} characters`, `Cut the quote to ${MAX_QUOTE_CHARS} characters and remove line breaks.`);
  }
  return { sourceSessionId, ...(name === undefined ? {} : { name }), ...(model === undefined ? {} : { model }), ...(permissionMode === undefined ? {} : { permissionMode }), ...(atMessageId === undefined ? {} : { atMessageId }), ...(atMessageQuote === undefined ? {} : { atMessageQuote }) };
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
    { sensitive: true },
  );

  /*
   * POST /owned/fork: a NEW Web session on a copy of the conversation of a session of the list (research/session-fork.md). The source can be owned (any host:
   * only its transcript is read) or discovered; it is never touched. The folder is the one of the source (Claude Code looks the transcript up across project
   * folders, but a fork in another folder would change what the agent sees: not offered). Model and mode default to the ones of an owned source.
   */
  kit.route(
    'POST',
    '/owned/fork',
    writing(async (req) => {
      const body = parseForkBody(req.body);
      const found = await findSession(body.sourceSessionId, source);
      if ('registryError' in found) {
        return fail(409, 'registry-unreadable', `The session registry cannot be read: ${found.registryError.message}`, found.registryError.hint);
      }
      const { session } = found;
      // The record gives the defaults of model and mode: when the daemon cannot be asked the fork is refused (it would otherwise start with defaults the user never saw).
      const ownedFound = await source.find(session.sessionId);
      if (!ownedFound.ok) {
        const { code, message, hint } = ownedFound.error;
        return fail(code === 'daemon-not-running' ? 409 : 502, code, `The daemon could not be asked about the session to fork: ${message}`, hint);
      }
      const { view } = ownedFound;
      const model = body.model ?? view?.model;
      const permissionMode = body.permissionMode ?? view?.permissionMode;
      // What came from the record and not from the body: the answer says so, nothing is defaulted silently.
      const inherited = {
        ...(body.model === undefined && view?.model !== undefined ? { model: view.model } : {}),
        ...(body.permissionMode === undefined && view?.permissionMode !== undefined ? { permissionMode: view.permissionMode } : {}),
      };
      // The name the list shows (the one given at launch wins over a name Claude Code derived itself).
      const shown = view === undefined ? session : overlayOwned(session, view);
      const request = await parseLaunchBody({
        hostKind: 'stream-json',
        cwd: session.cwd,
        forkOf: session.sessionId,
        name: body.name ?? (body.atMessageId === undefined ? forkNameOf(shown.name ?? shown.folder) : forkNameOf(shown.name ?? shown.folder, 'thread of')),
        // A thread: the fork stops at this message (the core checks the shape; the daemon checks it is in the transcript and caps the live threads).
        ...(body.atMessageId === undefined ? {} : { resumeSessionAt: body.atMessageId }),
        ...(body.atMessageQuote === undefined ? {} : { forkedAtQuote: body.atMessageQuote }),
        ...(model === undefined ? {} : { model }),
        ...(permissionMode === undefined ? {} : { permissionMode }),
      });
      const forked = await source.daemon.launch({ ...request });
      return ok({ ok: true, session: toOwnedDto(forked), inherited } satisfies OwnedForkOk);
    }),
    { sensitive: true },
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
    { sensitive: true },
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
    { sensitive: true },
  );

  kit.route(
    'POST',
    '/owned/:id/stop',
    writing(async (req) => {
      const id = sessionIdOf(req);
      requireNoBody(req.body);
      return ok({ ok: true, session: toOwnedDto(await source.daemon.stop(id)) } satisfies OwnedSessionOk);
    }),
    { sensitive: true },
  );

  kit.route(
    'POST',
    '/owned/:id/resume',
    writing(async (req) => {
      const id = sessionIdOf(req);
      const acknowledge = parseResumeBody(req.body);
      return ok({ ok: true, session: toOwnedDto(await source.daemon.resume(id, acknowledge)) } satisfies OwnedSessionOk);
    }),
    { sensitive: true },
  );

  kit.route(
    'POST',
    '/owned/:id/forget',
    writing(async (req) => {
      const id = sessionIdOf(req);
      requireNoBody(req.body);
      const forgotten = await source.daemon.forget(id);
      return ok({ ok: true, id: forgotten.id, ...(forgotten.supervisorNote === undefined ? {} : { supervisorNote: forgotten.supervisorNote }) } satisfies OwnedForgetOk);
    }),
    // Sensitive since the bg host: forgetting a background session also removes it from the Claude Code supervisor (`claude rm`).
    { sensitive: true },
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
    { sensitive: true },
  );
}
