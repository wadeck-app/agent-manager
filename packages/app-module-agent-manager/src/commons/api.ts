/**
 * HTTP contract of the agent-manager module, shared by the backend (src/backend) and the React UI (src/dsl-components). TYPES ONLY: no runtime code,
 * so importing it (`import type`) adds nothing to a bundle. Routes are served under /api/modules/agent-manager/.
 *
 * Conventions:
 * - Every answer is JSON. The routes below answer HTTP 200 for everything the UI polls, with `ok: false` and an `error` object when the work failed
 *   (never an empty success). Malformed input is 400, an unknown or unsafe session id is 404, both with the same `{ ok: false, error }` body.
 * - Times are epoch milliseconds, except `generatedAt` (ISO text).
 * - An error always says what happened (`message`) and what to do (`hint`).
 */

// Type-only: erased at build time, so the UI bundle gets nothing from the core package.
import type { ReplyMarkerMode } from '@wadeck-app/agent-manager-core/reply';
import type { GuardrailBlocksDto } from './guardrails.js';
import type { GroupColor, GroupSort } from './groups.js';

/** A user-defined group of agents (POST /groups...). The members are the rows whose `customGroupId` is its id, ordered by `customGroupOrder`. */
export interface CustomGroupDto {
  /** UUID. */
  id: string;
  name: string;
  color: GroupColor | null;
  /** Server-side collapsed state (shared by every tab and browser). */
  collapsed: boolean;
  /** Position among the groups, 0 first. */
  order: number;
  /** How the agents of the group are ordered in the Custom mode. */
  sort: GroupSort;
  /** The background color of the agents of the group in the Custom mode; null: none. (The header color is `color`.) */
  bodyColor: GroupColor | null;
}

/** The error object of the log and reply routes. */
export interface ApiError {
  /** Stable machine code, e.g. 'unknown-session', 'transcript-missing', 'transport-unavailable'. */
  code: string;
  /** What happened. */
  message: string;
  /** What to do about it (always filled). */
  hint: string;
}

/** The body of a failed log or reply route. */
export interface ApiFailure {
  ok: false;
  error: ApiError;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// GET /sessions[?show=alive|all]
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/** How the list groups a session. `needs-you`: waits for the user; `done`: finished since the user last looked; `ended`: its process is gone. */
export type AgentState = 'needs-you' | 'done' | 'working' | 'idle' | 'ended' | 'other';

/** One row of GET /sessions: the registry session plus what the list needs. Only the fields the UI uses are listed; the table columns use the others. */
export interface SessionRowDto extends SessionStatusDto {
  /** The session id as the registry writes it (use it in the routes below; case-insensitive on the server). */
  sessionId: string;
  /** The registry name, else the folder. */
  displayName: string;
  /** Last directory of the working directory. */
  folder: string;
  /** Full working directory. */
  cwd: string;
  /** Registry process id. */
  pid: number;
  /** The harness with its version ("Claude Code 2.1.325"). */
  harness: string;
  /** Badge variant of the harness: success for the most recent version on this machine, warning for an older one, default when unknown. */
  harnessVariant: 'success' | 'warning' | 'default';
  /** The harness version from the registry, absent when the registry has none. */
  version?: string;
  /** Raw registry status ('busy', 'idle', 'waiting', ...). */
  status: string;
  /** The process of the session exists (pid-only check). */
  alive: boolean;
  /** Epoch ms of the last status change, absent when the registry has none. */
  statusUpdatedAt?: number;
  /** The state the list groups by (see AgentState). */
  state: AgentState;
  /** The user pinned this session. */
  pinned: boolean;
  /** Position of the pin in the order the user pinned the sessions (0 = pinned first); -1 when not pinned. The Pinned group lists by this. */
  pinOrder: number;
  /** The custom group the user put this session in (id of an entry of `customGroups`); null when it is ungrouped. */
  customGroupId: string | null;
  /** Position of the session inside its custom group, 0 first; -1 when ungrouped. */
  customGroupOrder: number;
  /** The user flagged this session (Custom mode). */
  flagged: boolean;
  /** The user marked this session unread (Custom mode): shown as finished and unseen until it is selected. */
  unread: boolean;
  /** The user has seen the latest status of the session: false while `state` is 'done' (finished work not looked at yet). */
  seen: boolean;
  /** What a waiting session waits for ("permission prompt"); empty when it does not wait or the registry does not say. */
  reason: string;
  /** Short one-line text of the latest assistant text or tool call ("Bash: npm test"), from the transcript tail; empty when unknown (see activityNote). */
  lastActivity: string;
  /** Empty when lastActivity is trustworthy; else why it is empty or stale ("No transcript yet", "Transcript unreadable: ..."). */
  activityNote: string;
  /** Number of sub-agents the session started (files of its subagents folder); 0 when none or unknown. */
  subagentCount: number;
  /** Times the w-guardrails plugin blocked this session (counters of its folder), with the categories; absent when none. */
  guardrailBlocks?: GuardrailBlocksDto;
  /**
   * 'agent-manager': launched through the daemon (the session is in GET /owned). 'discovered': found in the Claude Code registry. Unreliable while the list's
   * `ownedError` is set (the daemon could not be asked, so every row reads 'discovered').
   */
  launchedBy: 'agent-manager' | 'discovered';
  /** The id of the owned session (equal to `sessionId`); absent for a discovered session. */
  ownedId?: string;
  /** How an owned session is hosted: 'stream-json' (a child of the daemon) or 'hc' (a herdr-core terminal, not observed by the daemon); null when discovered. */
  host: OwnedHostKind | null;
  /** The state the daemon reports; absent for a discovered session. 'unknown': a state this module does not know (the raw value is in `ownedRawState`). */
  ownedState?: OwnedStateDto;
  /** The raw state a newer daemon sent when `ownedState` is 'unknown'. */
  ownedRawState?: string;
  /** Permission requests that wait for an answer (stream-json owned sessions); 0 otherwise. */
  pendingPermissions: number;
  /**
   * Can this session change host now without losing something (#71)? `free`: nothing runs. `busy`: something runs that a switch would interrupt, kill, orphan or not
   * restore (`reasons`: one line per thing, naming what would be lost). `unknown`: a signal could not be read (`reasons`: why): the UI treats it as busy, never as
   * free. A hint computed from the registry, the transcript tail and the sub-agent files; the daemon computes it again when the switch is asked, and its answer wins.
   * The state of an hc terminal is not read for the list (it is, at the moment of the switch).
   */
  adoptReadiness: AdoptReadinessDto;
  /** A stopped owned session whose last move to another host failed after the old host was stopped: where it was going and why it failed. Cleared by the next start. */
  switchFailure?: SwitchFailureDto;
  /** The id of the session this owned session was forked from; absent when it is not a fork. */
  forkedFrom?: string;
  /** A thread (a fork that stops at a message): the source session and the uuid of its transcript entry (a log row). Always with `forkedFrom`; absent for a plain fork. */
  threadOf?: { sessionId: string; messageId: string; quote?: string };
  /**
   * True: an owned session that has no Claude Code registry file yet (a stream-json child writes it with its first message). The row is made from the owned
   * record alone: `pid` is the child's pid (0 when unknown), `status` follows `ownedState`, there is no transcript yet (see `activityNote`).
   */
  registryPending?: boolean;
}

/** A switch that stopped the session and could not start it on the target (#71): the page offers "Start on <target>" and says why. */
export interface SwitchFailureDto {
  /** Epoch ms. */
  at: number;
  target: OwnedHostKind;
  reason: string;
}

export interface AdoptReadinessDto {
  state: 'free' | 'busy' | 'unknown';
  /** Empty when free. */
  reasons: string[];
}

/** GET /sessions answer when the registry was read. */
export interface SessionsOk {
  ok: true;
  show: 'alive' | 'all';
  /** ISO time of the answer. */
  generatedAt: string;
  /** Most recent status change first. */
  sessions: SessionRowDto[];
  /** The user's custom groups in display order (empty when none, or when the state file cannot be read: see `userStateError`). */
  customGroups: CustomGroupDto[];
  /**
   * Set when the pins and seen markers could not be read or saved (file unreadable): the sessions are still listed (no pins, never overwritten); show
   * this text. Empty when everything is fine.
   */
  userStateError: string;
  /** Registry files that could not be read, shown by the UI (never dropped). */
  unreadable: { file: string; reason: string }[];
  /** One line about `unreadable`, empty when there is none. */
  unreadableText: string;
  /** Dead sessions hidden by show=alive. */
  hiddenDead: number;
  /** Text to show instead of an empty list; empty when there are sessions. */
  emptyText: string;
  /**
   * Set when the daemon could not be asked (not running, unreachable, refused the token): the owned fields of the rows are then NOT known (every row reads
   * 'discovered', owned sessions without a registry file are missing). `code` 'daemon-not-running' is the normal state of a user who launches no session
   * from agent-manager: show it as a quiet note, not as a failure; any other code is a real problem. null when the daemon answered.
   */
  ownedError: ApiError | null;
  /** `ownedError` message and hint in one line; empty when there is none. */
  ownedErrorText: string;
  /** Set only when the daemon cannot be asked AND owned-sessions.json lists at least one session: those owned sessions turned into plain rows (no Stop, Resume, Move). null otherwise (never for a user who never used the daemon). */
  ownedDown: OwnedDown | null;
  /** The banner text of `ownedDown` (count, why the actions are missing, the fix); empty when null. */
  ownedDownText: string;
  /** Set when the daemon is down and owned-sessions.json cannot be used (unreadable, not JSON, unknown version): the file, why and the fix. Empty otherwise. */
  ownedStateErrorText: string;
}

/** Owned sessions listed in owned-sessions.json while the daemon cannot be asked: how many, and the command or hint that fixes it. */
export interface OwnedDown {
  count: number;
  fix: string;
}

/** GET /sessions answer when the registry cannot be read (HTTP 200, no list). */
export interface SessionsFailed {
  ok: false;
  error: { code: string; message: string; hint: string };
  /** message and hint in one line. */
  errorText: string;
  sessions: [];
  customGroups: [];
  userStateError: '';
}

export type SessionsResponse = SessionsOk | SessionsFailed;

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The status line data (what the Claude Code status line shows): model, context, tokens, duration, branch, role, bypasses
// ---------------------------------------------------------------------------------------------------------------------------------------------------
//
// Every field is OPTIONAL and read-only data of the user's own machine. An absent field means "not available", and the reason is in `statusNote` (never a
// silent empty). Sources, from Claude Code 2.1.3xx transcripts (details: .claude/specs/2026-11-14_agent-fleet-manager/research/statusline-data-in-transcripts.md):
//   model            EXACT name and id when the transcript holds the `model` attachment (written at start and at each change); else derived from the id of
//                    the last assistant message with a data table (`known: false` = id not in the table, shown raw).
//   contextUsedPct   share of the AUTO-COMPACT point (window - 33k), not of the window: round(contextTokens / compactAtTokens * 100). The window and the point
//                    are estimates (see ContextUsedDto): basis 'estimate'.
//   tokensIn/Out     the status line's "total_input_tokens" / "total_output_tokens" are NOT running totals: they are the prompt size (input + cache creation +
//                    cache read) and the output of the LAST API call. Same numbers here, read from the last assistant message of the transcript tail.
//   durationMs       now - registry startedAt (the Claude process start). The status line's `cost.total_duration_ms` is a wall clock since the session started
//                    that Claude Code restores on resume: equal for a session that was not resumed, larger after a resume. Not recoverable from the transcript
//                    of a live session (the cost-state line is only written when the session ends).
//   gitBranch        `git -C <cwd> branch --show-current`, cwd from the registry only; absent when not a repository or on a detached HEAD.
//   role             the file <cwd or a parent>/.claude/session/roles/<sessionId>, as the status line reads it.
//   bypasses         the overrides of this session in <cwd>/.claude/w-guardrails/guardrails.bypass.json that are not expired.

/** A model as the UI shows it. */
export interface ModelDto {
  /** The raw id (assistant `message.model`, or the attachment `modelId` with the provider prefix and the `[1m]` tag); absent when only the name is known. */
  id?: string;
  /** "Sonnet 5.5", "Opus 5.5 (1M context)"; the raw id when the model is not in the table. */
  displayName: string;
  /** False when the id is not in the model table: `displayName` is then the raw id, show it with a visible "unknown model" mark. */
  known: boolean;
}

/** How close the session is to its auto-compact. */
export interface ContextUsedDto {
  /** 0..100, an integer: the context size over the auto-compact point (`compactAtTokens`), NOT over the window (100 = Claude Code compacts at the next turn). */
  value: number;
  /**
   * 'estimate' whenever the window had to be assumed (always today: the window is not written in the transcript). 'exact' is reserved for a window read
   * from Claude Code itself; the UI says in the tooltip that the window and the auto-compact point are assumed.
   */
  basis: 'estimate' | 'exact';
  /** Where the window comes from and what it is ("Sonnet 5.5 was observed above 200k tokens without the [1m] tag: 1000k window assumed"). */
  note: string;
  /** The context window assumed for the model. */
  windowTokens: number;
  /** The context size at which auto-compact is assumed to fire (window - 33k: 967k for 1M, 167k for 200k). Not read from Claude Code: /autocompact can lower it. */
  compactAtTokens: number;
  /** The context size of the last call (prompt: input + cache creation + cache read). */
  usedTokens: number;
}

/** One active w-guardrails bypass of the session. */
export interface BypassDto {
  /** Raw category ('git-commit-push'). */
  category: string;
  /** Short label as the status line shows it ('c&p' for git-commit-push). */
  label: string;
  /** Time left or uses left, as the status line shows it ('1h52m', '10m', '<1m', '2x'). */
  left: string;
  /** Milliseconds left; absent for a bypass counted in uses ('2x'). */
  leftMs?: number;
}

/** The status line data of one session. Shared by the rows of GET /sessions and by `status` of GET /sessions/:id/log. */
export interface SessionStatusDto {
  /** The current model: the one of the last assistant message of the main session. Absent while no assistant message exists (see statusNote). */
  model?: ModelDto;
  /** Models used before, most recent first, found in the part of the transcript that was read (a tail window: not the whole history). */
  previousModels?: ModelDto[];
  contextUsedPct?: ContextUsedDto;
  /** Prompt size of the last API call (input + cache creation + cache read): the status line's "total_input_tokens". EXACT. */
  tokensIn?: number;
  /** Output tokens of the last assistant message: the status line's "total_output_tokens". EXACT, but it grows while the message streams. */
  tokensOut?: number;
  /** Milliseconds since the registry `startedAt` of the session (see the notes above for the difference with the status line); absent without startedAt. */
  durationMs?: number;
  /** Current git branch of the working directory; absent when it is not a repository, the folder is gone, or HEAD is detached. */
  gitBranch?: string;
  /** Set when git could not be run (missing, timeout): visible text with what to do. A folder that is not a repository is NOT an error. */
  gitBranchError?: string;
  /** Absent: no role; 'autonomous-worker': the role (the "role-" prefix dropped); '!role-err:<cause>': the role file is broken (show it as an error). */
  role?: string;
  /** Active bypasses, sorted by label; absent when the file does not exist; [] when it exists with none for this session. */
  bypasses?: BypassDto[];
  /** Set when the bypass file exists but cannot be read or parsed: visible text, never an empty list. */
  bypassError?: string;
  /** Why model, context or tokens are absent ("No transcript yet", "No assistant message yet"); absent when nothing is missing. */
  statusNote?: string;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// POST /sessions/:sessionId/pin {pinned: boolean}   and   POST /sessions/:sessionId/seen (no body): existing routes, unchanged.
// ---------------------------------------------------------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// GET /sessions/:sessionId/log
// ---------------------------------------------------------------------------------------------------------------------------------------------------
//
// Query (all optional, at most one of `before` and `after`):
//   (none)          the newest `limit` entries of the transcript (the first load, also the reload after a 'cursor-stale' error)
//   before=<cursor> the `limit` entries just before `olderCursor` of a previous answer (scroll up)
//   after=<cursor>  what was written since `cursor` of a previous answer (poll, every few seconds)
//   limit=<n>       entries wanted, 1 to 500, default 100 (a response can hold fewer: see LogTruncation)
//   inlineErrors    accepted and ignored: every error of this route is already HTTP 200 / 4xx with { ok: false, error }
//
// Merging entries on the client. Entries come in file order (oldest first). `key` identifies an entry inside one transcript.
// - A tool call is ONE entry (the call and its result merged). A call still running is sent with status 'running'; every `after` answer sends the calls
//   that are still running again (same key, complete when the result arrived): REPLACE the entry that has this key, keep its position.
// - A `before` page is oldest-first too: put it in front of what you have.
// - Safety net: when an answer holds a key you already have, keep ONE copy: the one of the newer answer for `after`, the one of the older page for `before`
//   (it is complete). This only happens for a call whose result was more than about 1 MiB away from it; such a result arrives alone with `orphan: true`
//   (show it as "tool result" without a name).
// - Entries of kind 'usage' (token counts) and 'model-info' (the model attachment) are never sent: the model and the context are in `status`.
// - Entries of kind 'model-change' ARE sent, in the timeline where the model changed: `text` is ready to show ("Model changed: Sonnet 4.6 -> Haiku 5.5"),
//   `from` / `to` are ModelRef ({id?, displayName, known}), `source` says whether `/model` or the first message of the new model showed it,
//   `scope` ('session' | 'default') is set for a command. Render it as a visible notice row (like a system notice), never hidden.
// - The activity of a `before` answer describes the older window: ignore it, keep the one of the newest answers.

/** A transcript entry in JSON (the Entry type of the core transcript reader, see packages/agent-manager-core/src/transcript/types.ts). */
export type LogEntry = import('@wadeck-app/agent-manager-core/transcript').Entry;

/** One sub-agent of the session. */
export interface SubagentDto {
  agentId: string;
  /** 'general-purpose', 'Explore', 'fork', ... when known. */
  agentType?: string;
  description?: string;
  name?: string;
  /** The sub-agent marked itself finished (its meta says `finished: true`; real metas never say false, an old one says nothing). */
  finished: boolean;
  /**
   * What the server can tell, from facts only: 'unknown' when its transcript exists but could not be read (`readError` says why); 'failed' when the meta says
   * `stoppedByUser`; 'finished' when it says `finished`; else 'active' when its transcript was written in the last 10 minutes (or does not exist yet: just
   * started), else 'idle' (not marked finished and silent: it may be done, it may be stuck). 'active' is a HEURISTIC, not a fact: there is no end marker and the
   * file was written lately, so it is probably running; show it as such. The UI also shows a sub-agent as failed when the call that started it is loaded and failed.
   */
  status: 'active' | 'finished' | 'failed' | 'idle' | 'unknown';
  /** Why `status` is 'unknown': what failed while reading its transcript. */
  readError?: string;
  /** Why `status` is 'failed', in words ('Stopped by the user'). */
  failureReason?: string;
  /** Epoch ms of the first timestamped line of its transcript, else the creation time of the file. Absent when the transcript does not exist yet. */
  startedAt?: number;
  /** Epoch ms of the last write to its transcript. Absent when the transcript does not exist yet. */
  lastActivityAt?: number;
  /** Epoch ms of the end: the last write, only for 'finished' and 'failed' (an approximation: the file is not touched after the last line). */
  endedAt?: number;
  isFork: boolean;
  model?: string;
  /** The tool call (LogEntry kind 'tool-call', field `id`) of the parent that started it. */
  toolUseId?: string;
  /** The parent sub-agent, absent for a direct child of the main session. */
  parentAgentId?: string;
  children: SubagentDto[];
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// GET /sessions/:sessionId/log/locate?toolUseId=<id>
// ---------------------------------------------------------------------------------------------------------------------------------------------------
//
// Where is the tool call that started a sub-agent? A byte search of the transcript (one pass, nothing parsed), so a call 20 000 lines back is found in one
// request instead of by paging. `offset` is the `offset` of the entry of that call (a line start): load older pages (`before`) until the oldest entry you
// hold has an offset at or below it. `found: false` means no line of the transcript of the session holds the call: it was written by another sub-agent (whose
// own transcript is not served) or the transcript was rewritten. Local paths are never sent. 400 'bad-request' for a malformed `toolUseId`.

export interface LocateOk {
  ok: true;
  sessionId: string;
  toolUseId: string;
  found: boolean;
  /** The offset of the line of the call, when found. */
  offset?: number;
  /** Size of the transcript read (0 when there is none yet). */
  transcriptBytes: number;
}

export type LocateResponse = LocateOk | ApiFailure;

/** The activity of the session over the entries of THIS answer (a window, not the whole transcript): see `scope`. */
export interface LogActivity {
  /** 'window': computed from the entries of this answer only (counts and tokens are partial). */
  scope: 'window';
  /** Epoch ms of the last prompt written by a person. */
  lastPromptAt?: number;
  /** Epoch ms of the last assistant line. */
  lastAssistantAt?: number;
  /** "Bash: npm test" of the most recent tool call. */
  lastToolSummary?: string;
  /** Tool calls without a result yet (at most 20). */
  runningToolCalls: LogEntry[];
  /** Tokens counted in the window (input + output + cache creation). */
  tokensTotal: number;
  /** Estimated size of the context after the last message of the window. */
  contextEstimate: number;
  /** Turns started in the window. */
  turnsCount: number;
  /** Failed tool calls and error notices in the window. */
  errorsCount: number;
}

/** What the server cut, so the UI never shows a silent gap. */
export interface LogTruncation {
  /** Entries whose text, tool input or result preview the SERVER shortened to `limits` (their own `*Truncated` flags are set too). */
  fieldsCut: number;
  /** True when the answer holds fewer entries than `limit` because the body size cap was reached (more is available through `olderCursor` / `more`). */
  bodyCapped: boolean;
  /** Lines the core reader could not show as entries (too long, not JSON): they appear as entries of kind 'oversize' / 'unparsable'; this counts them. */
  unreadableLines: number;
}

/** The limits applied by the server (characters), so the UI can say "N more characters". */
export interface LogLimits {
  /** Text of a prompt, an assistant text or a thinking block. */
  textChars: number;
  /** Serialised tool input beyond this is replaced by `{}` (inputSummary stays). */
  inputChars: number;
  /** Tool result preview. */
  resultPreviewChars: number;
  /** Largest `limit`. */
  maxEntries: number;
  /** Size cap of the entries of one answer (bytes of JSON). */
  maxBodyBytes: number;
}

export interface LogOk {
  ok: true;
  sessionId: string;
  /** Entries in file order, oldest first (see the merging notes above). */
  entries: LogEntry[];
  /**
   * Pass as `after` to get what is written next. Null on a `before` answer (the newest end did not change: keep the cursor you have).
   * Opaque: never build or parse it.
   */
  cursor: string | null;
  /** Pass as `before` to get older entries; null when the transcript start is reached. Opaque. */
  olderCursor: string | null;
  /** Only for `after` answers: more is already written (the read was capped): ask again at once. */
  more: boolean;
  /** Sub-agent tree of the session (roots), empty when none. */
  subagents: SubagentDto[];
  /** Problems reading the sub-agents folder, shown not hidden; empty when fine. */
  subagentsNote: string;
  activity: LogActivity;
  /** The status line data of the session (model, context, tokens, branch, role, bypasses), same shape and sources as in the rows of GET /sessions. */
  status?: SessionStatusDto;
  truncated: LogTruncation;
  limits: LogLimits;
  /** Set (with empty entries) when the session has no transcript yet; empty otherwise. */
  note: string;
}

/** Codes of LogFailed: 'unknown-session' (404), 'bad-request' (400), 'registry-unreadable', 'transcript-unreadable', 'cursor-stale' (reload without cursor), 'cursor-invalid' (400). */
export type LogResponse = LogOk | ApiFailure;

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// POST /sessions/:sessionId/reply
// ---------------------------------------------------------------------------------------------------------------------------------------------------
//
// Body: JSON, at most 1 MiB for the whole request (app-core limit): base64 adds a third, so the images together must stay under about 700 KB
// (`limits.maxImageBytes`). Only the path of a saved image goes to the agent, never its bytes.

export interface ReplyImageDto {
  /** File name as the user knows it (informational, never used as a path). */
  name: string;
  /** 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; checked against the first bytes of the file. */
  mime: string;
  /** Plain base64 of the file bytes (no "data:" prefix). */
  dataBase64: string;
}

export interface ReplyRequest {
  /** The text, at most `limits.maxTextChars` characters; may be empty when an image is attached. */
  text: string;
  /** At most `limits.maxImages` images. */
  images?: ReplyImageDto[];
  /** 'next' (default): after the current tool call; 'now' aborts the running tool call and needs `confirmNow: true` (ask the user first). */
  priority?: 'next' | 'now';
  /** Must be true with priority 'now'. */
  confirmNow?: boolean;
  /** A message id made by the client (letters, digits, '_', '-', up to 128): sending the same id again never sends twice (safe retry). Default: server made. */
  messageId?: string;
}

/** How the session sees a delivered message: 'peer' = peer message (wrapped by Claude Code, "not typed by your user"); 'typed' = typed prompt (as the user, full user authority). */
export type DeliveredAs = 'peer' | 'typed';

/** The state of a reply, from the core delivery state machine. */
export type DeliveryStateName = 'queued' | 'sent' | 'queued-in-session' | 'confirmed' | 'unconfirmed' | 'expired' | 'unknown';
// 'unknown': the message WAS sent, but its state could not be computed (a bug of agent-manager); `reason` carries the error, never a guess.

/** What the composer shows: 'sending' (held, not picked up yet), 'delivered' (accepted by the transport / queued in the session), 'seen' ("seen by agent"), 'failed'. */
export type DeliveryUi = 'sending' | 'delivered' | 'seen' | 'failed';

export interface ReplyOk {
  ok: true;
  /** The state right after the send: 'sent' (direct transport wrote it) or 'queued' (mailbox transport holds it). */
  deliveryState: DeliveryStateName;
  /** What the composer shows now. */
  deliveryUi: DeliveryUi;
  transportId: string;
  /** How the session sees the message: 'peer' (wrapped by Claude Code) or 'typed' (as the user typed it). */
  deliveredAs: DeliveredAs;
  /** An identifier the transport gave the delivery (hc: `t2#turn7`); empty when it has none. Informational. */
  handle: string;
  messageId: string;
  /** True when this id was already sent: nothing was sent again. */
  duplicate: boolean;
  /** Set when the message WAS delivered but its audit line could not be written: do not send it again. Empty otherwise. */
  auditWarning: string;
  /** Number of images saved and referenced by path. */
  imagesSaved: number;
}

/** Codes: 'bad-request' (400), 'unknown-session' (404 or 200), 'session-dead', 'terminal-blocked' / 'no-terminal' / 'ambiguous-terminal' / 'terminal-gone' (409, hc transport), 'rate-limited' (429, hc transport), 'hc-missing' / 'hc-timeout' / 'hc-send-failed' (502), 'transport-unavailable', 'transport-refused', 'no-token-file', 'confirm-now-required', 'text-too-long', 'upload-too-large', 'unsupported-image', 'mime-mismatch', 'transports-invalid', ... (the code of the core ReplyError, with its `fix` as `hint`). */
export type ReplyResponse = ReplyOk | ApiFailure;

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// POST /sessions/batch/reply {ids: string[], text: string, requestId?: string}  (sensitive: ONE PIN prompt for the whole batch)
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * What happened to one recipient. sent: handed over (a direct transport). queued: held by a mailbox transport. refused: nothing was sent (dead or unknown session,
 * transport unavailable, rate limit). maybe-sent: the outcome is unknown (timeout, lost connection): the message may have arrived, NEVER retried by the module,
 * look at the log of the session. failed: something else went wrong, nothing is known to have been sent.
 */
export type BatchRecipientState = 'sent' | 'queued' | 'refused' | 'maybe-sent' | 'failed';

export interface BatchRecipientResult {
  id: string;
  /** The registry name of the session, its folder name when it has none, the id when it is unknown. */
  name: string;
  state: BatchRecipientState;
  /** Why (message and fix), empty for a plain 'sent' or 'queued'. */
  reason: string;
}

export interface BatchReplyOk {
  ok: true;
  /** One entry per recipient, in the order asked. */
  results: BatchRecipientResult[];
  counts: Record<BatchRecipientState, number>;
}

export type BatchReplyResponse = BatchReplyOk | ApiFailure;

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// GET /sessions/:sessionId/reply/status
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export interface TransportStatusDto {
  transportId: string;
  description: string;
  /** 'direct' (written into the session now) or 'mailbox' (waits until a hook picks it up). */
  kind: string;
  /** False: this transport was NOT probed (only the selected one is, unless the request says `?probe=all`): `available` and `reason` are placeholders. */
  probed: boolean;
  /** This transport can deliver to the session now. */
  available: boolean;
  /** Why it is available or not, one sentence. */
  reason: string;
  /** What to do when it is not available; empty when it is. */
  fix: string;
  /** Warnings of the probe (never a token); empty when none. */
  warnings: string[];
  /** The transport a send uses without an explicit choice. */
  selected: boolean;
  /** This transport is the global default (transports.json "default"). */
  isDefault: boolean;
  /** This transport is the override of THIS session (transports.json "perSession"). */
  sessionOverride: boolean;
  /** How the session sees what this transport delivers. */
  deliveredAs: DeliveredAs;
  /** The wording to show: 'peer message (wrapped by Claude Code)' or 'typed prompt (as the user)'. */
  deliveredAsText: string;
  /**
   * The marker line a reply sent through THIS transport starts with: 'none' (the text as typed, the default), 'short' (`[agent-manager-web #<id>]`) or 'full'
   * (`[web reply via agent-manager #<id>]`). A transport that never adds one (owned) is 'none' whatever the setting. null: the `replyMarker` setting could not
   * be read (see `warnings` of the status).
   */
  marker: ReplyMarkerMode | null;
}

/** The `replyMarker` setting (config.yml, `agent-manager reply-marker`). Delivery confirmation does not depend on it (D-2026-11-19-a). */
export type { ReplyMarkerMode };

export interface ReplyMarkerDto {
  /** null when the setting could not be read: the status warnings say why and how to fix it. */
  mode: ReplyMarkerMode | null;
  /** 'config.yml' when the file sets it, 'default' when not; empty when unreadable. */
  source: 'config.yml' | 'default' | '';
  /** One sentence for the UI: what is sent in front of the text. */
  text: string;
}

/** One recent reply to the session. */
export interface ReplyMessageDto {
  messageId: string;
  /** Epoch ms of the attempt. */
  sentAt: number;
  /** The text the user typed (as audited). */
  text: string;
  imageCount: number;
  transportId: string;
  priority: string;
  /** Raw state; 'failed' when nothing was sent (see `reason`). */
  state: DeliveryStateName | 'failed';
  ui: DeliveryUi;
  /** Why the state was reached (tooltip). */
  reason: string;
  /** Set with an 'unconfirmed' state: what probably happened and what to do. */
  hint: string;
}

export interface ReplyStatusLimits {
  /** Characters of the text. */
  maxTextChars: number;
  maxImages: number;
  /** Decoded bytes of ONE image (the request body is capped at 1 MiB in all, base64 included). */
  maxImageBytes: number;
  /** Largest request body, bytes. */
  maxBodyBytes: number;
}

export interface ReplyStatusOk {
  ok: true;
  sessionId: string;
  /** The session accepts replies only while its process is alive. */
  sessionAlive: boolean;
  /** Where `selected` comes from: 'default' (no transports.json: the built-in default), 'transports.json', or 'transports.json (session override)'. */
  selectedFrom: string;
  /** The transport a reply uses now (the session override, else the default). */
  selectedTransportId: string;
  defaultTransportId: string;
  /** The override of this session, null when it follows the default. */
  sessionOverrideTransportId: string | null;
  /** Transports known to the module (implemented ones only) with their availability for this session. */
  transports: TransportStatusDto[];
  /** The `replyMarker` setting: what replies start with (see also `transports[].marker`, which accounts for the transport). */
  replyMarker: ReplyMarkerDto;
  /** The last replies to this session, newest first (at most 10, from the audit). */
  messages: ReplyMessageDto[];
  /** Problems reading the audit or the transcript (shown, never hidden); empty when fine. */
  warnings: string[];
  limits: ReplyStatusLimits;
}

/** Codes: 'unknown-session' (404), 'transports-invalid', 'transports-unreadable', 'registry-unreadable'. */
export type ReplyStatusResponse = ReplyStatusOk | ApiFailure;

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// PUT /sessions/:sessionId/reply/transport   and   PUT /reply/transport/default
// ---------------------------------------------------------------------------------------------------------------------------------------------------
//
// The transport is a setting (transports.json, also changed by `agent-manager transport set`), never a field of POST reply (a transport field there is
// a 400 'bad-request' that names these routes). Changing it sends nothing. Availability is NOT required to select a transport (GET .../reply/status says
// whether it works now); a reply that cannot go out through the selected transport fails with its reason, it never falls back to another one.

/** Body of PUT /sessions/:sessionId/reply/transport: a transport id, or null to follow the default again. */
export interface ReplyTransportSetRequest {
  transportId: string | null;
}

export interface ReplyTransportSetOk {
  ok: true;
  sessionId: string;
  /** What a reply to this session uses now. */
  selectedTransportId: string;
  /** The override of this session, null when it follows the default. */
  sessionOverrideTransportId: string | null;
  defaultTransportId: string;
}

/** Codes: 'bad-request' (400), 'unknown-transport' (400, the message lists the valid ids), 'unknown-session' (404), 'registry-unreadable' (409), 'transports-invalid' / 'transports-unreadable' (502: fix or delete transports.json). */
export type ReplyTransportSetResponse = ReplyTransportSetOk | ApiFailure;

/** Body of PUT /reply/transport/default. */
export interface ReplyDefaultTransportSetRequest {
  transportId: string;
}

export interface ReplyDefaultTransportSetOk {
  ok: true;
  defaultTransportId: string;
}

/** Codes: 'bad-request' (400), 'unknown-transport' (400), 'transports-invalid' / 'transports-unreadable' (502). */
export type ReplyDefaultTransportSetResponse = ReplyDefaultTransportSetOk | ApiFailure;

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// GET /csrf   and   the 403 of every write route (header name and rules: ./csrf.ts)
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export interface CsrfOk {
  ok: true;
  /** The header to send with every non-GET request: 'X-Agent-Manager-Csrf'. */
  header: string;
  /** Valid until the module restarts. Never log it or put it in a URL. */
  token: string;
}

/** Codes of the 403 of a write route (body `{ ok: false, error }`): 'csrf-required' (no `Sec-Fetch-Site: same-origin`, or no token header), 'csrf-invalid' (token not issued by this module run: fetch a new one, retry once). */
export type CsrfResponse = CsrfOk | ApiFailure;

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Owned sessions: GET /owned, POST /owned/launch, POST /owned/:id/{interrupt,permission-mode,stop,resume,forget}, GET /owned/:id/permissions,
// POST /owned/:id/permissions/:requestId
// ---------------------------------------------------------------------------------------------------------------------------------------------------
//
// The module calls the agent-manager daemon (which owns the sessions launched from here). The daemon is optional: when it is not running, GET routes answer
// HTTP 200 `{ ok: false, error }` (never an empty list), and a write route answers 409 'daemon-not-running' with the fix ('agent-manager start --detach').
// Every write route needs the CSRF header like the other write routes. Errors of the daemon keep its code, status and fix (reason -> message, fix -> hint).
// Codes of this layer: 'daemon-not-running' (GET: 200, write: 409), 'daemon-unreachable' / 'daemon-unauthorized' / 'daemon-bad-answer' (GET: 200, write: 502),
// 'bad-request' (400). Codes of the daemon (status as the daemon gave it): 'unknown-session' (404), 'session-not-live' / 'session-exited' / 'already-live' /
// 'session-live' / 'too-many-sessions' / 'leftover-alive' / 'not-owned' / 'permission-being-answered' (409), 'invalid-*' / 'cwd-*' (400), others 422 or 502.

/** 'bg': a Claude Code background session (`claude --bg`): hosted by its supervisor, only observed by the daemon, permission prompts answered in a terminal. */
export type OwnedHostKind = 'stream-json' | 'hc' | 'bg';

/**
 * idle / running / requires_action: a live stream-json child (requires_action: it waits for a permission decision); exited: the process ended; interrupted: the
 * daemon that owned it ended while it was live (a resume continues the conversation, the lost turn is NOT replayed); unobserved: an hc session (the daemon does
 * not see its terminal: its state is the registry's); unknown: a state of a newer daemon (the raw value is in `rawState`; show it, do not guess).
 */
export type OwnedStateDto = 'idle' | 'running' | 'requires_action' | 'exited' | 'interrupted' | 'unobserved' | 'unknown';

export interface OwnedMessageDto {
  uuid: string;
  /** 'unknown': a state of a newer daemon (the raw value is in `rawState`). */
  state: 'queued' | 'started' | 'completed' | 'cancelled' | 'lost' | 'unknown';
  rawState?: string;
  /** Epoch ms of the last change. */
  at: number;
}

export interface OwnedExitDto {
  cause: string;
  code: number | null;
  signal: string | null;
  by: 'self' | 'user' | 'daemon-shutdown';
  /** Bounded tail of the stderr of the process (may be empty). */
  stderrTail: string;
  at: number;
}

export interface OwnedSessionDto {
  /** The Claude Code session id (the registry id, the transcript name). */
  id: string;
  hostKind: OwnedHostKind;
  cwd: string;
  model?: string;
  /** The mode at start, then the last one set through the daemon. */
  permissionMode?: string;
  /** The label given at launch (stream-json) or the terminal name (hc). */
  name?: string;
  /** `claude --version` as the daemon ran it at launch. */
  claudeVersion: string;
  /** Epoch ms. */
  startedAt: number;
  /** What the state file remembers: 'live', 'exited' or 'interrupted'. */
  status: 'live' | 'exited' | 'interrupted';
  state: OwnedStateDto;
  /** The raw state a newer daemon sent when `state` is 'unknown'. */
  rawState?: string;
  /** True when POST /owned/:id/resume is accepted now. */
  resumable: boolean;
  pendingPermissions: number;
  /** What to know about the state, in words (an interrupted turn is not replayed). */
  note?: string;
  pid?: number;
  /** hc: the terminal address ('t1z'). */
  hcAddress?: string;
  /** bg: the short id of the supervisor job (what `claude attach`, `stop`, `respawn` and the removal command take). */
  jobId?: string;
  /** A claude process of an interrupted session that is still alive after a daemon crash (never killed automatically; a resume then needs acknowledgeLeftover). */
  leftoverPid?: number;
  lastResult?: { subtype: string; isError: boolean; stopReason?: string; text?: string; at: number };
  /** The last messages sent through the daemon and what became of them (at most 50). */
  messages: OwnedMessageDto[];
  exit?: OwnedExitDto;
  interruptedAt?: number;
  resumedAt?: number;
  /** stream-json: the id of the session this one was forked from (it continues a copy of that history). */
  forkedFrom?: string;
  /** stream-json thread: the uuid of the transcript entry of the source the fork stops at. */
  forkedAtMessage?: string;
  /** stream-json thread: a one-line quote (at most 80 characters) of that message, for the chip. */
  forkedAtQuote?: string;
  /** The changes of host of this session, oldest first (the id never changes). */
  switches?: { at: number; from: OwnedHostKind; to: OwnedHostKind; forced: boolean }[];
  /** Set when a move stopped the old host and the target did not start (see SwitchFailureDto). */
  switchFailure?: SwitchFailureDto;
  /** bg: the `state` of `claude agents --json` at the last poll (working, blocked, done, failed, stopped). */
  bgState?: string;
  /** bg: what the session waits on (`permission prompt`, `input needed`, ...). Answered only in a terminal: see `attachCommand`. */
  waitingFor?: string;
  /** bg: the command that opens the session in a terminal, where its permission prompts are answered. */
  attachCommand?: string;
  /** bg: why the daemon could not read `claude agents --json` at its last poll (the state shown is the last one it saw). */
  observeError?: string;
}

export interface DaemonStatusDto {
  pid: number;
  startedAt: number;
  uptimeMs: number;
  owned: { total: number; live: number; idle: number; running: number; requiresAction: number; exited: number; interrupted: number; unobserved: number };
  /** Processes of lost children that are still alive (see `leftoverPid`). */
  leftovers: number;
  /** The daemon is shutting down: launches are refused. */
  stopping: boolean;
  version?: string;
  /** Control port, sessions API port, and the config folder the daemon runs for. */
  port?: number;
  apiPort?: number;
  configDir?: string;
}

/** GET /owned. Polled by the UI; the daemon is asked once for the list (cached 1.5 s) and once for its status. */
export interface OwnedListOk {
  ok: true;
  generatedAt: string;
  daemon: DaemonStatusDto;
  /** Newest launch first. */
  sessions: OwnedSessionDto[];
}

/** GET /owned when the daemon cannot be asked (HTTP 200). `error.code`: 'daemon-not-running' | 'daemon-unreachable' | 'daemon-unauthorized' | 'daemon-bad-answer'. */
export interface OwnedListFailed {
  ok: false;
  generatedAt: string;
  error: ApiError;
  /** message and hint in one line. */
  errorText: string;
  daemon: null;
  sessions: [];
}

export type OwnedListResponse = OwnedListOk | OwnedListFailed;

/** Body of POST /owned/launch (no other field). `cwd` must be an absolute path of an existing folder. */
export interface OwnedLaunchRequest {
  hostKind: OwnedHostKind;
  cwd: string;
  model?: string;
  permissionMode?: string;
  name?: string;
}

/**
 * Body of POST /owned/fork: starts a NEW Web session (stream-json, owned by the daemon) that continues a copy of the conversation of `sourceSessionId`, in the
 * same folder. The source can be any session of the list (owned or discovered) that has a transcript; it stays untouched. Omitted: `name` is "fork of <name>",
 * `model` and `permissionMode` are the ones of the source when it is an owned session that knows them, else Claude Code decides.
 */
export interface OwnedForkRequest {
  sourceSessionId: string;
  name?: string;
  model?: string;
  permissionMode?: string;
  /**
   * A thread: the uuid of a log row (`LogEntry.uuid`). The new session then knows the source only up to and including that entry (`--resume-session-at`, a hidden
   * flag of Claude Code); the name defaults to "thread of <name>". Refused: an unknown uuid (404 fork-anchor-not-found), a fourth live thread of one source (409 too-many-threads).
   */
  atMessageId?: string;
  /** With atMessageId: a one-line quote of the message (at most 80 characters), kept in the record of the thread for its chip. */
  atMessageQuote?: string;
}

/** POST /owned/fork answer: the new session, and the model and mode that were taken from the source's record because the body did not give them (empty when none). */
export interface OwnedForkOk {
  ok: true;
  session: OwnedSessionDto;
  inherited: { model?: string; permissionMode?: string };
}

/** Body of POST /owned/:id/switch: the host to move to, and `force` only after the user confirmed the reasons the session is not free. */
export interface OwnedSwitchRequest {
  target: 'stream-json' | 'hc';
  force?: boolean;
}

/**
 * POST /owned/:id/switch answer: the same session (same id) on its new host. `readiness` is what the daemon found AT THE MOMENT of the switch (the reasons the user
 * acknowledged when `forced`); `notes` is what stays to know (a stale registry file, an orphaned tool, a terminal that could not be removed).
 * A refusal (409 `switch-not-ready`) carries the reasons in its message and `force` in its hint: nothing was stopped.
 */
export interface OwnedSwitchOk {
  ok: true;
  session: OwnedSessionDto;
  from: OwnedHostKind;
  to: OwnedHostKind;
  forced: boolean;
  readiness: AdoptReadinessDto;
  notes: string[];
}
export type OwnedSwitchResponse = OwnedSwitchOk | ApiFailure;

/** POST /owned/launch, /stop and /resume answer `{ ok: true, session }`; a launched session is in the list at once (its registry file comes with its first message). */
export interface OwnedSessionOk {
  ok: true;
  session: OwnedSessionDto;
}
export type OwnedSessionResponse = OwnedSessionOk | ApiFailure;

/** POST /owned/:id/interrupt (no body): stops the running turn through the daemon (no text is sent). */
export interface OwnedInterruptOk {
  ok: true;
  sessionId: string;
  /** Messages that stay queued and run next. */
  stillQueued: string[];
  /** Messages the interrupt dropped. */
  cancelled: string[];
}
export type OwnedInterruptResponse = OwnedInterruptOk | ApiFailure;

/** Body of POST /owned/:id/permission-mode: a mode Claude Code knows ('default', 'acceptEdits', 'plan', 'auto'); the daemon validates it. */
export interface OwnedPermissionModeRequest {
  mode: string;
}
export interface OwnedPermissionModeOk {
  ok: true;
  sessionId: string;
  mode: string;
}
export type OwnedPermissionModeResponse = OwnedPermissionModeOk | ApiFailure;

/** Body (optional) of POST /owned/:id/resume. `acknowledgeLeftover`: resume although a claude process of the old daemon may still be alive (see `leftoverPid`). */
export interface OwnedResumeRequest {
  acknowledgeLeftover?: boolean;
}

/** POST /owned/:id/forget (no body): removes an ended session from the list; a live one is refused (409 'session-live'); two actions at once on one bg session: 409 'bg-action-in-progress'. */
export interface OwnedForgetOk {
  ok: true;
  id: string;
  /** bg: what could not be done on the Claude Code supervisor side (the record is removed anyway): `claude rm` refused, `claude agents` failed, or it no longer lists the job. */
  supervisorNote?: string;
}
export type OwnedForgetResponse = OwnedForgetOk | ApiFailure;

/** One permission request that waits for an answer, in full: `input` is what the user decides on (show it escaped, never as HTML). */
export interface OwnedPermissionDto {
  requestId: string;
  toolName: string;
  displayName?: string;
  input: unknown;
  description?: string;
  toolUseId?: string;
  blockedPath?: string;
  /** Epoch ms. */
  receivedAt: number;
}

/** GET /owned/:id/permissions (HTTP 200 `{ ok: false, error }` when the daemon cannot be asked). */
export interface OwnedPermissionsOk {
  ok: true;
  sessionId: string;
  permissions: OwnedPermissionDto[];
}
export type OwnedPermissionsResponse = OwnedPermissionsOk | ApiFailure;

/** Body of POST /owned/:id/permissions/:requestId. `message` is the reason shown to the model, only with 'deny' (default: 'Denied by the user through agent-manager'). An allow is once. */
export interface OwnedDecisionRequest {
  decision: 'allow' | 'deny';
  message?: string;
}
export interface OwnedDecisionOk {
  ok: true;
  sessionId: string;
  requestId: string;
  decision: 'allow' | 'deny';
}
/** Codes: 'unknown-permission-request' (404: already answered or the session ended), 'permission-being-answered' (409), 'session-not-live' (409). */
export type OwnedDecisionResponse = OwnedDecisionOk | ApiFailure;

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Folders: the picker of the New session dialog (GET /folders/roots, /folders/list, /folders/search, /folders/recent)
// ---------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * One folder, as the pickers show it. Only the names of folders are ever sent: no file, no file content. Failures are `ApiFailure` with a 4xx status
 * ('path-not-absolute', 'path-traversal', 'path-unc', 'folder-not-browsable' 403, 'folder-not-found' 404, 'not-a-folder', 'folder-unreadable' 403,
 * each with its hint.
 */
export interface FolderEntryDto {
  /** The last segment of the path. */
  name: string;
  /** The absolute path as the host writes it (the text that fills the Folder field). */
  path: string;
  /** The folder holds a `.git` (folder or file: a worktree). */
  hasGit: boolean;
  /** A session or a launch of this machine ran in exactly this folder. */
  isRecent: boolean;
  /** A folder the search knows: a recent one or a git repository. */
  isKnownProject: boolean;
  /** The entry is a symbolic link or junction (it is listed only when its target is inside the browsable roots). */
  isLink: boolean;
  /** The checked out branch, when the folder is a git repository on a branch (absent on a detached HEAD, or when HEAD cannot be read). */
  branch?: string;
}

/** A folder the pickers may browse from. `source`: 'config' = `launchRoots` of config.yml, 'sessions' = the parent of the folder a session or a launch ran in. */
export interface FolderRootDto {
  path: string;
  name: string;
  source: 'config' | 'sessions';
}

/** GET /folders/roots. `note` is filled when nothing can be browsed or something was skipped (a configured root that no longer exists): always shown by the pickers. */
export interface FolderRootsOk {
  ok: true;
  roots: FolderRootDto[];
  /** The file whose `launchRoots` key holds the configured roots. */
  configFile: string;
  /** Why the launchRoots of config.yml were not used (file, line and fix), '' when they were: the roots are then only the ones derived from the sessions. */
  configProblem: string;
  note: string;
}
export type FolderRootsResponse = FolderRootsOk | ApiFailure;

/** One step of the path from the root to the folder (the first is the root itself, named by its full path). */
export interface FolderCrumbDto {
  name: string;
  path: string;
}

/** GET /folders/list?path=<absolute folder>: the subfolders of a folder inside the roots, sorted by name (digits as numbers), hidden and technical folders left out. */
export interface FolderListOk {
  ok: true;
  path: string;
  name: string;
  /** The parent folder, null at a root (the picker cannot leave the roots). */
  parent: string | null;
  breadcrumbs: FolderCrumbDto[];
  entries: FolderEntryDto[];
  /** More subfolders exist than `limit` entries (or the scan limit was hit): narrow down with the filter, or type the path. */
  truncated: boolean;
  limit: number;
  /** Subfolders not listed: hidden (dot) or technical folders, and links that lead outside the roots. */
  skipped: number;
  hasGit: boolean;
  /** What could not be read or was left out (the registry, a launchRoots problem, working directories that are not local absolute paths), in words; empty when everything was read. */
  warnings: string[];
  branch?: string;
}
export type FolderListResponse = FolderListOk | ApiFailure;

export interface FolderSearchResultDto extends FolderEntryDto {
  /** Epoch ms of the last session or launch in this folder, when it is a recent one. */
  lastUsedAt?: number;
}

/** GET /folders/search?q=: fuzzy search over the known projects (recent folders, and the folders at depth 1 and 2 of the roots; the scan is cached for 30 s). */
export interface FolderSearchOk {
  ok: true;
  query: string;
  results: FolderSearchResultDto[];
  /** More matches exist than were sent, or the scan stopped at its limit. */
  truncated: boolean;
  /** How many folders were looked at. */
  scanned: number;
  /** What could not be read (the registry, the launch roots), in words; empty when everything was read. */
  warnings: string[];
}
export type FolderSearchResponse = FolderSearchOk | ApiFailure;

export interface FolderRecentDto extends FolderEntryDto {
  /** Epoch ms of the last session or launch in this folder. */
  lastUsedAt: number;
  /** How many sessions and launches ran there. */
  uses: number;
  /** The folder still exists (a deleted one is listed so that the user sees why it is not offered for launch). */
  exists: boolean;
}

/** GET /folders/recent: the distinct working directories of the sessions and launches of this machine, most recent first (at most 50). */
export interface FolderRecentOk {
  ok: true;
  folders: FolderRecentDto[];
  warnings: string[];
}
export type FolderRecentResponse = FolderRecentOk | ApiFailure;

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// GET and POST /sessions/:sessionId/hc-permission
// ---------------------------------------------------------------------------------------------------------------------------------------------------
//
// A Claude Code permission dialog of a session that runs in a herdr-core terminal, answered by TYPING the key into that terminal (`hc keys`): enter for
// "Allow once", esc for "Deny". Never "always allow". POST is PIN-sensitive (commons/routeClasses.ts) and needs the CSRF header like every write.

export interface HcPermissionOptionDto {
  number: number;
  label: string;
}

/** The dialog as the terminal shows it now. The decision must carry `promptId`: when the dialog changed in the meantime the server answers 409 'prompt-changed'. */
export interface HcPermissionPromptDto {
  promptId: string;
  /** The herdr-core terminal address (`t21`). */
  terminal: string;
  /** `Bash` for `approve Bash: ...` (what hc reports); absent when it did not say. */
  tool?: string;
  /** First line of the dialog ("Bash command"). */
  header: string;
  /** What the agent said it does ("Create am-allow.txt file"); empty when none. */
  description: string;
  /** The command or change the dialog shows, whole (a dialog longer than the server shows whole is answered in the terminal: state 'unsupported', code 'dialog-too-long'). */
  body: string;
  /** Plain text the dialog shows between the command and the question (the reason of a hook "ask"); empty when none. */
  notice: string;
  question: string;
  options: HcPermissionOptionDto[];
  statusMessage: string;
}

/** `state` 'prompt': a dialog waits. 'none': the terminal is not blocked. 'unsupported': blocked on something this module does not answer (see `reason`, `fix`). */
export type HcPermissionOk =
  | { ok: true; sessionId: string; state: 'prompt'; prompt: HcPermissionPromptDto }
  | { ok: true; sessionId: string; state: 'none'; terminal: string; status: string }
  | { ok: true; sessionId: string; state: 'unsupported'; terminal: string; code: string; reason: string; fix: string };

/**
 * GET: a session that has no herdr-core terminal, or hc that cannot be asked, is `ok: false` with HTTP 200 (data, the card says why it cannot be used).
 * Codes: 'no-terminal' (reason: "... not started in a herdr-core terminal ..."), 'ambiguous-terminal', 'hc-missing', 'hc-cannot-start', 'hc-timeout', 'hc-query-failed',
 * 'hc-bad-answer', 'terminal-gone', 'unknown-session' (404), 'registry-unreadable'.
 */
export type HcPermissionResponse = HcPermissionOk | ApiFailure;

export interface HcPermissionDecisionRequest {
  decision: 'allow' | 'deny';
  /** The `promptId` of the GET answer the user decided on. */
  promptId: string;
}

export interface HcPermissionDecisionOk {
  ok: true;
  sessionId: string;
  decision: 'allow' | 'deny';
  promptId: string;
  terminal: string;
  /** The keys typed ("enter" or "esc"). */
  keys: string[];
  tool?: string;
  /**
   * 'closed': the dialog went away after the keys. 'unchanged': it was still displayed after a few seconds: look at the terminal.
   * 'unknown': the key was sent (or may have been: a timeout) and the terminal could not be read afterwards, see `note`.
   */
  effect: 'closed' | 'unchanged' | 'unknown';
  /** '' unless `effect` is 'unknown': what happened and what to do. */
  note: string;
  /** The status of the terminal after the wait. */
  statusAfter: string;
}

/**
 * Codes of the failures (the message says whether a key was typed; for these codes none was, except 'hc-keys-failed' without a refusal from hc, whose message says it is not known): 'bad-request' (400), 'invalid-decision' (400), 'unknown-session' (404), 'prompt-changed' (409),
 * 'already-answered' (409), 'not-blocked' (409), 'not-a-permission-dialog' (409), 'dialog-not-recognized' (409), 'no-terminal' (409), 'ambiguous-terminal' (409),
 * 'terminal-gone' (409), 'dialog-too-long' (409), 'audit-unwritable' (502), 'hc-missing' / 'hc-cannot-start' / 'hc-timeout' / 'hc-query-failed' / 'hc-keys-failed' / 'hc-bad-answer' (502).
 */
export type HcPermissionDecisionResponse = HcPermissionDecisionOk | ApiFailure;
