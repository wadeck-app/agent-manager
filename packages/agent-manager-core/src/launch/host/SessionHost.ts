import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getErrorMessage } from '../../errors.js';
import { isPidAlive } from '../../pidAlive.js';
import { readSessionRegistry } from '../../readSessionRegistry.js';
import type { RegistryResult, Session } from '../../session.js';
import { resolveSessionsDir } from '../../sessionsDir.js';
import { classifyReadiness } from '../../transcript/readiness.js';
import type { AdoptReadiness } from '../../transcript/readiness.js';
import { readInFlight, readSubagentActivity } from '../../transcript/readInFlight.js';
import { BgLauncher } from '../BgLauncher.js';
import type { BgAgent, BgLaunchRequest, BgLaunchResult } from '../BgLauncher.js';
import { LaunchError } from '../errors.js';
import { HcControl, promptDraft } from '../HcControl.js';
import type { HcControlLike, HcTerminalInfo } from '../HcControl.js';
import { HcLauncher } from '../HcLauncher.js';
import type { HcLaunchRequest, HcLaunchResult } from '../HcLauncher.js';
import { transcriptHasUuid } from '../../transcript/hasEntry.js';
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
import { checkFolderTrust } from './trust.js';
import type { FolderTrust } from './trust.js';
import { MAX_MESSAGES_PER_SESSION, MAX_RESULT_TEXT_CHARS, MAX_STDERR_TAIL_CHARS, MAX_SWITCH_HISTORY } from './types.js';
import type { ExitBy, HostEventType, HostKind, LastResult, MessageStatus, OwnedExit, OwnedSessionRecord, OwnedSessionView, OwnedState, SwitchRecord } from './types.js';
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
/** Live threads (forks that stop at a message) of one source session. */
export const DEFAULT_MAX_THREADS_PER_SESSION = 3;
export const DEFAULT_MAX_RECORDS = 200;
/** The longest a switch waits for an hc terminal to end after the keys (claude exits in about a second when idle, measured). */
export const DEFAULT_SWITCH_STOP_TIMEOUT_MS = 20_000;
export const DEFAULT_SWITCH_POLL_MS = 300;

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
  /** What the switch needs of herdr-core besides launching (read, keys, kill, remove). Default: HcControl on the PATH, when no custom hcLauncher is given; a custom launcher without control makes a switch FROM hc fail with a message. */
  hcControl?: HcControlLike;
  /** Test seam: the Claude Code registry now. Default: readSessionRegistry of the sessions folder of the claude environment. */
  readRegistry?: () => Promise<RegistryResult>;
  /** Test seam: is the folder trusted by Claude Code (an interactive claude there would block on the trust dialog)? Default: reads ~/.claude.json. */
  trustCheck?: (cwd: string) => Promise<FolderTrust>;
  /** Test seam: a pause. Default: setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** How long a switch waits for a stopped hc terminal to end. Default DEFAULT_SWITCH_STOP_TIMEOUT_MS. */
  switchStopTimeoutMs?: number;
  /** The period of that wait. Default DEFAULT_SWITCH_POLL_MS. */
  switchPollMs?: number;
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
  /** Live threads of one source session (default DEFAULT_MAX_THREADS_PER_SESSION). */
  maxThreadsPerSession?: number;
  /** Test seam: does the transcript file hold an entry with this uuid? Default: transcriptHasUuid (reads the file). */
  hasAnchor?: (transcriptFile: string, uuid: string) => Promise<boolean>;
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

/** What a switch found on the source host. */
interface SwitchSource {
  live: boolean;
  /** The pids this switch is about to stop. */
  pids: number[];
  /** hc: the terminal as hc reports it. */
  info?: HcTerminalInfo;
}

export interface SwitchResult {
  /** The same session (same id) on its new host. */
  session: OwnedSessionView;
  from: HostKind;
  to: HostKind;
  /** The caller asked to go on although the session was not free. */
  forced: boolean;
  /** What the server found at the moment of the switch (the reasons the caller acknowledged). */
  readiness: AdoptReadiness;
  /** What stays to know after the switch (a stale registry file, an orphaned tool, a terminal that could not be removed). */
  notes: string[];
}

/** The config file of Claude Code that holds the trust of the folders: `$CLAUDE_CONFIG_DIR/.claude.json`, else `~/.claude.json`. */
function claudeJsonPath(env: NodeJS.ProcessEnv): string {
  const dir = env['CLAUDE_CONFIG_DIR'];
  return dir !== undefined && dir.trim() !== '' ? join(dir, '.claude.json') : join(env['HOME'] ?? env['USERPROFILE'] ?? homedir(), '.claude.json');
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
  readonly #hcControl: HcControlLike | undefined;
  readonly #readRegistry: () => Promise<RegistryResult>;
  readonly #trustCheck: (cwd: string) => Promise<FolderTrust>;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #switchStopTimeoutMs: number;
  readonly #switchPollMs: number;
  /** Ids being switched from one host to another: one switch per id, and no stop, resume or forget meanwhile. */
  readonly #switching = new Set<string>();
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
  readonly #hasAnchor: (transcriptFile: string, uuid: string) => Promise<boolean>;
  readonly #closeTimeoutMs: number | undefined;
  readonly #controlTimeoutMs: number | undefined;
  readonly #maxLive: number;
  readonly #maxThreads: number;
  /** Threads being launched, per source id (the live ones are counted from the records). */
  readonly #threadStarts = new Map<string, number>();
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
    this.#hcControl = options.hcControl ?? (options.hcLauncher === undefined ? new HcControl() : undefined);
    const claudeEnv = this.#claude.env ?? process.env;
    this.#readRegistry = options.readRegistry ?? (() => readSessionRegistry(resolveSessionsDir(claudeEnv)));
    this.#trustCheck = options.trustCheck ?? ((cwd) => checkFolderTrust(cwd, claudeJsonPath(claudeEnv)));
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#switchStopTimeoutMs = options.switchStopTimeoutMs ?? DEFAULT_SWITCH_STOP_TIMEOUT_MS;
    this.#switchPollMs = options.switchPollMs ?? DEFAULT_SWITCH_POLL_MS;
    this.#bg = options.bgLauncher ?? new BgLauncher({ onWarning: (text) => this.#warnOnce(text), ...(this.#claude.command === undefined ? {} : { command: this.#claude.command }), ...(this.#claude.commandArgs === undefined ? {} : { commandArgs: this.#claude.commandArgs }), ...(this.#claude.env === undefined ? {} : { env: this.#claude.env }) });
    this.#bgIntervalMs = options.bgObserveIntervalMs ?? DEFAULT_BG_OBSERVE_INTERVAL_MS;
    this.#bgGraceMs = options.bgRespawnGraceMs ?? DEFAULT_BG_RESPAWN_GRACE_MS;
    this.#readVersion = options.readVersion ?? (() => readClaudeVersion(this.#claude));
    this.#startSession = options.startSession ?? ((sessionOptions) => StreamJsonSession.start(sessionOptions));
    this.#locateTranscript = options.locateTranscript ?? ((cwd, sessionId, projectsDir) => transcriptPath(cwd, sessionId, projectsDir));
    this.#closeTimeoutMs = options.closeTimeoutMs;
    this.#controlTimeoutMs = options.controlTimeoutMs;
    this.#maxLive = options.maxLiveSessions ?? DEFAULT_MAX_LIVE_SESSIONS;
    this.#maxThreads = options.maxThreadsPerSession ?? DEFAULT_MAX_THREADS_PER_SESSION;
    this.#hasAnchor = options.hasAnchor ?? transcriptHasUuid;
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
    return this.#audited('launch', undefined, { hostKind: request.hostKind, cwd: request.cwd, model: request.model ?? null, permissionMode: request.permissionMode ?? null, ...(request.forkOf === undefined ? {} : { forkOf: request.forkOf }), ...(request.resumeSessionAt === undefined ? {} : { resumeSessionAt: request.resumeSessionAt }) }, async () => {
      this.#assertRunning();
      if (request.resumeSessionAt !== undefined && request.forkOf === undefined) {
        throw new LaunchError('resume-at-without-fork', 'resumeSessionAt was given without forkOf', 'pass forkOf (the session to branch from): without a fork the session would be resumed in place, not branched');
      }
      let releaseThread: (() => void) | undefined;
      if (request.forkOf !== undefined) {
        // Before a slot is taken and before `claude --version` runs: a fork that cannot start costs nothing.
        if (request.hostKind !== 'stream-json') {
          throw new LaunchError('fork-host-unsupported', `forkOf is not supported with hostKind ${JSON.stringify(request.hostKind)}`, "only 'stream-json' sessions can be started as a fork");
        }
        // Cheap pre-check: a refusal that needs no file read is given first (not authoritative: the awaited reads below let other requests in).
        if (request.resumeSessionAt !== undefined) {
          this.#assertThreadRoom(request.forkOf);
        }
        await this.#assertForkSource(request.forkOf, request.cwd, request.resumeSessionAt);
        // The AUTHORITATIVE check: the cap check and its reservation are one synchronous step after the last await (the transcript and anchor reads), so
        // threads asked together cannot all pass. The reservation is held until the launch ends and then given back (the live record counts from then on).
        if (request.resumeSessionAt !== undefined) {
          releaseThread = this.#reserveThread(request.forkOf);
        }
      }
      const stream = request.hostKind === 'stream-json';
      let release: () => void;
      try {
        this.#assertRoom({ stream, created: true });
        // The slot is taken BEFORE the first await: two requests that come together cannot both pass the checks above.
        release = this.#reserve({ stream, created: true });
      } catch (error) {
        releaseThread?.();
        throw error;
      }
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
        releaseThread?.();
      }
    });
  }

  /** Throws `too-many-threads` when the source already has its live or starting threads; else returns the number of starting ones. Synchronous. */
  #assertThreadRoom(sourceId: string): number {
    const running = [...this.#records.values()].filter((record) => record.forkedFrom === sourceId && record.forkedAtMessage !== undefined && this.#live.has(record.id)).length;
    const starting = this.#threadStarts.get(sourceId) ?? 0;
    if (running + starting >= this.#maxThreads) {
      throw new LaunchError('too-many-threads', `${running + starting} threads of the session ${sourceId} are live or starting (the limit is ${this.#maxThreads})`, 'stop one of its threads (POST /sessions/:id/stop), then retry');
    }
    return starting;
  }

  /**
   * At most `maxThreadsPerSession` live threads (forks with an anchor) of one source: each is a claude process of about 450 MB (research/session-launch-options.md).
   * Counts the live ones and the ones that are starting; a refusal names the count and the fix, nothing is queued. Returns the function that gives the place back.
   */
  #reserveThread(sourceId: string): () => void {
    const starting = this.#assertThreadRoom(sourceId);
    this.#threadStarts.set(sourceId, starting + 1);
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const left = (this.#threadStarts.get(sourceId) ?? 1) - 1;
      if (left <= 0) {
        this.#threadStarts.delete(sourceId);
      } else {
        this.#threadStarts.set(sourceId, left);
      }
    };
  }

  async resume(id: string, options: { acknowledgeLeftover?: boolean } = {}): Promise<OwnedSessionView> {
    return this.#audited('resume', id, {}, async () => {
      this.#assertRunning();
      this.#assertNotSwitching(id);
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
      // A stopped thread comes back as a live thread: the cap of its source applies to a resume as to a launch (synchronous with the reservations below).
      const releaseThread = record.forkedFrom !== undefined && record.forkedAtMessage !== undefined ? this.#reserveThread(record.forkedFrom) : undefined;
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
        releaseThread?.();
      }
    });
  }

  async send(id: string, request: SendRequest): Promise<{ uuid: string; state: 'queued' }> {
    return this.#audited('send', id, { textChars: request.text.length, images: request.images.length }, async () => {
      this.#assertNotSwitching(id);
      const live = this.#liveSession(id, 'receive a message');
      const sent = await live.session.send(request.text, request.images);
      this.#upsertMessage(live, sent.uuid, 'queued');
      return { uuid: sent.uuid, state: 'queued' as const };
    });
  }

  async interrupt(id: string): Promise<InterruptReceipt> {
    return this.#audited('interrupt', id, {}, async () => {
      this.#assertNotSwitching(id);
      const live = this.#liveSession(id, 'be interrupted');
      const receipt = await live.session.interrupt();
      this.#emit('session.interrupt', id, { stillQueued: receipt.stillQueued.length, cancelled: receipt.cancelled?.length ?? 0 });
      return receipt;
    });
  }

  async setPermissionMode(id: string, mode: string): Promise<{ mode: string }> {
    return this.#audited('permission-mode', id, { mode }, async () => {
      this.#assertNotSwitching(id);
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
      this.#assertNotSwitching(id);
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
      this.#assertNotSwitching(id);
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
      this.#assertNotSwitching(id);
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
   * Moves a session from one host to another (#71, research/adopt-host-switch.md): X1 `stream-json` <-> `hc`. The session keeps its id and its record; what
   * changes is the process that hosts it. Order, every step checked before the next, nothing deleted that Claude Code owns:
   *   1. the source is looked at (live? which pid? which terminal?) and the transcript must exist (a session with no message cannot be resumed);
   *   2. readiness is computed HERE (the page's colour is only a hint): not free and no `force` = refused with the reasons, nothing touched;
   *   3. the target is feasible (hc: the folder is trusted, else the terminal would block on the trust dialog; X1: a live slot, `claude --version`);
   *   4. no OTHER live process holds the id (registry, supervisor): two writers on one transcript lose messages;
   *   5. the source is stopped (X1: stdin closed; hc: `ctrl+c ctrl+c` when the session is quiet, `hc kill` otherwise), then proved dead before 6;
   *   6. the target starts with `--resume <same id>` and the model and permission mode passed explicitly (they are not restored by every host);
   *   7. the same record is updated, the finished source terminal is removed with `hc rm` (the one the daemon started, by its address).
   * A failure after step 5 leaves the source stopped and says which step failed, the id and the command to resume by hand; it never starts the old host again.
   */
  async switchHost(id: string, target: HostKind, options: { force?: boolean } = {}): Promise<SwitchResult> {
    const force = options.force === true;
    const steps: string[] = [];
    const from = this.#records.get(id)?.hostKind;
    const details = (extra: Record<string, string | number | boolean | null> = {}): Record<string, string | number | boolean | null> => ({ from: from ?? null, to: target, forced: force, steps: steps.join('; '), ...extra });
    try {
      const result = await this.#runSwitch(id, target, force, steps);
      await this.#writeAudit('switch', id, 'ok', details({ readiness: result.readiness.state, reasons: result.readiness.reasons.length }));
      return result;
    } catch (error) {
      await this.#writeAudit('switch', id, `failed: ${truncate(getErrorMessage(error), 300)}`, details());
      throw error;
    }
  }

  async #runSwitch(id: string, target: HostKind, force: boolean, steps: string[]): Promise<SwitchResult> {
    this.#assertRunning();
    const record = this.#record(id);
    const from = record.hostKind;
    if ((target !== 'stream-json' && target !== 'hc') || from === 'bg') {
      throw new LaunchError('switch-host-unsupported', `moving a session ${from === 'bg' ? 'from' : 'to'} the host ${JSON.stringify(from === 'bg' ? from : target)} is not supported`, "only 'stream-json' (Web) and 'hc' (a herdr-core terminal) can be switched, in both directions; a background session is stopped with claude stop");
    }
    if (from === target) {
      throw new LaunchError('switch-same-host', `the session ${id} is already hosted by ${target}`, 'pick the other host');
    }
    if (this.#switching.has(id) || this.#starting.has(id)) {
      throw new LaunchError('switch-in-progress', `the session ${id} is being switched, started or resumed`, 'wait for that action to end (it is bounded by its own timeouts), then look at the session list');
    }
    this.#switching.add(id);
    // Counted as a start in progress: a shutdown waits for the switch (it must not leave a terminal or a child started after it).
    const releaseCount = this.#reserve({ stream: false, created: false });
    let releaseSlot: (() => void) | undefined;
    let releaseThread: (() => void) | undefined;
    let stopped = false;
    try {
      const notes: string[] = [];
      // 1. The source and the transcript.
      const source = await this.#switchSource(record);
      const located = await this.#locateTranscript(record.cwd, id, this.#projectsDir());
      if (!located.ok) {
        // violations-suppress: ts/no-err-message-direct a TranscriptError value ({ message, fix }), not a caught Error
        throw new LaunchError('switch-no-conversation', `the session ${id} has no transcript (${located.error.message}): there is no conversation for ${target} to resume`, `${located.error.fix} A session that has not received a message yet cannot be moved: send a message first, or launch a new one.`);
      }
      // 2. Readiness, recomputed here.
      let readiness: AdoptReadiness = { state: 'free', reasons: [] };
      if (source.live) {
        readiness = await this.#readiness(record, source, located);
        if (readiness.state !== 'free' && !force) {
          throw new LaunchError(
            'switch-not-ready',
            `the session ${id} is not free to move to ${target}: ${readiness.reasons.join('; ')}`,
            'wait for it to finish, or confirm these items and send the switch again with force: true (what runs is interrupted or left behind, and the reasons are written to the audit)',
          );
        }
      } else {
        notes.push(from === 'hc' ? 'the hc terminal of this session was already gone: there was no process to stop, the session is resumed on the target' : 'the session was not running: there was no process to stop, it is resumed on the target');
        steps.push('source not running, nothing to stop');
      }
      // 3. The target is feasible.
      const claudeVersion = await this.#readVersion();
      if (target === 'hc') {
        const trust = await this.#trustCheck(record.cwd);
        if (!trust.trusted) {
          if (trust.inherited === undefined) {
            throw new LaunchError('switch-untrusted-folder', trust.reason, 'trust the folder once as the message says, then switch again (nothing was stopped)');
          }
          if (!force) {
            throw new LaunchError('switch-untrusted-folder', trust.reason, `open claude once in the folder to trust it (cd "${record.cwd}", run claude, accept the dialog), then switch again; or switch with force: true at your own risk: the terminal may stop on the trust dialog after the old host was stopped (nothing was stopped)`);
          }
          notes.push(`the folder ${record.cwd} has no trust of its own, only its parent ${trust.inherited} is trusted: not verified that Claude Code honours it (forced); if the terminal waits on the trust dialog, accept it there`);
        }
      } else {
        this.#assertRoom({ stream: true, created: false });
        // A stopped thread comes back as a live thread: the cap of its source applies to a switch as to a resume, BEFORE anything is stopped.
        if (record.forkedFrom !== undefined && record.forkedAtMessage !== undefined) {
          releaseThread = this.#reserveThread(record.forkedFrom);
        }
        releaseSlot = this.#reserve({ stream: true, created: false });
      }
      // 4. No other process holds the id (one look at the supervisor, here: the check after the stop reads the registry only).
      const unverified = await this.#assertNotHeld(id, source);
      if (unverified.length > 0) {
        if (!force) {
          throw new LaunchError(
            'switch-not-ready',
            `the session ${id} may be held by something that could not be checked: ${unverified.join('; ')}`,
            'check it (claude agents, the registry), or confirm and send the switch again with force: true (the old host is stopped, and the audit says what was not checked)',
          );
        }
        notes.push(...unverified.map((reason) => `not checked (forced): ${reason}`));
      }
      // 5. Stop the source, then prove it dead.
      let finishedTerminal: string | undefined;
      if (source.live) {
        finishedTerminal = await this.#stopSource(record, source, readiness.state === 'free', force, target, steps, notes);
      } else if (from === 'hc' && source.info?.finished === true) {
        finishedTerminal = record.hcAddress;
      }
      stopped = true;
      await this.#proveNotHeld(id, notes);
      steps.push('proved no live process holds the id');
      // The daemon began to stop while the source was being stopped: nothing may be started after the shutdown.
      if (this.#stopping) {
        throw new LaunchError('switch-host-stopping', `the daemon is stopping: the session ${id} was stopped on ${from} and was NOT started on ${target}`, `start the daemon again (agent-manager start), then start the session on ${target} from its page (or resume it by hand: cd "${record.cwd}" and run claude --resume ${id})`);
      }
      // 6. Start the target.
      const snapshot = { ...record };
      const started = await this.#startTarget(record, target, steps);
      // 7. The same record, now on the target.
      const now = this.#clock();
      const entry: SwitchRecord = { at: now, from, to: target, forced: force };
      record.switches = [...(record.switches ?? []), entry].slice(-MAX_SWITCH_HISTORY);
      record.hostKind = target;
      record.status = 'live';
      delete record.switchFailure;
      record.claudeVersion = claudeVersion;
      record.resumedAt = now;
      delete record.exit;
      delete record.interruptedAt;
      if (started.kind === 'hc') {
        record.hcAddress = started.address;
        delete record.pid;
        delete record.daemonPid;
      } else {
        record.pid = started.session.pid;
        record.daemonPid = this.#daemonPid;
        delete record.hcAddress;
      }
      this.#leftovers.delete(id);
      try {
        await this.#persist();
      } catch (error) {
        if (started.kind === 'stream-json') {
          await this.#undoStart(id, started.session, started.live);
          this.#restore(record, snapshot);
        }
        throw new LaunchError('state-file-write-failed', getErrorMessage(error), started.kind === 'hc' ? `the session is now running in the hc terminal ${started.address} (the file will be rewritten by the next change); fix the problem above` : 'the new claude process was ended again; fix the problem above, then retry (nothing runs on the old host any more)');
      }
      steps.push(`recorded the session on ${target}`);
      await this.#writeAudit('resume', id, 'ok', { hostKind: target, via: 'switch', ...(started.kind === 'hc' ? { hcAddress: started.address } : { pid: started.session.pid }) });
      this.#emit('session.switched', id, { from, to: target, forced: force, readiness: readiness.state, ...(started.kind === 'hc' ? { hcAddress: started.address } : { pid: started.session.pid }) });
      if (finishedTerminal !== undefined) {
        await this.#removeFinishedTerminal(finishedTerminal, notes);
      }
      return { session: this.#view(record), from, to: target, forced: force, readiness, notes };
    } catch (error) {
      if (stopped) {
        // The old host is gone and the target did not start: the record says where it was meant to go, so the page can offer "Start on <target>".
        await this.#recordSwitchFailure(record, target, error);
      }
      throw error;
    } finally {
      releaseSlot?.();
      releaseThread?.();
      releaseCount();
      this.#switching.delete(id);
    }
  }

  /** The projects folder of the child's environment (the one claude writes the transcripts to). */
  #projectsDir(): string {
    const env = this.#claude.env ?? process.env;
    return resolveProjectsDir(env, env['HOME'] ?? env['USERPROFILE']);
  }

  async #recordSwitchFailure(record: OwnedSessionRecord, target: HostKind, error: unknown): Promise<void> {
    const reason = error instanceof LaunchError ? error.reason : getErrorMessage(error);
    record.switchFailure = { at: this.#clock(), target, reason: truncate(reason, 400) };
    await this.#persistOrWarn();
  }

  #assertNotSwitching(id: string): void {
    if (this.#switching.has(id)) {
      throw new LaunchError('switch-in-progress', `the session ${id} is being switched to another host`, 'wait for the switch to end, then look at the session list');
    }
  }

  #restore(record: OwnedSessionRecord, snapshot: OwnedSessionRecord): void {
    for (const key of Object.keys(record)) {
      Reflect.deleteProperty(record, key);
    }
    Object.assign(record, snapshot);
  }

  #controlOrThrow(): HcControlLike {
    if (this.#hcControl === undefined) {
      throw new LaunchError('hc-control-unavailable', 'this daemon has no control over herdr-core terminals (it was given a custom hc launcher without one)', 'this is a bug of agent-manager, or a test setup: report it; meanwhile the terminal can be ended with hc kill <terminal> (or hc keys <terminal> ctrl+c ctrl+c when it is idle)');
    }
    return this.#hcControl;
  }

  /** What is running on the source host now. `pids` are the processes this switch is about to stop (they never count as "another holder"). */
  async #switchSource(record: OwnedSessionRecord): Promise<SwitchSource> {
    if (record.hostKind === 'stream-json') {
      return { live: this.#live.has(record.id), pids: record.pid === undefined ? [] : [record.pid] };
    }
    if (record.status !== 'live' || record.hcAddress === undefined) {
      return { live: false, pids: [] };
    }
    const info = await this.#controlOrThrow().get(record.hcAddress);
    return { live: info !== undefined && !info.finished, pids: info?.foregroundPid === undefined ? [] : [info.foregroundPid], ...(info === undefined ? {} : { info }) };
  }

  async #readiness(record: OwnedSessionRecord, source: SwitchSource, located: { path: string; projectDir: string }): Promise<AdoptReadiness> {
    const now = this.#clock();
    const registry = await this.#readRegistry();
    const mine = registry.ok ? registry.sessions.filter((session) => session.alive && session.sessionId.toLowerCase() === record.id.toLowerCase()) : [];
    const entry = mine.find((session) => source.pids.includes(session.pid)) ?? (mine.length === 1 ? mine[0] : undefined);
    const live = this.#live.get(record.id);
    let turn: Parameters<typeof classifyReadiness>[0]['turn'];
    const streamState = live === undefined ? undefined : this.#stateOf(record);
    if (streamState === 'running') {
      turn = { status: 'busy', alive: true };
    } else if (streamState === 'requires_action') {
      turn = { status: 'waiting', waitingFor: 'a permission prompt', alive: true };
    } else if (entry !== undefined) {
      turn = { status: entry.status, ...(entry.waitingFor === undefined ? {} : { waitingFor: entry.waitingFor }), ...(entry.statusAgeMs === undefined ? {} : { ageMs: entry.statusAgeMs }), alive: entry.alive };
    } else if (live !== undefined) {
      // A Web session before its first registry write: the daemon's own word, the age counted from the last thing it saw.
      turn = { status: 'idle', ageMs: now - (live.lastResult?.at ?? record.resumedAt ?? record.startedAt), alive: true };
    } else {
      // violations-suppress: ts/no-err-message-direct a TranscriptError value ({ message, fix }), not a caught Error
      turn = { unavailable: registry.ok ? `no live registry entry for this session in ${registry.dir}` : `the Claude Code registry cannot be read (${registry.error.message})` };
    }
    const [transcript, subagents] = await Promise.all([readInFlight(located.path), readSubagentActivity(located.projectDir, record.id)]);
    return classifyReadiness({
      now,
      turn,
      transcript,
      subagents,
      ...(live === undefined ? {} : { pendingPermissions: live.session.pendingPermissions().length }),
      ...(record.hostKind === 'hc' ? { hcTerminal: source.info === undefined ? { found: false as const, reason: 'hc does not know the terminal' } : { found: true as const, ...(source.info.state === undefined ? {} : { state: source.info.state }), ...(source.info.kind === undefined ? {} : { kind: source.info.kind }) } } : {}),
    });
  }

  /**
   * Who else holds the id, before anything is stopped. `hard`: another live claude is certainly there (an entry that is not the source's own while the
   * source's own was found, or any entry when nothing of ours runs): refused with `session-held`. `unverified`: something that cannot be told (an entry that
   * cannot be matched to the process this switch stops, a supervisor that cannot be asked): returned as reasons, the caller needs `force` for them.
   */
  async #assertNotHeld(id: string, source: SwitchSource): Promise<string[]> {
    const registry = await this.#registryEntries(id);
    const own = registry.filter((entry) => source.pids.includes(entry.pid));
    const others = registry.filter((entry) => !source.pids.includes(entry.pid));
    const unverified: string[] = [];
    const hard: string[] = [];
    if (source.live && own.length === 0) {
      for (const entry of others) {
        unverified.push(`the claude process ${entry.pid} (registry file ${entry.file}, ${entry.status}) holds this session and cannot be matched to the process that is stopped (${source.pids.length === 0 ? 'its pid is unknown' : `pid ${source.pids.join(', ')}`}): it may be the session itself behind a wrapper process, or another claude on the same conversation`);
      }
    } else {
      hard.push(...others.map((entry) => `the claude process ${entry.pid} (registry file ${entry.file}, ${entry.status})`));
    }
    try {
      for (const agent of await this.#bg.list()) {
        if (agent.sessionId !== undefined && agent.sessionId.toLowerCase() === id.toLowerCase() && agent.state !== 'stopped' && agent.state !== 'failed') {
          hard.push(`the background session ${agent.id} (state ${agent.state ?? 'unknown'})`);
        }
      }
    } catch (error) {
      unverified.push(`the supervisor of background sessions could not be asked (${getErrorMessage(error)}), so it is not proved that no background session holds this session (run claude agents to see why it fails)`);
    }
    if (hard.length > 0) {
      throw new LaunchError('session-held', `the session ${id} is held by another live process: ${hard.join('; ')}`, 'end that process (exit the claude that runs it, or claude stop <job> for a background session), then switch again; two claude processes on one conversation lose messages (nothing was stopped)');
    }
    return unverified;
  }

  /** After the stop: nothing at all may hold the id (the source included), else the target must not start. Reads the registry only (no process is spawned here). */
  async #proveNotHeld(id: string, notes: string[]): Promise<void> {
    const holders = (await this.#registryEntries(id)).map((entry) => `the claude process ${entry.pid} (registry file ${entry.file}, ${entry.status})`);
    if (this.#live.has(id)) {
      holders.push('a Web session of this daemon');
    }
    if (holders.length > 0) {
      throw new LaunchError('switch-stop-incomplete', `the session ${id} is still held after the stop: ${holders.join('; ')}`, 'end that process by hand (Task Manager, or claude stop for a background session), then switch again; the target was NOT started');
    }
    const registry = await this.#readRegistry();
    if (registry.ok) {
      for (const stale of registry.sessions.filter((session) => !session.alive && session.sessionId.toLowerCase() === id.toLowerCase())) {
        notes.push(`a stale registry file ${stale.file} (pid ${stale.pid}, status ${stale.status}, not alive) of this session is left in place: Claude Code did not remove it and agent-manager never deletes files it does not own`);
      }
    }
  }

  /** The live registry entries of the id. An unreadable registry cannot prove anything: `holder-check-failed`, nothing was stopped. */
  async #registryEntries(id: string): Promise<Session[]> {
    const registry = await this.#readRegistry();
    if (!registry.ok) {
      // violations-suppress: ts/no-err-message-direct a TranscriptError value ({ message, fix }), not a caught Error
      throw new LaunchError('holder-check-failed', `the Claude Code registry cannot be read (${registry.error.message}), so it cannot be proved that no process holds the session ${id}`, `${registry.error.hint}; nothing was stopped`);
    }
    return registry.sessions.filter((session) => session.alive && session.sessionId.toLowerCase() === id.toLowerCase());
  }

  /** Stops the source and returns the address of the finished terminal to remove, when there is one. Writes the audit line of the stop. */
  async #stopSource(record: OwnedSessionRecord, source: SwitchSource, quiet: boolean, force: boolean, target: HostKind, steps: string[], notes: string[]): Promise<string | undefined> {
    const id = record.id;
    if (record.hostKind === 'stream-json') {
      const live = this.#liveSession(id, 'be stopped');
      live.stopRequested = 'user';
      try {
        await live.session.close();
      } catch (error) {
        delete live.stopRequested;
        await this.#writeAudit('stop', id, `failed: ${truncate(getErrorMessage(error), 300)}`, { hostKind: 'stream-json', via: 'switch' });
        throw new LaunchError('switch-stop-failed', `the Web session ${id} could not be stopped (${getErrorMessage(error)})`, `end the claude process ${record.pid ?? '?'} by hand, then switch again; the target was NOT started`);
      }
      steps.push(`stopped the Web session (pid ${record.pid ?? '?'})`);
      await this.#writeAudit('stop', id, 'ok', { hostKind: 'stream-json', via: 'switch', ...(record.pid === undefined ? {} : { pid: record.pid }) });
      return undefined;
    }
    const control = this.#controlOrThrow();
    const address = record.hcAddress ?? '';
    const deadline = this.#clock() + this.#switchStopTimeoutMs;
    let how: 'keys' | 'kill' = quiet ? 'keys' : 'kill';
    if (how === 'keys' && !force) {
      // ctrl+c on a prompt with text clears the text instead of exiting: a draft would be lost, and the exit would not happen.
      await this.#assertNoDraft(control, address);
    }
    try {
      if (how === 'keys') {
        // An idle prompt: the first press clears the (empty) prompt, the second exits; exit code 0 and the registry file removed (measured, a10).
        await control.keys(address, ['ctrl+c', 'ctrl+c']);
        steps.push(`typed ctrl+c twice in the terminal ${address}`);
      } else {
        await control.kill(address);
        steps.push(`killed the terminal ${address} (something was running)`);
      }
      let ended = await this.#waitEnded(control, address, id, deadline);
      if (!ended && how === 'keys') {
        if (!force) {
          throw new LaunchError('switch-stop-timeout', `the terminal ${address} did not end within ${this.#switchStopTimeoutMs} ms after ctrl+c ctrl+c (the session may have started a turn meanwhile)`, `look at it (hc read ${address}); to end it anyway run hc kill ${address} (a tool that runs may live on), or switch again with force: true`);
        }
        await control.kill(address);
        how = 'kill';
        steps.push(`killed the terminal ${address} (it did not end after the keys)`);
        ended = await this.#waitEnded(control, address, id, deadline + this.#switchStopTimeoutMs);
      }
      if (!ended) {
        throw new LaunchError('switch-stop-timeout', `the terminal ${address} still runs after hc kill`, `end it by hand (hc kill ${address}, or close the terminal), then switch again; the target was NOT started`);
      }
    } catch (error) {
      await this.#writeAudit('stop', id, `failed: ${truncate(getErrorMessage(error), 300)}`, { hostKind: 'hc', via: 'switch', hcAddress: address, how });
      throw error;
    }
    // The terminal is gone: the record no longer claims a live hc session (a failed target start must not leave it saying so).
    const now = this.#clock();
    record.status = 'exited';
    record.exit = { cause: how === 'keys' ? 'closed' : 'killed', code: null, signal: null, by: 'user', stderrTail: `ended by a switch to ${target} (${how === 'keys' ? 'ctrl+c ctrl+c' : 'hc kill'})`, at: now };
    await this.#persistOrWarn();
    if (how === 'kill') {
      notes.push(`the terminal ${address} was killed: a tool or background task it ran may keep running unseen (hc kill leaves the children of claude alive, measured), and its result will never reach the conversation`);
    }
    await this.#writeAudit('stop', id, 'ok', { hostKind: 'hc', via: 'switch', hcAddress: address, how, ...(source.pids[0] === undefined ? {} : { pid: source.pids[0] }) });
    return address;
  }

  async #assertNoDraft(control: HcControlLike, address: string): Promise<void> {
    const prompt = promptDraft(await control.screen(address));
    if (!prompt.found) {
      throw new LaunchError('switch-draft', `the prompt box of the terminal ${address} cannot be found on its screen (a dialog, or a layout this version does not know), so it is not known whether a draft would be lost`, `look at it (hc read ${address}), clear the draft or force: the draft will be lost (nothing was stopped)`);
    }
    if (prompt.draft !== '') {
      throw new LaunchError('switch-draft', `the terminal ${address} has text typed in its prompt (${truncate(prompt.draft, 80)}): ending claude would lose it`, 'clear the draft or force: the draft will be lost (nothing was stopped)');
    }
  }

  /** True when the terminal is finished (or unknown to hc) and no live registry entry holds the id. */
  async #waitEnded(control: HcControlLike, address: string, id: string, deadline: number): Promise<boolean> {
    for (;;) {
      const info: HcTerminalInfo | undefined = await control.get(address);
      const finished = info === undefined || info.finished;
      if (finished) {
        const registry = await this.#readRegistry();
        const alive = registry.ok && registry.sessions.some((session) => session.alive && session.sessionId.toLowerCase() === id.toLowerCase() && (info?.foregroundPid === undefined || session.pid === info.foregroundPid));
        if (!alive) {
          return true;
        }
      }
      if (this.#clock() >= deadline) {
        return false;
      }
      await this.#sleep(this.#switchPollMs);
    }
  }

  async #startTarget(record: OwnedSessionRecord, target: HostKind, steps: string[]): Promise<{ kind: 'hc'; address: string } | { kind: 'stream-json'; session: StreamJsonSession; live: Live }> {
    const id = record.id;
    const manual = `cd "${record.cwd}" and run: claude --resume ${id}${record.model === undefined ? '' : ` --model ${record.model}`}${record.permissionMode === undefined ? '' : ` --permission-mode ${record.permissionMode}`}`;
    const failed = (error: unknown, how: string): LaunchError => {
      const reason = error instanceof LaunchError ? error.reason : getErrorMessage(error);
      const fix = error instanceof LaunchError ? error.fix : 'check the message above';
      return new LaunchError('switch-target-failed', `the session ${id} was stopped on ${record.hostKind} (steps: ${steps.join(', ')}) but could not be started on ${target}: ${reason}`, `${how}: ${fix}. Resume it by hand: ${manual}`);
    };
    if (target === 'hc') {
      const name = `am-${randomBytes(4).toString('hex')}`;
      const args = ['--resume', id, ...(record.model === undefined ? [] : ['--model', record.model]), ...(record.permissionMode === undefined ? [] : ['--permission-mode', record.permissionMode])];
      let launched: HcLaunchResult;
      try {
        launched = await this.#hcLauncher.launch({ cwd: record.cwd, name, args });
      } catch (error) {
        await this.#writeAudit('resume', id, `failed: ${truncate(getErrorMessage(error), 300)}`, { hostKind: 'hc', via: 'switch' });
        throw failed(error, 'retry the switch (nothing runs on the old host, so nothing more is stopped)');
      }
      if (launched.session.sessionId.toLowerCase() !== id.toLowerCase()) {
        await this.#writeAudit('resume', id, `failed: the terminal registered ${launched.session.sessionId}`, { hostKind: 'hc', via: 'switch', hcAddress: launched.address });
        throw new LaunchError('switch-id-mismatch', `the terminal ${launched.address} registered the session ${launched.session.sessionId}, not ${id}: it is not the conversation that was moved, and it was NOT adopted (the old host is stopped)`, `close that terminal (hc kill ${launched.address}) and check ${manual}`);
      }
      steps.push(`started claude --resume in the terminal ${launched.address}`);
      return { kind: 'hc', address: launched.address };
    }
    let session: StreamJsonSession;
    try {
      session = await this.#startSession({ ...this.#sessionOptions(record.cwd, record.model, record.permissionMode), resume: id });
    } catch (error) {
      await this.#writeAudit('resume', id, `failed: ${truncate(getErrorMessage(error), 300)}`, { hostKind: 'stream-json', via: 'switch' });
      throw failed(error, 'retry the switch (nothing runs on the old host, so nothing more is stopped)');
    }
    const live = this.#attach(id, session);
    steps.push(`started claude --resume as a Web session (pid ${session.pid})`);
    return { kind: 'stream-json', session, live };
  }

  async #removeFinishedTerminal(address: string, notes: string[]): Promise<void> {
    try {
      await this.#controlOrThrow().remove(address);
    } catch (error) {
      notes.push(`the finished terminal ${address} could not be removed (${getErrorMessage(error)}): remove it with hc rm ${address}`);
    }
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
  async #assertForkSource(sourceId: string, cwd: string, anchor?: string): Promise<void> {
    // The same folder the child will read: its own environment (the one given to the child, else this process's).
    const projectsDir = this.#projectsDir();
    const found = await this.#locateTranscript(cwd, sourceId, projectsDir);
    if (!found.ok) {
      const { message, fix } = found.error;
      throw new LaunchError('fork-source-not-found', `the session to fork ${sourceId} has no transcript under ${projectsDir} (${message})`, `${fix} A session that has not received a message yet has no transcript and cannot be forked.`);
    }
    if (anchor === undefined) {
      return;
    }
    // A thread stops at a message: an unknown uuid would make claude fail (or, worse, fork the whole history), so it is refused here with the fix.
    let present: boolean;
    try {
      present = await this.#hasAnchor(found.path, anchor);
    } catch (error) {
      throw new LaunchError('fork-anchor-unreadable', `the transcript ${found.path} of the session to fork cannot be read to check the message ${anchor} (${getErrorMessage(error)})`, 'check the file permissions (another program may hold it), then retry');
    }
    if (!present) {
      throw new LaunchError('fork-anchor-not-found', `the message ${anchor} is not in the transcript ${found.path} of the session ${sourceId}`, 'reload the log and pick a message that is shown there (a message of a turn still being written may not be in the file yet); the transcript may also have been rewritten or deleted');
    }
  }

  async #launchStream(request: LaunchRequest, claudeVersion: string): Promise<OwnedSessionView> {
    const session = await this.#startSession({ ...this.#sessionOptions(request.cwd, request.model, request.permissionMode), ...(request.forkOf === undefined ? {} : { forkOf: request.forkOf }), ...(request.resumeSessionAt === undefined ? {} : { resumeSessionAt: request.resumeSessionAt }) });
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
      ...(request.resumeSessionAt === undefined ? {} : { forkedAtMessage: request.resumeSessionAt }),
      ...(request.forkedAtQuote === undefined || request.resumeSessionAt === undefined ? {} : { forkedAtQuote: request.forkedAtQuote }),
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
    this.#emit('session.launched', id, { hostKind: 'stream-json', cwd: request.cwd, model: request.model ?? null, permissionMode: request.permissionMode ?? null, claudeVersion, pid: session.pid, ...(request.forkOf === undefined ? {} : { forkedFrom: request.forkOf }), ...(request.resumeSessionAt === undefined ? {} : { forkedAtMessage: request.resumeSessionAt }), ...(request.forkedAtQuote === undefined || request.resumeSessionAt === undefined ? {} : { forkedAtQuote: request.forkedAtQuote }) });
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
