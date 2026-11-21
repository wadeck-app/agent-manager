import type { ExitCause } from '../types.js';

/**
 * How an owned session is hosted: `stream-json` (X1: a child process of the daemon), `hc` (X3: a herdr-core terminal, not owned) or `bg` (X2: a Claude Code
 * background session hosted by its supervisor, observed through `claude agents --json`, not owned).
 */
export type HostKind = 'stream-json' | 'hc' | 'bg';

export const HOST_KINDS: readonly HostKind[] = ['stream-json', 'hc', 'bg'];

/**
 * What the persisted file remembers: `live` (it was running when the file was last written), `exited` (the process ended and the end was seen),
 * `interrupted` (it was live when the daemon died: its child died with it, only a resume brings it back).
 */
export type PersistedStatus = 'live' | 'exited' | 'interrupted';

/** Who ended the process: itself (exit or crash), the user (stop), the daemon shutting down. */
export type ExitBy = 'self' | 'user' | 'daemon-shutdown';

export interface OwnedExit {
  cause: ExitCause;
  code: number | null;
  signal: string | null;
  by: ExitBy;
  /** Bounded tail of the stderr of the process. */
  stderrTail: string;
  /** Epoch ms. */
  at: number;
}

/** A switch that stopped the session and could not start it on the target (#71): what the page offers as "Start on <target>". Cleared by the next start. */
export interface SwitchFailure {
  /** Epoch ms. */
  at: number;
  /** The host the session was being moved to. */
  target: HostKind;
  /** Why, in one line (the error of the failed step, cut). */
  reason: string;
}

/** One change of host of a session (#71): the session kept its id, only the process that hosts it changed. */
export interface SwitchRecord {
  /** Epoch ms. */
  at: number;
  from: HostKind;
  to: HostKind;
  /** The caller acknowledged that something was running (readiness not free) and asked to go on. */
  forced: boolean;
}

/** One entry of `<config dir>/owned-sessions.json`. No token and no message text is ever stored here. */
export interface OwnedSessionRecord {
  /** The Claude Code session id (the registry id, the transcript name). */
  id: string;
  hostKind: HostKind;
  cwd: string;
  model?: string;
  /** The permission mode at start, then the last one set through the daemon. */
  permissionMode?: string;
  /** A label shown in lists (stream-json), or the terminal name (hc). */
  name?: string;
  /** `claude --version` as run by the daemon at launch (for hc: on the PATH of the daemon, not necessarily the one of the terminal). */
  claudeVersion: string;
  /** Epoch ms of the launch. */
  startedAt: number;
  status: PersistedStatus;
  /** stream-json: the pid of the child while live. */
  pid?: number;
  /** The pid of the daemon that owned the child. */
  daemonPid?: number;
  /** hc: the terminal address (`t1z`). */
  hcAddress?: string;
  /** bg: the short job id of the supervisor (what `claude attach`, `stop`, `respawn` and `rm` take). */
  jobId?: string;
  exit?: OwnedExit;
  /** Epoch ms: the daemon found this session live in the file at its start. */
  interruptedAt?: number;
  /** Epoch ms of the last resume. */
  resumedAt?: number;
  /** stream-json: the session id this session was forked from (it continues a copy of that history). Never changes after the launch. */
  forkedFrom?: string;
  /** stream-json thread: the uuid of the transcript entry of the source the fork stops at (`--resume-session-at`). Only with forkedFrom; never changes. */
  forkedAtMessage?: string;
  /** stream-json thread: a short one-line quote of that message (at most MAX_QUOTE_CHARS) for the chip of the thread; presentation only, never sent to claude. */
  forkedAtQuote?: string;
  /** The changes of host, oldest first (at most MAX_SWITCH_HISTORY: the oldest are dropped). The session id never changes. */
  switches?: SwitchRecord[];
  /** Set when a switch stopped the old host and the target did not start: the session is stopped, and this says where it was meant to go. */
  switchFailure?: SwitchFailure;
}

/**
 * The state the API shows. `idle`, `running`, `requires_action` come from the stream (stream-json only); `exited` and `interrupted` from the
 * record; `unobserved` is an hc session: the daemon does not see its terminal, its state is the one of the Claude Code registry.
 */
export type OwnedState = 'idle' | 'running' | 'requires_action' | 'exited' | 'interrupted' | 'unobserved';

export interface MessageStatus {
  uuid: string;
  state: 'queued' | 'started' | 'completed' | 'cancelled' | 'lost';
  /** Epoch ms of the last change. */
  at: number;
}

export interface LastResult {
  subtype: string;
  isError: boolean;
  stopReason?: string;
  /** The text of the result, cut to MAX_RESULT_TEXT_CHARS. */
  text?: string;
  at: number;
}

export interface PermissionSummary {
  requestId: string;
  toolName: string;
  displayName?: string;
  description?: string;
  blockedPath?: string;
  toolUseId?: string;
  receivedAt: number;
}

export interface OwnedSessionView extends Omit<OwnedSessionRecord, 'status'> {
  /** The persisted status, kept for the files and the audit. */
  status: PersistedStatus;
  state: OwnedState;
  /** True when POST /sessions/:id/resume is accepted now. */
  resumable: boolean;
  pendingPermissions: number;
  /** What to know about the state, in words (interrupted: the turn was lost and is NOT replayed by a resume). */
  note?: string;
  /** Set when the pid of a lost child is still alive after a daemon crash: a leftover, never killed automatically. */
  leftoverPid?: number;
  lastResult?: LastResult;
  /** The last messages sent through the daemon and what became of them (bounded). */
  messages: MessageStatus[];
  /** bg: the `state` of `claude agents --json` at the last poll (working, blocked, done, failed, stopped); absent before the first poll. */
  bgState?: string;
  /** bg: what the session waits on (`permission prompt`, `input needed`, ...), from the last poll. It is answered only in a terminal (`attachCommand`). */
  waitingFor?: string;
  /** bg: the command that opens the session in a terminal (`claude attach <id>`), where permission prompts are answered. */
  attachCommand?: string;
  /** bg: why the last poll of `claude agents --json` failed, while it keeps failing. The state shown is then the last one seen. */
  observeError?: string;
}

/**
 * One notification of the stream of events. What it may carry is decided per field: ids, states, counts, tool name, display name, the description of a
 * permission request (cut to 300 characters) and the blocked path. It never carries message text, tool input, stderr, protocol error details or any token:
 * the consumer refetches GET /sessions/:id (exit report with stderrTail) and GET /sessions/:id/permissions (full tool input).
 */
export interface HostEvent {
  /** `<epoch>:<n>`: the epoch changes at every daemon start, so an id from an earlier run is recognised. */
  id: string;
  /** Epoch ms. */
  time: number;
  type: HostEventType;
  sessionId?: string;
  data: Record<string, unknown>;
}

export type HostEventType =
  | 'session.launched'
  | 'session.resumed'
  | 'session.state'
  | 'session.lifecycle'
  | 'session.result'
  | 'session.permission_request'
  | 'session.permission_resolved'
  | 'session.permission_mode'
  /** An interrupt of the running turn was sent. */
  | 'session.interrupt'
  /** The daemon found the session live in its file at start: its child died with the old daemon. */
  | 'session.interrupted'
  | 'session.exit'
  /** bg: the supervisor says the session waits on something only a terminal answers (`waitingFor`, `attachCommand`). */
  | 'session.bg_waiting'
  | 'session.forgotten'
  /** The session changed host (X1 <-> hc): same id, new host. */
  | 'session.switched'
  | 'session.warning'
  | 'host.warning'
  | 'host.stopping'
  /** Sent first to a new connection when the events it asked to replay are gone: refetch the sessions. */
  | 'replay.gap';

export const MAX_RESULT_TEXT_CHARS = 4000;
export const MAX_STDERR_TAIL_CHARS = 1000;
export const MAX_MESSAGES_PER_SESSION = 50;
export const MAX_SWITCH_HISTORY = 20;
