import { randomBytes } from 'node:crypto';
import { getErrorMessage } from '../../errors.js';
import { isPidAlive } from '../../pidAlive.js';
import { BgLauncher } from '../BgLauncher.js';
import type { BgAgent, BgLaunchRequest, BgLaunchResult } from '../BgLauncher.js';
import { LaunchError } from '../errors.js';
import { HcLauncher } from '../HcLauncher.js';
import type { HcLaunchRequest, HcLaunchResult } from '../HcLauncher.js';
import { resolveProjectsDir, transcriptPath } from '../../transcript/transcriptPath.js';
import type { TranscriptPathResult } from '../../transcript/transcriptPath.js';
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

/** What the host needs of the X2 launcher (BgLauncher): tests give a fake. */
export interface BgLauncherLike {
  launch(request: BgLaunchRequest): Promise<BgLaunchResult>;
  list(): Promise<BgAgent[]>;
  stop(jobId: string): Promise<void>;
  respawn(jobId: string): Promise<void>;
  remove(jobId: string): Promise<void>;
}

/** How often `claude agents --json` is asked while a bg session is live (no faster: every call starts a claude process). */
export const DEFAULT_BG_OBSERVE_INTERVAL_MS = 5000;
/** The longest wait between two polls while `claude agents --json` keeps failing. */
export const MAX_BG_BACKOFF_MS = 60_000;
/** After a respawn, a stopped or missing snapshot is ignored for this long (the supervisor may still report the old state). */
export const DEFAULT_BG_RESPAWN_GRACE_MS = 10_000;

/** Job ids are compared without regard to case (Claude Code prints them in lower case, a state file or a caller may not). */
const sameJob = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export interface SessionHostOptions {
  configDir: string;
  /** The program of the X1 children (and of `--version`). Default: `claude` on the PATH. Tests run `node fakeClaude.mjs`. */
  claude?: { command?: string; commandArgs?: readonly string[]; env?: NodeJS.ProcessEnv };
  /** The X3 launcher. Default: a HcLauncher that runs `hc` on the PATH. */
  hcLauncher?: HcLauncherLike;
  /** The X2 launcher and observer. Default: a BgLauncher that runs `claude` like the X1 children (same program and environment). */
  bgLauncher?: BgLauncherLike;
  /** The period of the poll of `claude agents --json` while a bg session is live. Default DEFAULT_BG_OBSERVE_INTERVAL_MS. */
  bgObserveIntervalMs?: number;
  /** How long after a respawn a stopped snapshot is ignored. Default DEFAULT_BG_RESPAWN_GRACE_MS. */
  bgRespawnGraceMs?: number;
  /** The `claude --version` reader. Default: runs the program above. */
  readVersion?: () => Promise<string>;
  /** Test seam: finds the transcript of a session to fork (a fork of a session without transcript is refused). Default: transcriptPath() under the projects folder of the child's environment (AGENT_MANAGER_PROJECTS_DIR, CLAUDE_CONFIG_DIR, else ~/.claude/projects). */
  locateTranscript?: (cwd: string, sessionId: string, projectsDir: string) => Promise<TranscriptPathResult>;
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
const NOTE_BG =
  'a background session: the Claude Code supervisor hosts it and survives this daemon, the daemon only observes it (claude agents --json). Replies go through the socket reply transport and arrive as peer messages; interrupting and answering permission prompts need a terminal (claude attach)';
const NOTE_HC = 'an hc session is not owned by the daemon: its state is the one of the Claude Code registry, replies go through the hc reply transport';

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

/**
 * The API state of an entry of `claude agents --json`. A process that ended (stopped, failed) is exited. While the process is alive `status` is the live
 * signal (busy, waiting, idle): measured in Round 4, `state` stayed `working` for about 2 minutes after the turn had ended and the registry said idle, so it
 * is only used when `status` is absent. Something the session waits on (`waitingFor`) always needs the user in a terminal. A value this code does not know
 * is `unobserved`, never a guess.
 */
export function bgOwnedState(agent: BgAgent): OwnedState {
  if (agent.state === 'stopped' || agent.state === 'failed') {
    return 'exited';
  }
  if (agent.waitingFor !== undefined || agent.status === 'waiting') {
    return 'requires_action';
  }
  if (agent.status === 'busy') {
    return 'running';
  }
  if (agent.status === 'idle') {
    return 'idle';
  }
  if (agent.state === 'working') {
    return 'running';
  }
  if (agent.state === 'blocked' || agent.state === 'done') {
    return 'idle';
  }
  return 'unobserved';
}

export class SessionHost {
  readonly events: EventLog;
  readonly #configDir: string;
  readonly #statePath: string;
  readonly #claude: NonNullable<SessionHostOptions['claude']>;
  readonly #hcLauncher: HcLauncherLike;
  readonly #bg: BgLauncherLike;
  readonly #bgIntervalMs: number;
  /** What the last successful poll said about each bg session (by session id). Never persisted: it is read again at the first poll after a start. */
  readonly #bgSeen = new Map<string, BgAgent>();
  #bgTimer: NodeJS.Timeout | undefined;
  #bgWatching = false;
  readonly #warned = new Set<string>();
  readonly #bgGraceMs: number;
  /** Consecutive failed polls (the backoff). */
  #bgFailures = 0;
  /** Per record: changes at every stop, end and respawn, so that a poll that began before drops its stale answer. */
  readonly #bgGen = new Map<string, number>();
  readonly #bgGraceUntil = new Map<string, number>();
  /** Per record: the action that runs on it (stop, resume, forget run one at a time). */
  readonly #bgBusy = new Map<string, string>();
  #bgPolling: Promise<void> | undefined;
  /** The failure of the last poll while it keeps failing (one warning per distinct text, not one per poll). */
  #bgError: string | undefined;
  readonly #readVersion: () => Promise<string>;
  readonly #startSession: (options: StreamJsonSessionOptions) => Promise<StreamJsonSession>;
  readonly #locateTranscript: (cwd: string, sessionId: string, projectsDir: string) => Promise<TranscriptPathResult>;
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
    this.#bg = options.bgLauncher ?? new BgLauncher({ onWarning: (text) => this.#warnOnce(text), ...(this.#claude.command === undefined ? {} : { command: this.#claude.command }), ...(this.#claude.commandArgs === undefined ? {} : { commandArgs: this.#claude.commandArgs }), ...(this.#claude.env === undefined ? {} : { env: this.#claude.env }) });
    this.#bgIntervalMs = options.bgObserveIntervalMs ?? DEFAULT_BG_OBSERVE_INTERVAL_MS;
    this.#bgGraceMs = options.bgRespawnGraceMs ?? DEFAULT_BG_RESPAWN_GRACE_MS;
    this.#readVersion = options.readVersion ?? (() => readClaudeVersion(this.#claude));
    this.#startSession = options.startSession ?? ((sessionOptions) => StreamJsonSession.start(sessionOptions));
    this.#locateTranscript = options.locateTranscript ?? ((cwd, sessionId, projectsDir) => transcriptPath(cwd, sessionId, projectsDir));
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
    this.#watchBg();
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
    return this.#audited('launch', undefined, { hostKind: request.hostKind, cwd: request.cwd, model: request.model ?? null, permissionMode: request.permissionMode ?? null, ...(request.forkOf === undefined ? {} : { forkOf: request.forkOf }) }, async () => {
      this.#assertRunning();
      if (request.forkOf !== undefined) {
        // Before a slot is taken and before `claude --version` runs: a fork that cannot start costs nothing.
        if (request.hostKind !== 'stream-json') {
          throw new LaunchError('fork-host-unsupported', `forkOf is not supported with hostKind ${JSON.stringify(request.hostKind)}`, "only 'stream-json' sessions can be started as a fork");
        }
        await this.#assertForkSource(request.forkOf, request.cwd);
      }
      const stream = request.hostKind === 'stream-json';
      this.#assertRoom({ stream, created: true });
      // The slot is taken BEFORE the first await: two requests that come together cannot both pass the checks above.
      const release = this.#reserve({ stream, created: true });
      try {
        const claudeVersion = await this.#readVersion();
        // A stop that began while `claude --version` ran: nothing may be started after the shutdown.
        this.#assertRunning();
        if (request.hostKind === 'bg') {
          return await this.#launchBg(request, claudeVersion);
        }
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
      if (record.hostKind === 'bg') {
        return await this.#resumeBg(record);
      }
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
      const record = this.#record(id);
      if (record.hostKind === 'bg') {
        return await this.#stopBg(record);
      }
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
  async forget(id: string): Promise<{ id: string; supervisorNote?: string }> {
    return this.#audited('forget', id, {}, async () => {
      const record = this.#record(id);
      if (record.hostKind === 'bg') {
        return await this.#forgetBg(record);
      }
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
    // The bg sessions belong to the supervisor: they keep running, the daemon only stops looking.
    this.#unwatchBg();
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

  /**
   * A fork needs the transcript of its source on this machine: checked here so that a wrong id is a 4xx with the fix, not a claude that exits at once
   * with "No conversation found". The transcript is whatever is written so far (a fork of a busy session starts from that, the turn in flight is not in it).
   */
  async #assertForkSource(sourceId: string, cwd: string): Promise<void> {
    // The same folder the child will read: its own environment (the one given to the child, else this process's).
    const env = this.#claude.env ?? process.env;
    const home = env['HOME'] ?? env['USERPROFILE'];
    const projectsDir = resolveProjectsDir(env, home);
    const found = await this.#locateTranscript(cwd, sourceId, projectsDir);
    if (!found.ok) {
      const { message, fix } = found.error;
      throw new LaunchError('fork-source-not-found', `the session to fork ${sourceId} has no transcript under ${projectsDir} (${message})`, `${fix} A session that has not received a message yet has no transcript and cannot be forked.`);
    }
  }

  async #launchStream(request: LaunchRequest, claudeVersion: string): Promise<OwnedSessionView> {
    const session = await this.#startSession({ ...this.#sessionOptions(request.cwd, request.model, request.permissionMode), ...(request.forkOf === undefined ? {} : { forkOf: request.forkOf }) });
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
      ...(request.forkOf === undefined ? {} : { forkedFrom: request.forkOf }),
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
    this.#emit('session.launched', id, { hostKind: 'stream-json', cwd: request.cwd, model: request.model ?? null, permissionMode: request.permissionMode ?? null, claudeVersion, pid: session.pid, ...(request.forkOf === undefined ? {} : { forkedFrom: request.forkOf }) });
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

  async #launchBg(request: LaunchRequest, claudeVersion: string): Promise<OwnedSessionView> {
    const name = request.name ?? `am-${randomBytes(4).toString('hex')}`;
    const launched = await this.#bg.launch({ cwd: request.cwd, name, ...(request.model === undefined ? {} : { model: request.model }), ...(request.permissionMode === undefined ? {} : { permissionMode: request.permissionMode }) });
    const id = launched.agent.sessionId;
    const note = `the background session ${launched.jobId} (${name}) was started and left running: see it with \`claude agents\`, stop it with \`claude stop ${launched.jobId}\` when it is not wanted`;
    if (this.#records.has(id)) {
      throw new LaunchError('duplicate-session', `a session ${id} is already in the list`, `${note}; then retry`);
    }
    const record: OwnedSessionRecord = {
      id,
      hostKind: 'bg',
      jobId: launched.jobId,
      cwd: request.cwd,
      ...(request.model === undefined ? {} : { model: request.model }),
      ...(request.permissionMode === undefined ? {} : { permissionMode: request.permissionMode }),
      name,
      claudeVersion,
      startedAt: this.#clock(),
      status: 'live',
      ...(launched.agent.pid === undefined ? {} : { pid: launched.agent.pid }),
    };
    this.#records.set(id, record);
    try {
      await this.#persist();
    } catch (error) {
      this.#records.delete(id);
      throw new LaunchError('state-file-write-failed', getErrorMessage(error), `${note}; fix the problem above, then retry`);
    }
    this.#bgSeen.set(id, launched.agent);
    this.#emit('session.launched', id, { hostKind: 'bg', jobId: launched.jobId, cwd: request.cwd, model: request.model ?? null, permissionMode: request.permissionMode ?? null, claudeVersion, linkedAfterMs: launched.linkedAfterMs });
    this.#watchBg();
    return this.#view(record);
  }

  /**
   * Runs one action (stop, resume, forget) on a bg record, alone: a second action on the same record while one runs is refused with a clear error, so a
   * forget can never delete a record that a resume is bringing back, and a stop never races a respawn.
   */
  async #exclusive<T>(record: OwnedSessionRecord, action: string, work: () => Promise<T>): Promise<T> {
    const running = this.#bgBusy.get(record.id);
    if (running !== undefined) {
      throw new LaunchError('bg-action-in-progress', `the background session ${record.id} is being ${running}: ${action} is refused until it ends`, 'wait for the running action to finish (it is bounded by its own timeout), then retry');
    }
    this.#bgBusy.set(record.id, action);
    try {
      return await work();
    } finally {
      this.#bgBusy.delete(record.id);
    }
  }

  /** `claude stop <id>`: the supervisor ends the process, the conversation stays (resume = `claude respawn`). */
  async #stopBg(record: OwnedSessionRecord): Promise<OwnedSessionView> {
    this.#assertRunning();
    return this.#exclusive(record, 'stopped', async () => {
      const jobId = this.#jobIdOf(record);
      if (record.status !== 'live') {
        throw new LaunchError('session-not-live', `the background session ${record.id} is ${record.status}`, `resume it with POST /sessions/${record.id}/resume (claude respawn), or forget it`);
      }
      await this.#bg.stop(jobId);
      // The supervisor accepted the stop (exit 0): the record says so now. Whatever state it reports later, a respawn is what brings the session back.
      this.#endBg(record, 'closed', 'user', '');
      await this.#persistOrWarn();
      this.#unwatchBgIfIdle();
      return this.#view(record);
    });
  }

  /** `claude respawn <id>`: a stopped session restarts with its conversation (documented); nothing is replayed here. */
  async #resumeBg(record: OwnedSessionRecord): Promise<OwnedSessionView> {
    return this.#exclusive(record, 'resumed', async () => {
      const jobId = this.#jobIdOf(record);
      if (record.status === 'live') {
        throw new LaunchError('already-live', `the background session ${record.id} is live already`, 'there is nothing to resume: send it a message');
      }
      this.#assertRoom({ stream: false, created: false });
      this.#starting.add(record.id);
      const release = this.#reserve({ stream: false, created: false });
      try {
        // A poll that started before the respawn holds a snapshot of the stopped session: the generation makes the poll drop it, and the grace period ignores
        // the first snapshots taken while the supervisor still reports the old state.
        this.#bumpGeneration(record.id);
        await this.#bg.respawn(jobId);
        this.#bumpGeneration(record.id);
        this.#bgGraceUntil.set(record.id, this.#clock() + this.#bgGraceMs);
        record.status = 'live';
        record.resumedAt = this.#clock();
        delete record.exit;
        this.#bgSeen.delete(record.id);
        try {
          await this.#persist();
        } catch (error) {
          // The respawn happened and cannot be undone here: the caller is told, the next change rewrites the file.
          throw new LaunchError('state-file-write-failed', getErrorMessage(error), `the session ${jobId} was restarted by claude respawn; fix the problem above, the next change rewrites the file`);
        }
        this.#emit('session.resumed', record.id, { jobId, claudeVersion: record.claudeVersion });
        this.#watchBg();
        return this.#view(record);
      } finally {
        this.#starting.delete(record.id);
        release();
      }
    });
  }

  /**
   * Removes an ended bg session from the list. The RECORD always goes (a supervisor that does not answer must not make the state file impossible to clean);
   * `claude rm` is tried only when the supervisor lists the job, and what could not be done is returned as `supervisorNote` (and warned), never hidden.
   * A live one is never forgotten: stop it first.
   */
  async #forgetBg(record: OwnedSessionRecord): Promise<{ id: string; supervisorNote?: string }> {
    this.#assertRunning();
    return this.#exclusive(record, 'forgotten', async () => {
      const jobId = this.#jobIdOf(record);
      if (record.status === 'live') {
        throw new LaunchError('session-live', `the background session ${record.id} is live`, `stop it first (POST /sessions/${record.id}/stop), then forget it`);
      }
      let supervisorNote: string | undefined;
      try {
        const listed = await this.#bg.list();
        if (listed.some((agent) => sameJob(agent.id, jobId))) {
          await this.#bg.remove(jobId);
        } else {
          supervisorNote = `the supervisor does not list ${jobId} any more: nothing to remove there`;
        }
      } catch (error) {
        supervisorNote = `the record was removed, but the supervisor could not be asked or refused (${getErrorMessage(error)}): the session may still be listed by \`claude agents\`; remove it there with \`claude rm ${jobId}\``;
        this.#warn(supervisorNote);
      }
      if (this.#records.get(record.id)?.status === 'live') {
        // Defence in depth: no other action runs on this record meanwhile (see #exclusive), but a record that is live now is never deleted.
        throw new LaunchError('session-live', `the background session ${record.id} became live while it was being forgotten`, 'stop it first, then forget it');
      }
      this.#records.delete(record.id);
      this.#bgSeen.delete(record.id);
      this.#bgGen.delete(record.id);
      this.#bgGraceUntil.delete(record.id);
      try {
        await this.#persist();
      } catch (error) {
        this.#records.set(record.id, record);
        throw error;
      }
      this.#emit('session.forgotten', record.id, supervisorNote === undefined ? {} : { supervisorNote });
      return { id: record.id, ...(supervisorNote === undefined ? {} : { supervisorNote }) };
    });
  }

  #jobIdOf(record: OwnedSessionRecord): string {
    if (record.jobId === undefined) {
      throw new LaunchError('state-file-unreadable', `the bg session ${record.id} has no job id in its record`, 'forget it and launch it again');
    }
    return record.jobId;
  }

  #bumpGeneration(id: string): void {
    this.#bgGen.set(id, (this.#bgGen.get(id) ?? 0) + 1);
  }

  #endBg(record: OwnedSessionRecord, cause: OwnedExit['cause'], by: ExitBy, detail: string): void {
    const previous = this.#stateOf(record);
    this.#bumpGeneration(record.id);
    record.status = 'exited';
    record.exit = { cause, code: null, signal: null, by, stderrTail: detail, at: this.#clock() };
    delete record.pid;
    this.#bgSeen.delete(record.id);
    this.#emit('session.state', record.id, { state: 'exited', previous, bgState: 'stopped' });
    this.#emit('session.exit', record.id, { cause, code: null, signal: null, by });
  }

  /** The state of a bg session: what the last poll of `claude agents --json` said, mapped to the states of the API. Nothing is invented before the first poll. */
  #bgStateOf(record: OwnedSessionRecord): OwnedState {
    if (record.status !== 'live') {
      return 'exited';
    }
    const agent = this.#bgSeen.get(record.id);
    return agent === undefined ? 'unobserved' : bgOwnedState(agent);
  }

  #bgView(record: OwnedSessionRecord): Pick<OwnedSessionView, 'bgState' | 'waitingFor' | 'attachCommand' | 'observeError'> {
    const agent = record.status === 'live' ? this.#bgSeen.get(record.id) : undefined;
    return {
      ...(agent?.state === undefined ? {} : { bgState: agent.state }),
      ...(agent?.waitingFor === undefined ? {} : { waitingFor: agent.waitingFor }),
      ...(record.jobId === undefined ? {} : { attachCommand: `claude attach ${record.jobId}` }),
      ...(this.#bgError === undefined || record.status !== 'live' ? {} : { observeError: `${this.#bgError} (retrying in ${Math.round(this.#bgDelayMs() / 1000)} s)` }),
    };
  }

  #hasLiveBg(): boolean {
    for (const record of this.#records.values()) {
      if (record.hostKind === 'bg' && record.status === 'live') {
        return true;
      }
    }
    return false;
  }

  /** The wait before the next poll: the period, doubled after each failure in a row, at most MAX_BG_BACKOFF_MS (never below the period itself). */
  #bgDelayMs(): number {
    if (this.#bgFailures === 0) {
      return this.#bgIntervalMs;
    }
    return Math.min(this.#bgIntervalMs * 2 ** this.#bgFailures, Math.max(MAX_BG_BACKOFF_MS, this.#bgIntervalMs));
  }

  /** Starts the poll when a bg session is live (and only then): one `claude agents --json` now, then one after each wait (see #bgDelayMs). */
  #watchBg(): void {
    if (this.#stopping || this.#bgWatching || !this.#hasLiveBg()) {
      return;
    }
    this.#bgWatching = true;
    void this.#pollThenWait();
  }

  async #pollThenWait(): Promise<void> {
    await this.pollBg();
    if (!this.#bgWatching || this.#stopping) {
      return;
    }
    clearTimeout(this.#bgTimer);
    this.#bgTimer = setTimeout(() => void this.#pollThenWait(), this.#bgDelayMs());
    this.#bgTimer.unref();
  }

  #unwatchBg(): void {
    this.#bgWatching = false;
    clearTimeout(this.#bgTimer);
    this.#bgTimer = undefined;
  }

  #unwatchBgIfIdle(): void {
    if (!this.#hasLiveBg()) {
      this.#unwatchBg();
    }
  }

  /**
   * One poll of `claude agents --json --all` for the live bg sessions (the timer, the first look after a start and the tests call it). It never overlaps
   * itself. A failure keeps the last state, is reported once per distinct text (a warning event), shows as `observeError` with the wait before the retry,
   * and lengthens that wait (backoff) until a poll succeeds.
   */
  pollBg(): Promise<void> {
    this.#bgPolling ??= this.#runBgPoll().finally(() => {
      this.#bgPolling = undefined;
    });
    return this.#bgPolling;
  }

  async #runBgPoll(): Promise<void> {
    if (!this.#hasLiveBg()) {
      return;
    }
    // The generation of each record when the question is asked: an answer is applied only to a record that did not change meanwhile (stop, resume, end).
    const asked = new Map([...this.#records.values()].filter((record) => record.hostKind === 'bg').map((record) => [record.id, this.#bgGen.get(record.id) ?? 0]));
    let agents: BgAgent[];
    try {
      agents = await this.#bg.list();
    } catch (error) {
      const text = getErrorMessage(error);
      this.#bgFailures++;
      if (this.#bgError !== text) {
        this.#bgError = text;
        this.#warn(`could not observe the background sessions: ${text}`);
      }
      return;
    }
    this.#bgError = undefined;
    this.#bgFailures = 0;
    let changed = false;
    for (const record of [...this.#records.values()]) {
      if (record.hostKind !== 'bg' || record.status !== 'live' || (this.#bgGen.get(record.id) ?? 0) !== asked.get(record.id)) {
        continue;
      }
      const agent = agents.find((entry) => sameJob(entry.id, record.jobId ?? ''));
      const inGrace = (this.#bgGraceUntil.get(record.id) ?? 0) > this.#clock();
      if (agent === undefined) {
        if (inGrace) {
          continue;
        }
        this.#endBg(record, 'exited', 'self', 'the supervisor no longer lists this session (claude agents --json --all): it was removed outside agent-manager (claude rm, agent view), or the supervisor was reset');
        changed = true;
        continue;
      }
      if (agent.state === 'stopped' || agent.state === 'failed') {
        // Right after a respawn the supervisor may still report the old state for a moment: that snapshot is ignored, a later one counts.
        if (inGrace) {
          continue;
        }
        // Stopped from a terminal or ended by itself: the supervisor says so. A restart by the supervisor shows as working again at a later poll, but the
        // record stays exited until a resume (the poll only follows live records).
        this.#endBg(record, agent.state === 'failed' ? 'crashed' : 'closed', 'self', `the supervisor reports the state ${agent.state}`);
        changed = true;
        continue;
      }
      const before = this.#bgSeen.get(record.id);
      this.#bgSeen.set(record.id, agent);
      if (agent.pid !== undefined && agent.pid !== record.pid) {
        record.pid = agent.pid;
        changed = true;
      }
      if (before === undefined || bgOwnedState(before) !== bgOwnedState(agent) || before.state !== agent.state || before.waitingFor !== agent.waitingFor) {
        this.#emit('session.state', record.id, { state: bgOwnedState(agent), previous: before === undefined ? null : bgOwnedState(before), bgState: agent.state ?? null, waitingFor: agent.waitingFor ?? null });
        if (agent.waitingFor !== undefined && before?.waitingFor !== agent.waitingFor) {
          this.#emit('session.bg_waiting', record.id, { waitingFor: agent.waitingFor, attachCommand: `claude attach ${record.jobId ?? ''}` });
        }
      }
    }
    if (changed) {
      await this.#persistOrWarn();
    }
    this.#unwatchBgIfIdle();
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
    if (record.hostKind === 'bg') {
      throw new LaunchError(
        'not-owned',
        `the session ${record.id} is a background session (supervisor job ${record.jobId ?? '?'}): the daemon only observes it and cannot be asked to ${what}`,
        `send replies through the socket reply transport (they arrive as peer messages); interrupt and answer permission prompts in a terminal: claude attach ${record.jobId ?? '<id>'}`,
      );
    }
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
    if (record.hostKind === 'bg') {
      return this.#bgStateOf(record);
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
    const resumable = (record.hostKind === 'bg' ? true : record.hostKind === 'stream-json' && live === undefined) && !this.#starting.has(record.id) && !this.#stopping && (record.status === 'exited' || record.status === 'interrupted');
    const bg = record.hostKind === 'bg' ? this.#bgView(record) : undefined;
    const note = record.hostKind === 'hc' ? NOTE_HC : record.hostKind === 'bg' ? NOTE_BG : state === 'interrupted' ? NOTE_INTERRUPTED : state === 'exited' && record.exit?.by === 'daemon-shutdown' ? NOTE_EXITED_BY_SHUTDOWN : undefined;
    return {
      ...record,
      state,
      resumable,
      pendingPermissions: live?.session.pendingPermissions().length ?? 0,
      ...(note === undefined ? {} : { note }),
      ...(leftover === undefined ? {} : { leftoverPid: leftover.pid }),
      ...(live?.lastResult === undefined ? {} : { lastResult: live.lastResult }),
      messages: live === undefined ? [] : live.messages.map((message) => ({ ...message })),
      ...bg,
    };
  }

  #emit(type: HostEventType, sessionId: string | undefined, data: Record<string, unknown>): void {
    this.events.append(type, sessionId, data);
  }

  /** A warning that can repeat at every poll: said once per distinct text. */
  #warnOnce(text: string): void {
    if (!this.#warned.has(text)) {
      this.#warned.add(text);
      this.#warn(text);
    }
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
