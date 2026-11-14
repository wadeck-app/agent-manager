import { randomUUID } from 'node:crypto';
import * as realFs from 'node:fs/promises';
import { getErrorMessage } from '../errors.js';
import { readSessionRegistry } from '../readSessionRegistry.js';
import type { RegistryResult, Session } from '../session.js';
import { appendAudit, findSentInAudit } from './audit.js';
import { assertTextLength, composeMessageText } from './compose.js';
import { DEFAULT_REPLY_CONFIG, readTransportsConfig } from './config.js';
import type { ReplyConfig } from './config.js';
import { deliveryState } from './deliveryState.js';
import type { DeliveryContext, DeliveryRecord, DeliveryStatus, ReplyTranscriptEntry } from './deliveryState.js';
import { ReplyError, assertSafeId } from './errors.js';
import { errorCode } from './fsTypes.js';
import type { ReplyFs } from './fsTypes.js';
import { saveUpload } from './uploads.js';
import { DEFAULT_PRIORITY, REPLY_PRIORITIES } from './types.js';
import type { ProbeContext, ProbeResult, ReplyPriority, ReplyTransport } from './types.js';

export interface ReplyImage {
  base64: string;
  declaredMime?: string;
}

export interface SendRequest {
  sessionId: string;
  text: string;
  images?: readonly ReplyImage[];
  /** Explicit transport id: wins over the per-session override and the global default. */
  transportId?: string;
  /** Default 'next'. */
  priority?: ReplyPriority;
  /** Must be true for priority 'now': it aborts the tool call that is running in the session (measured, n=1). */
  confirmNow?: boolean;
  /** The message id. Give the same id on a retry: the same id never sends twice. Default: a new UUID. */
  id?: string;
  /** Default 'web'. */
  origin?: string;
}

export interface ReplyServiceDeps {
  configDir: string;
  /** Every transport the service can use. Ids must be unique. */
  transports: readonly ReplyTransport[];
  /** The registry read. Default: readSessionRegistry(sessionsDir). Give `sessionsDir` or `readSessions`. */
  sessionsDir?: string;
  readSessions?: () => Promise<RegistryResult>;
  /** Default: Date.now. */
  clock?: () => number;
  fs?: ReplyFs;
  config?: ReplyConfig;
  newId?: () => string;
  /** Size cap of the in-memory sent ids (LRU). Default 1000. The audit file is the durable dedupe. */
  maxSentEntries?: number;
}

const DEFAULT_MAX_SENT_ENTRIES = 1000;
const SENT_MAX_AGE_MS = 24 * 60 * 60_000;

interface SentEntry {
  promise: Promise<DeliveryRecord>;
  at: number;
  settled: boolean;
}

export interface TransportStatusEntry {
  transportId: string;
  description: string;
  kind: string;
  probe: ProbeResult;
}

export interface SessionTransportStatus {
  sessionId: string;
  /** The transport a send would use without an explicit choice. */
  selectedTransportId: string;
  transports: TransportStatusEntry[];
}

export interface ReplyService {
  send(request: SendRequest): Promise<DeliveryRecord>;
  deliveryState(record: DeliveryRecord, transcriptEntries: readonly ReplyTranscriptEntry[], context?: DeliveryContext): DeliveryStatus;
  getTransportStatus(sessions: readonly Session[], options?: { permissionModes?: Record<string, string> }): Promise<SessionTransportStatus[]>;
}

/** Builds the reply service (see send). Every dependency is injected so that nothing in it touches a real session in tests. */
export function createReplyService(deps: ReplyServiceDeps): ReplyService {
  const fs = deps.fs ?? realFs;
  const clock = deps.clock ?? Date.now;
  const config = deps.config ?? DEFAULT_REPLY_CONFIG;
  const newId = deps.newId ?? randomUUID;
  const byId = new Map<string, ReplyTransport>();
  for (const transport of deps.transports) {
    if (byId.has(transport.id)) {
      throw new ReplyError('duplicate-transport', `two transports have the id '${transport.id}'`, 'give each transport a unique id');
    }
    byId.set(transport.id, transport);
  }
  const readSessions = deps.readSessions ?? (async (): Promise<RegistryResult> => {
    if (deps.sessionsDir === undefined) {
      throw new ReplyError('no-registry', 'the reply service has no way to read the session registry', 'pass sessionsDir or readSessions to createReplyService');
    }
    return readSessionRegistry(deps.sessionsDir);
  });
  // In-flight and finished sends of this process, by message id. A promise is stored so that two concurrent sends of one id cannot both go out.
  const sent = new Map<string, SentEntry>();
  const maxSent = deps.maxSentEntries ?? DEFAULT_MAX_SENT_ENTRIES;

  function transportById(id: string): ReplyTransport {
    const transport = byId.get(id);
    if (transport === undefined) {
      throw new ReplyError('unknown-transport', `there is no reply transport '${id}' (known: ${[...byId.keys()].join(', ')})`, 'choose one of the known transports');
    }
    return transport;
  }

  async function chooseTransport(sessionId: string, explicit: string | undefined): Promise<ReplyTransport> {
    if (explicit !== undefined) {
      return transportById(explicit);
    }
    const transports = await readTransportsConfig(deps.configDir, fs);
    return transportById(transports.perSession[sessionId] ?? transports.default);
  }

  async function findLiveSession(sessionId: string): Promise<Session> {
    const registry = await readSessions();
    if (!registry.ok) {
      const { message, hint } = registry.error;
      throw new ReplyError('registry-unreadable', message, hint);
    }
    const session = registry.sessions.find((candidate) => candidate.sessionId === sessionId);
    if (session === undefined) {
      throw new ReplyError('unknown-session', `no session ${sessionId} in the Claude Code registry`, 'refresh the session list; the session probably ended');
    }
    if (!session.alive) {
      throw new ReplyError('session-dead', `the session ${sessionId} is not running (its registry entry is stale)`, 'start a new session; the stale entry disappears by itself');
    }
    return session;
  }

  async function doSend(request: SendRequest, id: string, priority: ReplyPriority): Promise<DeliveryRecord> {
    const images = request.images ?? [];
    const origin = request.origin ?? 'web';
    const audit = (transport: string, outcome: string, imagePaths: string[]): Promise<void> =>
      appendAudit(deps.configDir, { sessionId: request.sessionId, time: clock(), text: request.text, imagePaths, transport, priority, outcome, msgId: id }, fs);
    let transportId = request.transportId ?? '?';
    // Files saved for this message so far; removed again when the message is not sent.
    const imagePaths: string[] = [];
    try {
      const session = await findLiveSession(request.sessionId);
      const transport = await chooseTransport(request.sessionId, request.transportId);
      transportId = transport.id;
      // No silent fallback: an unavailable transport is an error naming the probe's reason and fix.
      const probe = await transport.probe(session);
      if (!probe.available) {
        throw new ReplyError('transport-unavailable', `the '${transport.id}' transport is not available for this session: ${probe.reason}`, probe.fix);
      }
      for (const [index, image] of images.entries()) {
        const saved = await saveUpload({ configDir: deps.configDir, sessionId: request.sessionId, msgId: id, index, base64: image.base64, declaredMime: image.declaredMime, fs });
        imagePaths.push(saved.path);
      }
      const text = composeMessageText({ text: request.text, imagePaths, id });
      const result = await transport.send(session, { id, text, imagePaths, priority, origin });
      if (!result.accepted) {
        throw new ReplyError('transport-refused', `the '${transport.id}' transport did not accept the message (${result.detail})`, 'switch transport or retry');
      }
      const record: DeliveryRecord = { id, sessionId: request.sessionId, state: transport.kind === 'mailbox' ? 'queued' : 'sent', transportId: transport.id, kind: transport.kind, sentAt: result.sentAt, priority };
      // The message is delivered from here on: a failing audit write is reported on the record, never thrown (a throw would free the id for a second send).
      try {
        await audit(transport.id, 'sent', imagePaths);
      } catch (auditError) {
        record.auditError = { message: `the message was delivered but its audit record could not be written: ${getErrorMessage(auditError)}`, fix: 'check the permissions and free space of the audit folder; do not send this message again' };
      }
      return record;
    } catch (caught) {
      let error: unknown = caught;
      const leftovers = await removeUploads(imagePaths);
      if (leftovers !== undefined) {
        error = error instanceof ReplyError
          ? Object.assign(new ReplyError(error.code, `${error.reason} (and ${leftovers})`, error.fix), { cause: error })
          : new ReplyError('upload-cleanup-failed', `${getErrorMessage(error)} (and ${leftovers})`, 'delete the listed files by hand');
      }
      const outcome = `${error instanceof ReplyError && (error.code === 'transport-unavailable' || error.code === 'unknown-session' || error.code === 'session-dead') ? 'refused' : 'failed'}: ${getErrorMessage(error)}`;
      // The failure itself is the answer: a failing audit write must not hide it or change its code; it is attached as `auditError`.
      try {
        await audit(transportId, outcome, []);
      } catch (auditError) {
        if (error instanceof Error) {
          Object.assign(error, { auditError: { message: `the audit record of this failure could not be written: ${getErrorMessage(auditError)}`, fix: 'check the permissions and free space of the audit folder' } });
        } else {
          error = new ReplyError('send-failed', `${getErrorMessage(error)} (and the audit record could not be written: ${getErrorMessage(auditError)})`, 'check the permissions of the audit folder');
        }
      }
      throw error;
    }
  }

  /** Removes the files saved for a message that was not sent. Returns a sentence naming what could not be removed, or undefined when all is gone. */
  async function removeUploads(paths: readonly string[]): Promise<string | undefined> {
    const failures: string[] = [];
    for (const path of paths) {
      try {
        await fs.unlink(path);
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') {
          failures.push(`${path} (${getErrorMessage(error)})`);
        }
      }
    }
    return failures.length === 0 ? undefined : `the uploaded files of this message could not be removed: ${failures.join('; ')}`;
  }

  async function send(request: SendRequest): Promise<DeliveryRecord> {
    assertSafeId('session id', request.sessionId);
    const id = request.id ?? newId();
    assertSafeId('message id', id);
    const priority = request.priority ?? DEFAULT_PRIORITY;
    if (!REPLY_PRIORITIES.includes(priority)) {
      throw new ReplyError('invalid-priority', `the priority must be one of ${REPLY_PRIORITIES.join(', ')}, got ${JSON.stringify(priority)}`, 'use now, next or later');
    }
    if (priority === 'now' && request.confirmNow !== true) {
      throw new ReplyError('confirm-now-required', "priority 'now' aborts the tool call the session is running (measured)", "ask the user to confirm, then send again with confirmNow: true, or use priority 'next'");
    }
    if (typeof request.text !== 'string') {
      throw new ReplyError('invalid-text', 'the reply text must be a string', 'send the text as a string');
    }
    assertTextLength(request.text);

    const now = clock();
    const earlier = sent.get(id);
    if (earlier !== undefined && !(earlier.settled && now - earlier.at > SENT_MAX_AGE_MS)) {
      // Most recently used goes last (LRU order).
      sent.delete(id);
      sent.set(id, earlier);
      return { ...(await earlier.promise), duplicate: true };
    }
    // Registered synchronously (no await before it) so that a concurrent call with this id finds it; a failed send is forgotten so that a retry is possible.
    const attempt = (async (): Promise<DeliveryRecord> => {
      const fromAudit = await findSentInAudit(deps.configDir, id, fs);
      if (fromAudit !== undefined) {
        const transport = byId.get(fromAudit.transport);
        return { id, sessionId: fromAudit.sessionId, state: transport?.kind === 'mailbox' ? 'queued' : 'sent', transportId: fromAudit.transport, kind: transport?.kind ?? 'direct', sentAt: fromAudit.time, priority: fromAudit.priority, duplicate: true };
      }
      return doSend(request, id, priority);
    })();
    const entry: SentEntry = { promise: attempt, at: now, settled: false };
    sent.set(id, entry);
    // Only a failed send (nothing was sent) is forgotten; a successful one stays, even when its audit write failed.
    attempt.then(
      () => {
        entry.settled = true;
        evictSent(now);
      },
      () => {
        if (sent.get(id) === entry) {
          sent.delete(id);
        }
      },
    );
    return attempt;
  }

  // Keeps the map bounded: drops settled entries older than 24 h, then the least recently used settled ones above the cap. The audit file stays the durable dedupe.
  function evictSent(now: number): void {
    for (const [key, entry] of sent) {
      if (entry.settled && now - entry.at > SENT_MAX_AGE_MS) {
        sent.delete(key);
      }
    }
    for (const [key, entry] of sent) {
      if (sent.size <= maxSent) {
        break;
      }
      if (entry.settled) {
        sent.delete(key);
      }
    }
  }

  async function getTransportStatus(sessions: readonly Session[], options: { permissionModes?: Record<string, string> } = {}): Promise<SessionTransportStatus[]> {
    const transportsConfig = await readTransportsConfig(deps.configDir, fs);
    return Promise.all(
      sessions.map(async (session) => {
        const context: ProbeContext = {};
        const mode = options.permissionModes?.[session.sessionId];
        if (mode !== undefined) {
          context.permissionMode = mode;
        }
        const transports = await Promise.all(
          [...byId.values()].map(async (transport): Promise<TransportStatusEntry> => {
            let probe: ProbeResult;
            try {
              probe = await transport.probe(session, context);
            } catch (error) {
              probe = { available: false, reason: `the probe itself failed: ${getErrorMessage(error)}`, fix: 'report this: probe() must not throw', details: {} };
            }
            return { transportId: transport.id, description: transport.describe(), kind: transport.kind, probe };
          }),
        );
        return { sessionId: session.sessionId, selectedTransportId: transportsConfig.perSession[session.sessionId] ?? transportsConfig.default, transports };
      }),
    );
  }

  return {
    send,
    deliveryState: (record, entries, context) => deliveryState(record, entries, clock(), config, context),
    getTransportStatus,
  };
}
