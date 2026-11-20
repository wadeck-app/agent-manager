import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultConfigDir, getErrorMessage, readSessionRegistry, resolveSessionsDir, type RegistryResult, type Session } from '@wadeck-app/agent-manager-core';
import {
  DEFAULT_REPLY_CONFIG,
  DELIVERED_AS_TEXT,
  MAX_TEXT_CHARS,
  MAX_UPLOAD_BYTES,
  ReplyError,
  createReplyService,
  readAudit,
  implementedTransports,
  readTransportsConfig,
  setDefaultTransport,
  setSessionTransport,
  type AuditRecord,
  type DeliveryRecord,
  type DeliveryStatus,
  type ReplyService,
  type ReplyTranscriptEntry,
  type ReplyTransport,
} from '@wadeck-app/agent-manager-core/reply';
import { readTail, resolveProjectsDir, transcriptPath, type Entry } from '@wadeck-app/agent-manager-core/transcript';
import type { DeliveryStateName, DeliveryUi, ReplyDefaultTransportSetOk, ReplyMessageDto, ReplyOk, ReplyRequest, ReplyResponse, ReplyStatusLimits, ReplyStatusOk, ReplyTransportSetOk, TransportStatusDto } from '../commons/api.js';
import { CodedRequestError, fail, shaped } from './apiError.js';
import type { DaemonApi } from './daemon/daemonApi.js';
import { ownedDeliveryStatus } from './daemon/ownedDelivery.js';
import { sessionFromOwned } from './daemon/ownedJoin.js';
import type { OwnedSource } from './daemon/ownedSource.js';
import { OWNED_TRANSPORT_ID, createOwnedTransport } from './daemon/ownedTransport.js';
import { findSession } from './sessionLookup.js';
import type { RouteAnswer, RouteKit } from './routeKit.js';
import { ok, queryValue } from './routeKit.js';

/** What a test (or a future caller) can replace; app-core calls the module with the context only. */
export interface ModuleOptions {
  /**
   * The transports the module offers. Default: the implemented ones (socket, hc) plus `owned` (see below). A list given here is used as it is, plus `owned`
   * only when `daemon` is given too (a test that lists its transports does not get one it did not ask for).
   */
  transports?: readonly ReplyTransport[];
  /** The client of the agent-manager daemon (owned sessions). Default: found like the CLI does (config folder, config.port, health_token). Tests give their own. */
  daemon?: DaemonApi;
}

/** Images of one reply. */
const MAX_IMAGES = 4;
/** App-core refuses a JSON body above this (decision 32): base64 adds a third, which is why one image is capped at MAX_UPLOAD_BYTES decoded. */
const MAX_BODY_BYTES = 1024 * 1024;
/** Replies listed by the status route. */
const STATUS_MESSAGES = 10;
/** How far back the status route looks for replies (the audit is read by day). */
const STATUS_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Bytes of the end of the transcript read to confirm deliveries. */
const CONFIRM_TAIL_BYTES = 256 * 1024;
const BODY_FIELDS = ['text', 'images', 'priority', 'confirmNow', 'messageId'] as const;

export const REPLY_LIMITS: ReplyStatusLimits = { maxTextChars: MAX_TEXT_CHARS, maxImages: MAX_IMAGES, maxImageBytes: MAX_UPLOAD_BYTES, maxBodyBytes: MAX_BODY_BYTES };

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The request body
// ---------------------------------------------------------------------------------------------------------------------------------------------------

const bad = (message: string, hint: string): never => {
  throw new CodedRequestError(400, 'bad-request', message, hint);
};

/** The body of the transport routes: {"transportId": "<id>"}; null clears the override of a session (`allowNull`). */
function parseTransportBody(body: unknown, allowNull: boolean): string | null {
  const example = allowNull ? '{"transportId": "hc"} or {"transportId": null} to follow the default again' : '{"transportId": "hc"}';
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return bad('The body must be a JSON object', `Send ${example} with Content-Type: application/json.`);
  }
  const extra = Object.keys(body).filter((key) => key !== 'transportId');
  if (extra.length > 0) {
    bad(`Unknown field(s) in the body: ${extra.map((key) => `'${key.slice(0, 40)}'`).join(', ')}`, `The only field is transportId, e.g. ${example}.`);
  }
  const transportId: unknown = Reflect.get(body, 'transportId');
  if (transportId === null && allowNull) {
    return null;
  }
  if (typeof transportId !== 'string' || transportId === '') {
    return bad(`'transportId' must be a transport id (a non-empty string)${allowNull ? ' or null' : ''}, got ${transportId === undefined ? 'nothing' : JSON.stringify(transportId)?.slice(0, 40)}`, `Send ${example}; GET /sessions/:sessionId/reply/status lists the ids.`);
  }
  return transportId;
}

function parseBody(body: unknown): ReplyRequest {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return bad('The body must be a JSON object', `Send {"text": "..."} with Content-Type: application/json (optional: images, priority, confirmNow, messageId).`);
  }
  const extra = Object.keys(body).filter((key) => !(BODY_FIELDS as readonly string[]).includes(key));
  if (extra.length > 0) {
    const transportHint = extra.some((key) => key.toLowerCase().includes('transport')) ? ' A reply has no transport field: the transport is chosen in transports.json with PUT /sessions/:sessionId/reply/transport or PUT /reply/transport/default (or: agent-manager transport set).' : '';
    bad(`Unknown field(s) in the body: ${extra.map((key) => `'${key.slice(0, 40)}'`).join(', ')}`, `The fields are ${BODY_FIELDS.join(', ')}.${transportHint}`);
  }
  const text: unknown = Reflect.get(body, 'text');
  if (typeof text !== 'string') {
    bad(`'text' must be a string, got ${text === undefined ? 'nothing' : typeof text}`, `Send {"text": "..."}; it may be empty when an image is attached.`);
  }
  const request: ReplyRequest = { text: text as string };
  const images: unknown = Reflect.get(body, 'images');
  if (images !== undefined) {
    if (!Array.isArray(images) || images.length > MAX_IMAGES) {
      bad(`'images' must be an array of at most ${MAX_IMAGES} images`, `Each image is {"name": "...", "mime": "image/png", "dataBase64": "..."}.`);
    }
    request.images = (images as unknown[]).map((image, index) => {
      if (image === null || typeof image !== 'object' || Array.isArray(image)) {
        return bad(`images[${index}] must be an object`, `Each image is {"name": "...", "mime": "image/png", "dataBase64": "..."}.`);
      }
      const name: unknown = Reflect.get(image, 'name');
      const mime: unknown = Reflect.get(image, 'mime');
      const data: unknown = Reflect.get(image, 'dataBase64');
      if (typeof name !== 'string' || name.length > 200 || typeof mime !== 'string' || typeof data !== 'string') {
        return bad(`images[${index}] needs the text fields name (at most 200 characters), mime and dataBase64`, `Each image is {"name": "...", "mime": "image/png", "dataBase64": "..."}.`);
      }
      return { name, mime, dataBase64: data };
    });
  }
  const priority: unknown = Reflect.get(body, 'priority');
  if (priority !== undefined) {
    if (priority !== 'next' && priority !== 'now') {
      bad(`'priority' must be "next" or "now", got ${JSON.stringify(priority)?.slice(0, 40)}`, `Use "next" (default); "now" aborts the running tool call and needs confirmNow: true.`);
    }
    request.priority = priority as 'next' | 'now';
  }
  const confirmNow: unknown = Reflect.get(body, 'confirmNow');
  if (confirmNow !== undefined) {
    if (typeof confirmNow !== 'boolean') {
      bad(`'confirmNow' must be true or false`, `Send true only after the user confirmed that the running tool call may be aborted.`);
    }
    request.confirmNow = confirmNow as boolean;
  }
  const messageId: unknown = Reflect.get(body, 'messageId');
  if (messageId !== undefined) {
    if (typeof messageId !== 'string') {
      bad(`'messageId' must be a string`, `Use letters, digits, '_' and '-' (up to 128), or leave it out.`);
    }
    request.messageId = messageId as string;
  }
  return request;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/** What the composer shows for a delivery state. 'unconfirmed' and 'expired' show as failed: the raw state and its hint stay in the answer. */
export function deliveryUiOf(state: DeliveryStateName | 'failed'): DeliveryUi {
  switch (state) {
    case 'queued':
      return 'sending';
    case 'sent':
    case 'queued-in-session':
      return 'delivered';
    case 'confirmed':
      return 'seen';
    case 'unconfirmed':
    case 'expired':
    case 'failed':
      return 'failed';
    default:
      throw new Error(`Unknown delivery state ${String(state)}`);
  }
}

/** HTTP status of a reply error: what the user can fix in the request is 400, a missing or dead session 404 / 409, the rest (transport, config, disk) 502. */
function statusOfReplyError(code: string): number {
  if (code === 'unknown-session') {
    return 404;
  }
  // The last six are the codes of the daemon (owned transport): a state conflict, not a gateway failure.
  const conflicts = ['session-dead', 'registry-unreadable', 'terminal-blocked', 'no-terminal', 'ambiguous-terminal', 'terminal-gone', 'daemon-not-running', 'not-owned', 'session-not-live', 'session-exited', 'session-closing', 'host-stopping', 'outcome-unknown'];
  if (conflicts.includes(code)) {
    return 409;
  }
  if (code === 'rate-limited') {
    return 429;
  }
  const request = ['text-too-long-for-hc', 'invalid-id', 'invalid-priority', 'confirm-now-required', 'invalid-text', 'text-too-long', 'empty-reply', 'empty-image', 'invalid-base64', 'upload-too-large', 'unsupported-image', 'mime-mismatch', 'invalid-index', 'invalid-image-path'];
  return request.includes(code) ? 400 : 502;
}

/** `status`: overrides the status of the code (a PUT with an unknown transport id is the caller's mistake, a transports.json that names one is a configuration error). */
function replyFailure(error: ReplyError, status?: number): RouteAnswer {
  const audit = (error as { auditError?: { message: string; fix: string } }).auditError;
  const sizeHint = error.code === 'upload-too-large' ? ` The request body is limited to 1 MiB of JSON (base64 adds a third): keep each image under ${Math.floor(MAX_UPLOAD_BYTES / 1024)} KB and the whole reply under 1 MiB.` : '';
  return fail(status ?? statusOfReplyError(error.code), error.code, `${error.reason}${audit === undefined ? '' : ` (${audit.message})`}`, `${error.fix}${sizeHint}`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * Which transport a session uses when nobody chose one (after the per-session override of transports.json, before its global default): an owned stream-json
 * session uses `owned`. When the daemon cannot be asked, the host kind of the last successful list decides, so that the answer is "the daemon is not running"
 * (the probe of `owned` says so) and not the unrelated refusal of another transport.
 * It NEVER throws (the reply service would fail the whole send or status): a failure is "no preference" and is recorded in `problems` (by session id), which the
 * status route shows as a warning.
 */
export function createPreferredTransport(owned: OwnedSource, problems: Map<string, string>): (session: Session) => Promise<string | undefined> {
  return async (session) => {
    try {
      const found = await owned.find(session.sessionId);
      const host = found.ok ? found.view?.hostKind : owned.lastKnownHost(session.sessionId);
      problems.delete(session.sessionId);
      return host === 'stream-json' ? OWNED_TRANSPORT_ID : undefined;
    } catch (error) {
      problems.set(session.sessionId, `Whether this session is owned by the daemon could not be decided (${getErrorMessage(error)}): the default transport is shown. This is a bug of the module, report it.`);
      return undefined;
    }
  };
}

/** One service per config folder: it remembers the ids it sent (no double send on a retry), so it lives as long as the module. */
function serviceFactory(options: ModuleOptions, owned: OwnedSource, problems: Map<string, string>): () => { service: ReplyService; configDir: string; transports: readonly ReplyTransport[] } {
  const given = options.transports ?? implementedTransports;
  const withOwned = options.transports === undefined || options.daemon !== undefined;
  const transports = withOwned && !given.some((transport) => transport.id === OWNED_TRANSPORT_ID) ? [...given, createOwnedTransport(owned)] : given;
  const askOwned = createPreferredTransport(owned, problems);
  const preferredTransport = (session: Session): Promise<string | undefined> => (transports.some((transport) => transport.id === OWNED_TRANSPORT_ID) ? askOwned(session) : Promise.resolve(undefined));
  // The registry sessions plus the owned live ones that have no registry file yet (a stream-json child writes it with its first message).
  const readSessions = async (): Promise<RegistryResult> => {
    const registry = await readSessionRegistry(resolveSessionsDir(process.env));
    if (!registry.ok) {
      return registry;
    }
    const listed = await owned.list();
    if (!listed.ok) {
      return registry;
    }
    const now = Date.now();
    const known = new Set(registry.sessions.map((session) => session.sessionId.toLowerCase()));
    const pending = listed.sessions.filter((view) => !known.has(view.id.toLowerCase()) && view.status === 'live').map((view) => sessionFromOwned(view, now));
    return pending.length === 0 ? registry : { ...registry, sessions: [...registry.sessions, ...pending] };
  };
  let current: { service: ReplyService; configDir: string; transports: readonly ReplyTransport[] } | undefined;
  return () => {
    const configDir = defaultConfigDir(process.env);
    if (current === undefined || current.configDir !== configDir) {
      current = {
        configDir,
        transports,
        service: createReplyService({ configDir, transports, readSessions, preferredTransport, config: DEFAULT_REPLY_CONFIG }),
      };
    }
    return current;
  };
}

function toTranscriptEntry(entry: Entry): ReplyTranscriptEntry {
  const timestamp = entry.kind === 'tool-call' ? (entry.startedAt ?? entry.timestamp) : entry.timestamp;
  const base = timestamp === undefined ? {} : { timestamp };
  switch (entry.kind) {
    case 'user-prompt':
      return { type: 'user', ...base, message: { content: entry.text }, ...(entry.originKind === undefined && entry.originMsgId === undefined ? {} : { origin: { ...(entry.originKind === undefined ? {} : { kind: entry.originKind }), ...(entry.originMsgId === undefined ? {} : { msg_id: entry.originMsgId }) } }) };
    case 'queue-operation':
      return { type: 'queue-operation', operation: entry.operation, content: entry.contentPreview ?? '', ...base };
    case 'assistant-text':
    case 'thinking':
    case 'tool-call':
      return { type: 'assistant', ...base };
    case 'system-notice':
    case 'usage':
    case 'fork-ref':
    case 'unknown':
    case 'unparsable':
    case 'oversize':
      return { type: entry.kind, ...base };
    default:
      throw new Error(`Unknown transcript entry kind ${String((entry as { kind: unknown }).kind)}`);
  }
}

/** Warns about settings the module does not read yet, instead of ignoring them silently. */
async function configWarnings(configDir: string): Promise<string[]> {
  const file = join(configDir, 'config.yml');
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? [] : [`${file} cannot be read (${getErrorMessage(error)}): the delivery settings are the defaults.`];
  }
  return /^\s*(confirmationWindow|hintAfter|mailboxExpiry)\s*:/m.test(text)
    ? [`${file} sets delivery options (confirmationWindow, hintAfter or mailboxExpiry): the module does not read them yet, the defaults apply (no confirmation timeout, hint after 15 s, mailbox expiry 15 min).`]
    : [];
}

async function messagesOf(session: Session, service: ReplyService, configDir: string, transports: readonly ReplyTransport[], owned: OwnedSource, warnings: string[]): Promise<ReplyMessageDto[]> {
  const now = Date.now();
  let records: AuditRecord[] = [];
  try {
    const audit = await readAudit(configDir, { limit: STATUS_MESSAGES, sinceMs: now - STATUS_WINDOW_MS, sessionId: session.sessionId });
    records = audit.records;
    if (audit.unreadable.length > 0) {
      warnings.push(`${audit.unreadable.length} line(s) of the reply audit could not be read (${audit.unreadable.map((line) => `${line.file}:${line.line}`).join(', ')}): some replies are not listed.`);
    }
  } catch (error) {
    warnings.push(`The reply audit cannot be read (${getErrorMessage(error)}): the delivery states are not shown. Check the permissions of ${join(configDir, 'audit')}.`);
    return [];
  }
  let transcript: ReplyTranscriptEntry[] = [];
  if (records.some((record) => record.outcome === 'sent')) {
    const located = await transcriptPath(session.cwd, session.sessionId, resolveProjectsDir(process.env));
    if (!located.ok) {
      const { message } = located.error;
      warnings.push(`The transcript of the session was not found, so deliveries cannot be confirmed: ${message}`);
    } else {
      const tail = await readTail(located.path, { bytes: CONFIRM_TAIL_BYTES });
      if (tail.error !== undefined) {
        const { message, hint } = tail.error;
        warnings.push(`The transcript cannot be read, so deliveries cannot be confirmed: ${message} ${hint}`);
      } else {
        transcript = tail.entries.map(toTranscriptEntry);
      }
    }
  }
  // The daemon knows how its own messages went (command_lifecycle): asked once, only when a reply of the owned transport is listed.
  const ownedSent = records.some((record) => record.outcome === 'sent' && record.transport === OWNED_TRANSPORT_ID);
  const ownedView = ownedSent ? await owned.find(session.sessionId) : undefined;
  if (ownedView !== undefined && !ownedView.ok) {
    const { message, hint } = ownedView.error;
    warnings.push(`The daemon cannot be asked, so the replies sent through the owned transport are confirmed from the transcript only: ${message}. ${hint}`);
  }
  // Oldest first, so that two identical replies ("ok", "ok") each claim their own transcript line.
  const claimed = new Set<ReplyTranscriptEntry>();
  const ownedStatuses = new Map<string, DeliveryStatus | undefined>();
  for (const record of [...records].reverse()) {
    if (record.outcome === 'sent' && record.transport === OWNED_TRANSPORT_ID) {
      const uuid = owned.deliveryOf(record.msgId)?.uuid;
      const daemonMessage = uuid === undefined || ownedView === undefined || !ownedView.ok ? undefined : ownedView.view?.messages.find((message) => message.uuid === uuid);
      ownedStatuses.set(record.msgId, ownedDeliveryStatus(record, daemonMessage, transcript, claimed));
    }
  }
  return records.map((record): ReplyMessageDto => {
    const common = { messageId: record.msgId, sentAt: record.time, text: record.text, imageCount: record.imagePaths.length, transportId: record.transport, priority: record.priority };
    // A send whose outcome is not known (timeout, lost connection): not a failure to retry, the message may have arrived.
    if (record.outcome.startsWith('maybe-sent')) {
      return { ...common, state: 'unconfirmed', ui: 'failed', reason: record.outcome, hint: 'The message may have been delivered. Check the log of the session before sending it again.' };
    }
    if (record.outcome !== 'sent') {
      return { ...common, state: 'failed', ui: 'failed', reason: record.outcome, hint: '' };
    }
    const kind = transports.find((transport) => transport.id === record.transport)?.kind ?? 'direct';
    const delivery: DeliveryRecord = { id: record.msgId, sessionId: record.sessionId, state: kind === 'mailbox' ? 'queued' : 'sent', transportId: record.transport, kind, sentAt: record.time, priority: record.priority };
    let status = ownedStatuses.get(record.msgId);
    status ??= service.deliveryState(delivery, transcript, { sessionStatus: session.statusGroup });
    return { ...common, state: status.state, ui: deliveryUiOf(status.state), reason: status.reason, hint: status.hint ?? '' };
  });
}

export function registerReplyRoutes(kit: RouteKit, options: ModuleOptions, owned: OwnedSource): void {
  const preferenceProblems = new Map<string, string>();
  const services = serviceFactory(options, owned, preferenceProblems);

  kit.route(
    'POST',
    '/sessions/:sessionId/reply',
    shaped(async (req) => {
      const request = parseBody(req.body);
      const found = await findSession(req.params?.['sessionId'], owned);
      if ('registryError' in found) {
        return fail(409, 'registry-unreadable', `The session registry cannot be read: ${found.registryError.message}`, found.registryError.hint);
      }
      const { session } = found;
      const { service, transports } = services();
      // An owned stream-json session whose process ended: "start a new session" (the answer of a dead registry entry) would be wrong, it can be resumed.
      const ownedFound = await owned.find(session.sessionId);
      if (ownedFound.ok && ownedFound.view?.hostKind === 'stream-json' && (ownedFound.view.state === 'exited' || ownedFound.view.state === 'interrupted')) {
        const { view } = ownedFound;
        return fail(409, 'owned-session-ended', `The owned session ${session.sessionId} is ${view.state}: ${view.state === 'interrupted' ? 'the daemon that owned it ended while it was live and its claude process ended with it' : 'its claude process ended'}`, 'Resume it (POST /owned/:id/resume): the conversation continues, the turn that was lost is not replayed. Then send the reply again.');
      }
      try {
        const record = await service.send({
          sessionId: session.sessionId,
          text: request.text,
          images: (request.images ?? []).map((image) => ({ base64: image.dataBase64, declaredMime: image.mime })),
          ...(request.priority === undefined ? {} : { priority: request.priority }),
          ...(request.confirmNow === undefined ? {} : { confirmNow: request.confirmNow }),
          ...(request.messageId === undefined ? {} : { id: request.messageId }),
          origin: 'web',
        });
        const body: ReplyOk = {
          ok: true,
          deliveryState: record.state,
          deliveryUi: deliveryUiOf(record.state),
          transportId: record.transportId,
          deliveredAs: transports.find((transport) => transport.id === record.transportId)?.deliveredAs ?? 'peer',
          handle: record.handle ?? '',
          messageId: record.id,
          duplicate: record.duplicate === true,
          auditWarning: record.auditError === undefined ? '' : `${record.auditError.message}. ${record.auditError.fix}`,
          imagesSaved: request.images?.length ?? 0,
        };
        return ok(body satisfies ReplyResponse);
      } catch (error) {
        if (error instanceof ReplyError) {
          // The service does not see an owned session when the daemon cannot be asked: say that (and the fix) instead of a bare "no such session".
          if (error.code === 'unknown-session') {
            const listed = await owned.list();
            if (!listed.ok) {
              const { code, message, hint } = listed.error;
              return fail(409, code, `${error.reason}; the agent-manager daemon cannot be asked, so a session it owns is not known: ${message}`, hint);
            }
          }
          return replyFailure(error);
        }
        throw error;
      }
    }),
    { sensitive: true },
  );

  // The transport is a setting of transports.json (decision 19), never a field of a reply: the same file is read by the CLI (agent-manager transport).
  kit.route(
    'PUT',
    '/sessions/:sessionId/reply/transport',
    shaped(async (req) => {
      const transportId = parseTransportBody(req.body, true);
      const found = await findSession(req.params?.['sessionId'], owned);
      if ('registryError' in found) {
        return fail(409, 'registry-unreadable', `The session registry cannot be read: ${found.registryError.message}`, found.registryError.hint);
      }
      const { session } = found;
      const { configDir, transports } = services();
      try {
        const config = await setSessionTransport(configDir, session.sessionId, transportId, transports.map((transport) => transport.id));
        const body: ReplyTransportSetOk = {
          ok: true,
          sessionId: session.sessionId,
          selectedTransportId: config.perSession[session.sessionId] ?? config.default,
          sessionOverrideTransportId: config.perSession[session.sessionId] ?? null,
          defaultTransportId: config.default,
        };
        return ok(body);
      } catch (error) {
        if (error instanceof ReplyError) {
          return replyFailure(error, error.code === 'unknown-transport' || error.code === 'invalid-id' ? 400 : undefined);
        }
        throw error;
      }
    }),
  );

  kit.route(
    'PUT',
    '/reply/transport/default',
    shaped(async (req) => {
      const transportId = parseTransportBody(req.body, false);
      const { configDir, transports } = services();
      try {
        const config = await setDefaultTransport(configDir, transportId as string, transports.map((transport) => transport.id));
        const body: ReplyDefaultTransportSetOk = { ok: true, defaultTransportId: config.default };
        return ok(body);
      } catch (error) {
        if (error instanceof ReplyError) {
          return replyFailure(error, error.code === 'unknown-transport' ? 400 : undefined);
        }
        throw error;
      }
    }),
  );

  kit.route(
    'GET',
    '/sessions/:sessionId/reply/status',
    shaped(async (req) => {
      const found = await findSession(req.params?.['sessionId'], owned);
      if ('registryError' in found) {
        return fail(200, 'registry-unreadable', `The session registry cannot be read: ${found.registryError.message}`, found.registryError.hint);
      }
      const { session } = found;
      const { service, configDir, transports } = services();
      const warnings: string[] = await configWarnings(configDir);
      try {
        const config = await readTransportsConfig(configDir);
        // Only the selected transport is probed on a plain poll (an hc probe spawns one process per terminal); ?probe=all is what the transport menu sends when it opens.
        const [status] = await service.getTransportStatus([session], { probe: queryValue(req.query, 'probe') === 'all' ? 'all' : 'selected' });
        const preferenceProblem = preferenceProblems.get(session.sessionId);
        if (preferenceProblem !== undefined) {
          warnings.push(preferenceProblem);
        }
        if (status === undefined) {
          return fail(200, 'transport-status-empty', 'The reply service returned no transport status', 'Report this: it is a bug of the module.');
        }
        const hasFile = await stat(join(configDir, 'transports.json')).then(
          () => true,
          () => false,
        );
        const preferredOwned = config.perSession[session.sessionId] === undefined && status.selectedTransportId === OWNED_TRANSPORT_ID && config.default !== OWNED_TRANSPORT_ID;
        const selectedFrom = config.perSession[session.sessionId] !== undefined ? 'transports.json (session override)' : preferredOwned ? 'owned session (default for sessions launched by agent-manager)' : hasFile ? 'transports.json' : 'default';
        const list = status.transports.map((entry): TransportStatusDto => {
          const probeWarnings: unknown = entry.probe.details['warnings'];
          return {
            transportId: entry.transportId,
            description: entry.description,
            kind: entry.kind,
            probed: entry.probed,
            available: entry.probe.available,
            reason: entry.probe.reason,
            fix: entry.probe.fix,
            warnings: Array.isArray(probeWarnings) ? probeWarnings.filter((warning): warning is string => typeof warning === 'string') : [],
            selected: entry.transportId === status.selectedTransportId,
            isDefault: entry.transportId === status.defaultTransportId,
            sessionOverride: entry.transportId === status.sessionOverrideTransportId,
            deliveredAs: entry.deliveredAs,
            deliveredAsText: DELIVERED_AS_TEXT[entry.deliveredAs],
          };
        });
        if (!list.some((entry) => entry.selected)) {
          warnings.push(`The selected transport '${status.selectedTransportId}' (${selectedFrom}) is not one the module offers (${list.map((entry) => entry.transportId).join(', ')}): replies fail until ${join(configDir, 'transports.json')} names one of them.`);
        }
        const messages = await messagesOf(session, service, configDir, transports, owned, warnings);
        const body: ReplyStatusOk = { ok: true, sessionId: session.sessionId, sessionAlive: session.alive, selectedFrom, selectedTransportId: status.selectedTransportId, defaultTransportId: status.defaultTransportId, sessionOverrideTransportId: status.sessionOverrideTransportId, transports: list, messages, warnings, limits: REPLY_LIMITS };
        return ok(body);
      } catch (error) {
        if (error instanceof ReplyError) {
          return fail(200, error.code, error.reason, error.fix);
        }
        throw error;
      }
    }),
  );
}
