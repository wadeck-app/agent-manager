import { randomBytes } from 'node:crypto';
import { getErrorMessage } from '../../errors.js';
import { isPidAlive } from '../../pidAlive.js';
import { LaunchError } from '../errors.js';
import { HcLauncher } from '../HcLauncher.js';
import type { HcLaunchRequest, HcLaunchResult } from '../HcLauncher.js';
import { StreamJsonSession } from '../StreamJsonSession.js';
import type { StreamJsonSessionOptions } from '../StreamJsonSession.js';
import type { ExitInfo, InterruptReceipt, PendingPermission, SessionEvent } from '../types.js';
import { readClaudeVersion } from './claudeVersion.js';
import { EventLog } from './EventLog.js';
import { appendHostAudit } from './hostAudit.js';
import type { HostAuditAction } from './hostAudit.js';
import { describeLeftover, findLeftovers } from './leftovers.js';
import type { Leftover } from './leftovers.js';
import { ownedStatePath, readOwnedState, writeOwnedState } from './stateFile.js';
import { MAX_MESSAGES_PER_SESSION, MAX_RESULT_TEXT_CHARS, MAX_STDERR_TAIL_CHARS } from './types.js';
import type { ExitBy, HostEventType, LastResult, MessageStatus, OwnedExit, OwnedSessionRecord, OwnedSessionView, OwnedState } from './types.js';
import type { DecisionRequest, LaunchRequest, SendRequest } from './validation.js';

/*
 * The session host: the registry of the sessions agent-manager launched, and what can be done to them. It lives in the daemon (decision L1: the
 * child of an X1 session ends with its owner, so the owner must be a process that outlives module reloads and updates).
 *
 *   X1 `stream-json`: a child process held by a StreamJsonSession. Send, interrupt, permission mode, permission answers, stop, resume.
 *   X3 `hc`:          a herdr-core terminal started with HcLauncher. NOT owned: the terminal outlives this process, replies go through the hc reply
 *                     transport (the module), so every owned-session action on it is refused with a message that says so.
 *
 * What survives a daemon restart is the FILE (owned-sessions.json), not the children: they die with their owner (measured). At start, a session
 * that the file says was live becomes `interrupted`; `resume` starts a new child with `--resume`; the turn that was running is NOT replayed.
 */

export const DEFAULT_MAX_LIVE_SESSIONS = 10;
export const DEFAULT_MAX_RECORDS = 200;

export interface HcLauncherLike {
  launch(request: HcLaunchRequest): Promise<HcLaunchResult>;
}

export interface SessionHostOptions {
  configDir: string;
  /** The program of the X1 children (and of `--version`). Default: `claude` on the PATH. Tests run `node fakeClaude.mjs`. */
  claude?: { command?: string; commandArgs?: readonly string[]; env?: NodeJS.ProcessEnv };
  /** The X3 launcher. Default: a HcLauncher that runs `hc` on the PATH. */
  hcLauncher?: HcLauncherLike;
  /** The `claude --version` reader. Default: runs the program above. */
  readVersion?: () => Promise<string>;
  /** Test seam: starts an X1 child. Default: StreamJsonSession.start. */
  startSession?: (options: StreamJsonSessionOptions) => Promise<StreamJsonSession>;
  closeTimeoutMs?: number;
  controlTimeoutMs?: number;
  maxLiveSessions?: number;
  maxRecords?: number;
  events?: EventLog;
  clock?: () => number;
  daemonPid?: number;
  isPidAlive?: (pid: number) => boolean;
  /** Called for every problem the host cannot raise to a caller (a state or audit write that failed after the fact). Also emitted as `host.warning`. */
  onWarning?: (text: string) => void;
}

interface Live {
  session: StreamJsonSession;
  unsubscribe: () => void;
  messages: MessageStatus[];
  lastResult?: LastResult;
  stopRequested?: ExitBy;
}

export interface HostStatus {
  pid: number;
  startedAt: number;
  uptimeMs: number;
  owned: { total: number; live: number; idle: number; running: number; requiresAction: number; exited: number; interrupted: number; unobserved: number };
  leftovers: number;
  stopping: boolean;
}

export interface InitResult {
  /** Sessions the file said were live: now `interrupted`. */
  interrupted: string[];
  leftovers: Leftover[];
}

export interface ShutdownResult {
  closed: string[];
  /** Sessions whose process did not end (their pid is named): a LaunchError message each. */
  failed: { sessionId: string; reason: string }[];
}

const NOTE_INTERRUPTED =
  'the daemon that owned this session ended while it was live: its claude process ended with it, and the turn that was running (and any permission it waited on) is lost. A resume starts claude again with --resume (the conversation continues); the lost turn is NOT replayed: send the message again if it is still wanted';
const NOTE_EXITED_BY_SHUTDOWN = 'the session was closed when the daemon stopped; resume it to continue the conversation (nothing was running at that point that is replayed)';
const NOTE_HC = 'an hc session is not owned by the daemon: its state is the one of the Claude Code registry, replies go through the hc reply transport';

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export class SessionHost {
  readonly events: EventLog;
  readonly #configDir: string;
  readonly #statePath: string;
  readonly #claude: NonNullable<SessionHostOptions['claude']>;
  readonly #hcLauncher: HcLauncherLike;
  readonly #readVersion: () => Promise<string>;
  readonly #startSession: (options: StreamJsonSessionOptions) => Promise<StreamJsonSession>;
  readonly #closeTimeoutMs: number | undefined;
  readonly #controlTimeoutMs: number | undefined;
  readonly #maxLive: number;
  readonly #maxRecords: number;
  readonly #clock: () => number;
  readonly #daemonPid: number;
  readonly #isAlive: (pid: number) => boolean;
  readonly #onWarning: (text: string) => void;
  readonly #records = new Map<string, OwnedSessionRecord>();
  readonly #live = new Map<string, Live>();
  readonly #leftovers = new Map<string, Leftover>();
  /** Ids being launched or resumed: two requests for one id never run together. */
  readonly #starting = new Set<string>();
  readonly #startedAt: number;
  /** Starts in progress (launch, resume): all, those that will hold a claude child, and those that will add an entry to the list. */
  #startingCount = 0;
  #startingStream = 0;
  #startingNew = 0;
  #writeChain: Promise<void> = Promise.resolve();
  #initialized = false;
  #stopping = false;
  #shutdown: Promise<ShutdownResult> | undefined;

  constructor(options: SessionHostOptions) {
    this.#configDir = options.configDir;
    this.#statePath = ownedStatePath(options.configDir);
    this.#claude = options.claude ?? {};
    this.#hcLauncher = options.hcLauncher ?? new HcLauncher();
    this.#readVersion = options.readVersion ?? (() => readClaudeVersion(this.#claude));
    this.#startSession = options.startSession ?? ((sessionOptions) => StreamJsonSession.start(sessionOptions));
    this.#closeTimeoutMs = options.closeTimeoutMs;
    this.#controlTimeoutMs = options.controlTimeoutMs;
    this.#maxLive = options.maxLiveSessions ?? DEFAULT_MAX_LIVE_SESSIONS;
    this.#maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.#clock = options.clock ?? Date.now;
    this.#daemonPid = options.daemonPid ?? process.pid;
    this.#isAlive = options.isPidAlive ?? isPidAlive;
    this.#onWarning = options.onWarning ?? (() => undefined);
    this.events = options.events ?? new EventLog({ clock: this.#clock });
    this.#startedAt = this.#clock();
  }

  /**
   * Reads and validates the file WITHOUT changing anything: a daemon that has not yet become the singleton uses it to refuse a bad file early, so that a
   * start that will lose the race (or fail) never rewrites the file of the daemon that runs. Throws the same LaunchError as init().
   */
  async check(): Promise<void> {
    await readOwnedState(this.#statePath);
  }

  /**
   * Reads the file and applies the restart rule: a session that was live is now `interrupted`. Throws a LaunchError when the file cannot be read
   * (the host does not start on a file it does not understand, and never empties it). Must be called once, before anything else.
   */
  async init(): Promise<InitResult> {
    if (this.#initialized) {
      throw new LaunchError('host-already-initialized', 'the session host was already initialized', 'this is a bug of agent-manager, please report it');
    }
    const records = await readOwnedState(this.#statePath);
    const leftovers = findLeftovers(records, this.#isAlive);
    const interrupted: string[] = [];
    const now = this.#clock();
    for (const record of records) {
      // An hc terminal is not owned: it keeps its `live` status across a daemon restart.
      if (record.hostKind === 'stream-json' && record.status === 'live') {
        record.status = 'interrupted';
        record.interruptedAt = now;
        interrupted.push(record.id);
      }
      this.#records.set(record.id, record);
    }
    for (const leftover of leftovers) {
      this.#leftovers.set(leftover.sessionId, leftover);
    }
    if (interrupted.length > 0) {
      // A write that fails here is fatal for the start: running on an unwritten state would hide the interruption on the next restart.
      await this.#persist();
    }
    this.#initialized = true;
    for (const id of interrupted) {
      this.#emit('session.interrupted', id, { leftoverPid: this.#leftovers.get(id)?.pid ?? null });
    }
    for (const leftover of leftovers) {
      this.#warn(describeLeftover(leftover));
    }
    return { interrupted, leftovers };
  }

  /** Resolves when every file write started so far is done (the exit of a session is written after the event). */
  async flush(): Promise<void> {
    await this.#writeChain;
  }

  get stopping(): boolean {
    return this.#stopping;
  }

  list(): OwnedSessionView[] {
    return [...this.#records.values()].sort((a, b) => b.startedAt - a.startedAt).map((record) => this.#view(record));
  }

  get(id: string): OwnedSessionView {
    return this.#view(this.#record(id));
  }

  status(): HostStatus {
    const owned = { total: 0, live: 0, idle: 0, running: 0, requiresAction: 0, exited: 0, interrupted: 0, unobserved: 0 };
    for (const record of this.#records.values()) {
      owned.total++;
      switch (this.#stateOf(record)) {
        case 'idle':
          owned.idle++;
          owned.live++;
          break;
        case 'running':
          owned.running++;
          owned.live++;
          break;
        case 'requires_action':
          owned.requiresAction++;
          owned.live++;
          break;
        case 'exited':
          owned.exited++;
          break;
        case 'interrupted':
          owned.interrupted++;
          break;
        case 'unobserved':
          owned.unobserved++;
          break;
      }
    }
    const now = this.#clock();
    return { pid: this.#daemonPid, startedAt: this.#startedAt, uptimeMs: now - this.#startedAt, owned, leftovers: this.#leftovers.size, stopping: this.#stopping };
  }

  async launch(request: LaunchRequest): Promise<OwnedSessionView> {
    return this.#audited('launch', undefined, { hostKind: request.hostKind, cwd: request.cwd, model: request.model ?? null, permissionMode: request.permissionMode ?? null }, async () => {
      this.#assertRunning();
      const stream = request.hostKind === 'stream-json';
      this.#assertRoom({ stream, created: true });
      // The slot is taken BEFORE the first await: two requests that come together cannot both pass the checks above.
      const release = this.#reserve({ stream, created: true });
      try {
        const claudeVersion = await this.#readVersion();
        // A stop that began while `claude --version` ran: nothing may be started after the shutdown.
        this.#assertRunning();
        return await (stream ? this.#launchStream(request, claudeVersion) : this.#launchHc(request, claudeVersion));
      } finally {
        release();
      }
    });
  }

  async resume(id: string, options: { acknowledgeLeftover?: boolean } = {}): Promise<OwnedSessionView> {
    return this.#audited('resume', id, {}, async () => {
      this.#assertRunning();
      const record = this.#record(id);
      this.#assertStream(record, 'be resumed');
      if (this.#live.has(id) || this.#starting.has(id)) {
        throw new LaunchError('already-live', `the session ${id} is live already`, 'there is nothing to resume: send it a message');
      }
      const leftoverPid = record.pid;
      if (record.status === 'interrupted' && leftoverPid !== undefined && this.#isAlive(leftoverPid) && options.acknowledgeLeftover !== true) {
        throw new LaunchError(
          'leftover-alive',
          `the claude process ${leftoverPid} of this session is still alive although its daemon is gone: resuming would start a second claude on the same conversation`,
          `end process ${leftoverPid} (task manager); if it is not a claude (the number was reused by another program), resume with {"acknowledgeLeftover": true}`,
        );
      }
      this.#assertRoom({ stream: true, created: false });
      // Reserved before the first await (see launch): a second resume of the same id now says already-live, and the live limit counts this one.
      const release = this.#reserve({ stream: true, created: false });
      this.#starting.add(id);
      try {
        const claudeVersion = await this.#readVersion();
        this.#assertRunning();
        const session = await this.#startSession({
          ...this.#sessionOptions(record.cwd, record.model, record.permissionMode),
          resume: id,
        });
        const live = this.#attach(id, session);
        record.status = 'live';
        record.pid = session.pid;
        record.daemonPid = this.#daemonPid;
        record.claudeVersion = claudeVersion;
        record.resumedAt = this.#clock();
        delete record.exit;
        delete record.interruptedAt;
        this.#leftovers.delete(id);
        try {
          await this.#persist();
        } catch (error) {
          await this.#undoStart(id, session, live);
          throw error;
        }
        this.#emit('session.resumed', id, { pid: session.pid, claudeVersion });
        return this.#view(record);
      } finally {
        this.#starting.delete(id);
        release();
      }
    });
  }

  async send(id: string, request: SendRequest): Promise<{ uuid: string; state: 'queued' }> {
    return this.#audited('send', id, { textChars: request.text.length, images: request.images.length }, async () => {
      const live = this.#liveSession(id, 'receive a message');
      const sent = await live.session.send(request.text, request.images);
      this.#upsertMessage(live, sent.uuid, 'queued');
      return { uuid: sent.uuid, state: 'queued' as const };
    });
  }

  async interrupt(id: string): Promise<InterruptReceipt> {
    return this.#audited('interrupt', id, {}, async () => {
      const live = this.#liveSession(id, 'be interrupted');
      const receipt = await live.session.interrupt();
      this.#emit('session.interrupt', id, { stillQueued: receipt.stillQueued.length, cancelled: receipt.cancelled?.length ?? 0 });
      return receipt;
    });
  }

  async setPermissionMode(id: string, mode: string): Promise<{ mode: string }> {
    return this.#audited('permission-mode', id, { mode }, async () => {
      const live = this.#liveSession(id, 'change its permission mode');
      const applied = await live.session.setPermissionMode(mode);
      const record = this.#record(id);
      record.permissionMode = applied;
      await this.#persistOrWarn();
      this.#emit('session.permission_mode', id, { mode: applied });
      return { mode: applied };
    });
  }

  /** The permission requests that wait for an answer, in full (the tool input is what the user decides on). */
  permissions(id: string): PendingPermission[] {
    const record = this.#record(id);
    this.#assertStream(record, 'list permissions');
    return this.#live.get(id)?.session.pendingPermissions() ?? [];
  }

  async decide(id: string, requestId: string, decision: DecisionRequest): Promise<{ requestId: string; decision: 'allow' | 'deny' }> {
    const toolName = this.#live.get(id)?.session.pendingPermissions().find((pending) => pending.requestId === requestId)?.toolName ?? null;
    return this.#audited('permission-decision', id, { requestId, toolName, decision: decision.decision }, async () => {
      const live = this.#liveSession(id, 'receive a permission decision');
      if (decision.decision === 'allow') {
        await live.session.allow(requestId);
      } else {
        await live.session.deny(requestId, decision.message);
      }
      return { requestId, decision: decision.decision };
    });
  }

  /** Ends an owned X1 session: stdin closed (claude finishes and exits), killed when it does not end in time. The record stays, resumable. */
  async stop(id: string): Promise<OwnedSessionView> {
    return this.#audited('stop', id, {}, async () => {
      const live = this.#liveSession(id, 'be stopped');
      live.stopRequested = 'user';
      try {
        await live.session.close();
      } catch (error) {
        // The process did not end: it is still ours, and when it ends later the cause is its own, not "stopped by the user".
        delete live.stopRequested;
        throw error;
      }
      return this.get(id);
    });
  }

  /** Removes an ended (or hc) entry from the list. A live session is never forgotten: stop it first. */
  async forget(id: string): Promise<{ id: string }> {
    return this.#audited('forget', id, {}, async () => {
      const record = this.#record(id);
      if (this.#live.has(id) || this.#starting.has(id)) {
        throw new LaunchError('session-live', `the session ${id} is live`, 'stop it first (POST /sessions/:id/stop), then forget it');
      }
      this.#records.delete(id);
      this.#leftovers.delete(id);
      try {
        await this.#persist();
      } catch (error) {
        this.#records.set(id, record);
        throw error;
      }
      this.#emit('session.forgotten', id, {});
      return { id };
    });
  }

  /**
   * The ordered end of the daemon: no new launch, stdin of every child closed (a child that does not end in `closeTimeoutMs` is killed), then the
   * file is written. Idempotent: a second call returns the first one's result. A crash of the daemon cannot run this: see the restart rule.
   */
  shutdown(): Promise<ShutdownResult> {
    this.#shutdown ??= this.#runShutdown();
    return this.#shutdown;
  }

  async #runShutdown(): Promise<ShutdownResult> {
    this.#stopping = true;
    this.#emit('host.stopping', undefined, { live: this.#live.size });
    const entries = [...this.#live.entries()];
    const result: ShutdownResult = { closed: [], failed: [] };
    await Promise.all(
      entries.map(async ([id, live]) => {
        live.stopRequested ??= 'daemon-shutdown';
        try {
          await live.session.close();
          result.closed.push(id);
        } catch (error) {
          result.failed.push({ sessionId: id, reason: getErrorMessage(error) });
        }
      }),
    );
    // Launches and resumes already in flight finish (or fail) first, then their sessions are closed too.
    while (this.#startingCount > 0) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    for (const [id, live] of this.#live) {
      if (!entries.some(([earlier]) => earlier === id)) {
        live.stopRequested ??= 'daemon-shutdown';
        await live.session.close().then(
          () => result.closed.push(id),
          (error: unknown) => result.failed.push({ sessionId: id, reason: getErrorMessage(error) }),
        );
      }
    }
    await this.#writeChain;
    if (!this.#initialized) {
      // The file was never read: writing the (empty) list now would erase the sessions that are in it.
      return result;
    }
    await this.#persistOrWarn();
    await this.#writeAudit('shutdown', undefined, result.failed.length === 0 ? 'ok' : `failed: ${result.failed.length} process(es) did not end`, { closed: result.closed.length, failed: result.failed.length });
    return result;
  }

  async #launchStream(request: LaunchRequest, claudeVersion: string): Promise<OwnedSessionView> {
    const session = await this.#startSession(this.#sessionOptions(request.cwd, request.model, request.permissionMode));
    const id = session.sessionId;
    if (this.#records.has(id)) {
      await session.kill().catch(() => undefined);
      throw new LaunchError('duplicate-session', `a session ${id} is already in the list`, 'this should not happen with a generated id: retry the launch');
    }
    const live = this.#attach(id, session);
    const record: OwnedSessionRecord = {
      id,
      hostKind: 'stream-json',
      cwd: request.cwd,
      ...(request.model === undefined ? {} : { model: request.model }),
      ...(request.permissionMode === undefined ? {} : { permissionMode: request.permissionMode }),
      ...(request.name === undefined ? {} : { name: request.name }),
      claudeVersion,
      startedAt: this.#clock(),
      status: 'live',
      pid: session.pid,
      daemonPid: this.#daemonPid,
    };
    this.#records.set(id, record);
    try {
      await this.#persist();
    } catch (error) {
      this.#records.delete(id);
      await this.#undoStart(id, session, live);
      throw error;
    }
    this.#emit('session.launched', id, { hostKind: 'stream-json', cwd: request.cwd, model: request.model ?? null, permissionMode: request.permissionMode ?? null, claudeVersion, pid: session.pid });
    return this.#view(record);
  }

  async #launchHc(request: LaunchRequest, claudeVersion: string): Promise<OwnedSessionView> {
    const name = request.name ?? `am-${randomBytes(4).toString('hex')}`;
    const args = [...(request.model === undefined ? [] : ['--model', request.model]), ...(request.permissionMode === undefined ? [] : ['--permission-mode', request.permissionMode])];
    const launched = await this.#hcLauncher.launch({ cwd: request.cwd, name, args });
    const id = launched.session.sessionId;
    const note = `the hc terminal ${launched.address} (${name}) was started and left running: close it with hc kill ${launched.address}`;
    if (this.#records.has(id)) {
      throw new LaunchError('duplicate-session', `a session ${id} is already in the list`, `${note}; then retry`);
    }
    const record: OwnedSessionRecord = {
      id,
      hostKind: 'hc',
      cwd: request.cwd,
      ...(request.model === undefined ? {} : { model: request.model }),
      ...(request.permissionMode === undefined ? {} : { permissionMode: request.permissionMode }),
      name,
      claudeVersion,
      startedAt: this.#clock(),
      status: 'live',
      hcAddress: launched.address,
    };
    this.#records.set(id, record);
    try {
      await this.#persist();
    } catch (error) {
      this.#records.delete(id);
      throw new LaunchError('state-file-write-failed', getErrorMessage(error), `${note}; fix the problem above, then retry`);
    }
    this.#emit('session.launched', id, { hostKind: 'hc', cwd: request.cwd, model: request.model ?? null, permissionMode: request.permissionMode ?? null, claudeVersion, hcAddress: launched.address, linkedAfterMs: launched.linkedAfterMs });
    return this.#view(record);
  }

  #sessionOptions(cwd: string, model: string | undefined, permissionMode: string | undefined): StreamJsonSessionOptions {
    return {
      cwd,
      ...(this.#claude.command === undefined ? {} : { command: this.#claude.command }),
      ...(this.#claude.commandArgs === undefined ? {} : { commandArgs: this.#claude.commandArgs }),
      ...(this.#claude.env === undefined ? {} : { env: this.#claude.env }),
      ...(model === undefined ? {} : { model }),
      ...(permissionMode === undefined ? {} : { permissionMode }),
      ...(this.#closeTimeoutMs === undefined ? {} : { closeTimeoutMs: this.#closeTimeoutMs }),
      ...(this.#controlTimeoutMs === undefined ? {} : { controlTimeoutMs: this.#controlTimeoutMs }),
    };
  }

  /** A child that was started but could not be recorded: ended at once, so that no unrecorded process survives. */
  async #undoStart(id: string, session: StreamJsonSession, live: Live): Promise<void> {
    live.unsubscribe();
    this.#live.delete(id);
    await session.kill().catch((error: unknown) => this.#warn(`could not end the claude process ${session.pid} that was started but not recorded (${getErrorMessage(error)}): end it by hand`));
  }

  #attach(id: string, session: StreamJsonSession): Live {
    const live: Live = { session, unsubscribe: () => undefined, messages: [] };
    live.unsubscribe = session.subscribe((event) => this.#onSessionEvent(id, live, event));
    this.#live.set(id, live);
    return live;
  }

  #onSessionEvent(id: string, live: Live, event: SessionEvent): void {
    switch (event.kind) {
      case 'state':
        this.#emit('session.state', id, { state: event.state, previous: event.previous });
        break;
      case 'init':
        if (event.sessionId !== id) {
          this.#emit('session.warning', id, { code: 'session-id-changed', detail: `Claude Code reported the session id ${event.sessionId}, not ${id}: the transcript may be under the new id` });
        }
        break;
      case 'lifecycle':
        this.#upsertMessage(live, event.uuid, event.state);
        this.#emit('session.lifecycle', id, { uuid: event.uuid, state: event.state });
        break;
      case 'result': {
        live.lastResult = {
          subtype: event.subtype,
          isError: event.isError,
          ...(event.stopReason === undefined ? {} : { stopReason: event.stopReason }),
          ...(event.text === undefined ? {} : { text: truncate(event.text, MAX_RESULT_TEXT_CHARS) }),
          at: this.#clock(),
        };
        this.#emit('session.result', id, { subtype: event.subtype, isError: event.isError, stopReason: event.stopReason ?? null });
        break;
      }
      case 'permission_request':
        this.#emit('session.permission_request', id, {
          requestId: event.request.requestId,
          toolName: event.request.toolName,
          displayName: event.request.displayName ?? null,
          description: event.request.description === undefined ? null : truncate(event.request.description, 300),
          blockedPath: event.request.blockedPath ?? null,
        });
        break;
      case 'permission_resolved':
        this.#emit('session.permission_resolved', id, { requestId: event.requestId, behavior: event.behavior });
        break;
      case 'protocol_error':
        this.#emit('session.warning', id, { code: event.code });
        break;
      case 'unsupported_control_request':
        this.#emit('session.warning', id, { code: 'unsupported-control-request', detail: `claude sent a control request of subtype ${event.subtype ?? 'unknown'} that agent-manager does not handle and did not answer` });
        break;
      case 'exit':
        this.#onExit(id, live, event.info);
        break;
      // Content of the conversation: the transcript carries it, the stream of events never does.
      case 'text_delta':
      case 'assistant':
      case 'user_replay':
      case 'control_response':
      case 'system':
      case 'stream_event':
      case 'unknown':
        break;
      default: {
        const unhandled: never = event;
        throw new Error(`a session event of an unknown kind reached the host: ${JSON.stringify(unhandled)}`);
      }
    }
  }

  #onExit(id: string, live: Live, info: ExitInfo): void {
    live.unsubscribe();
    this.#live.delete(id);
    for (const message of live.messages) {
      if (message.state === 'queued' || message.state === 'started') {
        message.state = 'lost';
        message.at = this.#clock();
      }
    }
    const record = this.#records.get(id);
    if (record === undefined) {
      return;
    }
    const exit: OwnedExit = {
      cause: info.cause,
      code: info.code,
      signal: info.signal,
      by: live.stopRequested ?? 'self',
      stderrTail: info.stderrTail.slice(-MAX_STDERR_TAIL_CHARS),
      at: this.#clock(),
    };
    record.status = 'exited';
    record.exit = exit;
    delete record.pid;
    this.#emit('session.exit', id, { cause: exit.cause, code: exit.code, signal: exit.signal, by: exit.by });
    // The exit is already seen by the consumers: a file that cannot be written is reported, not hidden, and the next write retries it.
    void this.#persistOrWarn();
  }

  #upsertMessage(live: Live, uuid: string, state: MessageStatus['state']): void {
    const existing = live.messages.find((message) => message.uuid === uuid);
    if (existing === undefined) {
      live.messages.push({ uuid, state, at: this.#clock() });
      if (live.messages.length > MAX_MESSAGES_PER_SESSION) {
        live.messages.shift();
      }
    } else if (existing.state !== 'completed' && existing.state !== 'cancelled') {
      existing.state = state;
      existing.at = this.#clock();
    }
  }

  #record(id: string): OwnedSessionRecord {
    const record = this.#records.get(id);
    if (record === undefined) {
      throw new LaunchError('unknown-session', `no owned session ${JSON.stringify(id)}`, 'list the owned sessions with GET /sessions (a session that agent-manager did not launch is not owned: use the reply transports for it)');
    }
    return record;
  }

  #assertStream(record: OwnedSessionRecord, what: string): void {
    if (record.hostKind !== 'stream-json') {
      throw new LaunchError('not-owned', `the session ${record.id} is an hc session (terminal ${record.hcAddress ?? '?'}): the daemon does not own it, it cannot be ${what} here`, `use the hc reply transport for replies, and the terminal itself (hc read/keys, hc kill ${record.hcAddress ?? '<address>'}) for the rest`);
    }
  }

  #liveSession(id: string, what: string): Live {
    const record = this.#record(id);
    this.#assertStream(record, what);
    const live = this.#live.get(id);
    if (live === undefined) {
      throw new LaunchError(
        'session-not-live',
        `the session ${id} is ${record.status} (${record.status === 'interrupted' ? 'its daemon ended while it was live' : 'its claude process ended'}): it cannot ${what}`,
        `resume it with POST /sessions/${id}/resume (the conversation continues; the lost turn is not replayed), then retry`,
      );
    }
    return live;
  }

  #assertRunning(): void {
    if (this.#stopping) {
      throw new LaunchError('host-stopping', 'the daemon is stopping', 'start the daemon again (agent-manager start) once it is stopped, then retry');
    }
    if (!this.#initialized) {
      throw new LaunchError('host-not-ready', 'the session host is not initialized', 'this is a bug of agent-manager, please report it');
    }
  }

  /** `stream`: the start takes a live slot (an hc terminal does not); `created`: it adds an entry to the list (a resume does not). */
  #assertRoom(kind: { stream: boolean; created: boolean }): void {
    if (kind.stream && this.#live.size + this.#startingStream >= this.#maxLive) {
      throw new LaunchError('too-many-sessions', `${this.#live.size + this.#startingStream} owned sessions are live or starting (the limit is ${this.#maxLive})`, 'stop one (POST /sessions/:id/stop), then retry');
    }
    if (kind.created && this.#records.size + this.#startingNew >= this.#maxRecords) {
      throw new LaunchError('session-list-full', `the list holds ${this.#records.size + this.#startingNew} owned sessions or starts (the limit is ${this.#maxRecords})`, 'remove the ones you do not need (POST /sessions/:id/forget), then retry');
    }
  }

  /** Takes a slot for a start that is in progress; the returned function gives it back (call it in a `finally`). Shutdown waits for every slot. */
  #reserve(kind: { stream: boolean; created: boolean }): () => void {
    this.#startingCount++;
    if (kind.stream) {
      this.#startingStream++;
    }
    if (kind.created) {
      this.#startingNew++;
    }
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.#startingCount--;
      if (kind.stream) {
        this.#startingStream--;
      }
      if (kind.created) {
        this.#startingNew--;
      }
    };
  }

  #stateOf(record: OwnedSessionRecord): OwnedState {
    if (record.hostKind === 'hc') {
      return 'unobserved';
    }
    const live = this.#live.get(record.id);
    if (live !== undefined) {
      return live.session.state === 'exited' ? 'exited' : live.session.state;
    }
    return record.status === 'interrupted' ? 'interrupted' : record.status === 'live' ? 'running' : 'exited';
  }

  #view(record: OwnedSessionRecord): OwnedSessionView {
    const live = this.#live.get(record.id);
    const state = this.#stateOf(record);
    const leftover = this.#leftovers.get(record.id);
    const resumable = record.hostKind === 'stream-json' && live === undefined && !this.#starting.has(record.id) && !this.#stopping && (record.status === 'exited' || record.status === 'interrupted');
    const note = record.hostKind === 'hc' ? NOTE_HC : state === 'interrupted' ? NOTE_INTERRUPTED : state === 'exited' && record.exit?.by === 'daemon-shutdown' ? NOTE_EXITED_BY_SHUTDOWN : undefined;
    return {
      ...record,
      state,
      resumable,
      pendingPermissions: live?.session.pendingPermissions().length ?? 0,
      ...(note === undefined ? {} : { note }),
      ...(leftover === undefined ? {} : { leftoverPid: leftover.pid }),
      ...(live?.lastResult === undefined ? {} : { lastResult: live.lastResult }),
      messages: live === undefined ? [] : live.messages.map((message) => ({ ...message })),
    };
  }

  #emit(type: HostEventType, sessionId: string | undefined, data: Record<string, unknown>): void {
    this.events.append(type, sessionId, data);
  }

  #warn(text: string): void {
    this.#emit('host.warning', undefined, { text: truncate(text, 1000) });
    this.#onWarning(text);
  }

  /** Writes the file after the others pending; rejects with the LaunchError of the write. */
  #persist(): Promise<void> {
    const write = this.#writeChain.then(() => writeOwnedState(this.#statePath, [...this.#records.values()]));
    // The chain itself never stays rejected: a later write is a new attempt with the then current records.
    this.#writeChain = write.catch(() => undefined);
    return write;
  }

  async #persistOrWarn(): Promise<void> {
    try {
      await this.#persist();
    } catch (error) {
      this.#warn(getErrorMessage(error));
    }
  }

  async #writeAudit(action: HostAuditAction, sessionId: string | undefined, outcome: string, details: Record<string, string | number | boolean | null>): Promise<void> {
    try {
      await appendHostAudit(this.#configDir, { time: this.#clock(), action, ...(sessionId === undefined ? {} : { sessionId }), outcome, details });
    } catch (error) {
      this.#warn(`the audit line of '${action}' could not be written (${getErrorMessage(error)}): check the folder ${this.#configDir}`);
    }
  }

  /** Runs one action and writes its audit line (metadata only) with the outcome, failures included; the error is rethrown unchanged. */
  async #audited<T>(action: HostAuditAction, sessionId: string | undefined, details: Record<string, string | number | boolean | null>, work: () => Promise<T>): Promise<T> {
    try {
      const result = await work();
      const resultId = typeof result === 'object' && result !== null && 'id' in result && typeof result.id === 'string' ? result.id : undefined;
      await this.#writeAudit(action, sessionId ?? resultId, 'ok', details);
      return result;
    } catch (error) {
      await this.#writeAudit(action, sessionId, `failed: ${truncate(getErrorMessage(error), 300)}`, details);
      throw error;
    }
  }
}
