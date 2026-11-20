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
   * True: an owned session that has no Claude Code registry file yet (a stream-json child writes it with its first message). The row is made from the owned
   * record alone: `pid` is the child's pid (0 when unknown), `status` follows `ownedState`, there is no transcript yet (see `activityNote`).
   */
  registryPending?: boolean;
}

/** GET /sessions answer when the registry was read. */
export interface SessionsOk {
  ok: true;
  show: 'alive' | 'all';
  /** ISO time of the answer. */
  generatedAt: string;
  /** Most recent status change first. */
  sessions: SessionRowDto[];
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
}

/** GET /sessions answer when the registry cannot be read (HTTP 200, no list). */
export interface SessionsFailed {
  ok: false;
  error: { code: string; message: string; hint: string };
  /** message and hint in one line. */
  errorText: string;
  sessions: [];
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
//   contextUsedPct   the formula is Claude Code's (round(contextTokens / window * 100)); the WINDOW is an estimate (see ContextUsedDto): basis 'estimate'.
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

/** Percentage of the context window used. */
export interface ContextUsedDto {
  /** 0..100, an integer, rounded like the status line. */
  value: number;
  /**
   * 'estimate' whenever the window had to be assumed (always today: the window is not written in the transcript). 'exact' is reserved for a window read
   * from Claude Code itself; the UI shows an estimate with a "~" and the `note` as tooltip.
   */
  basis: 'estimate' | 'exact';
  /** Where the window comes from and what it is ("Sonnet 5.5 was observed above 200k tokens without the [1m] tag: 1000k window assumed"). */
  note: string;
  /** The window the percentage is computed with. */
  windowTokens: number;
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
export type DeliveryStateName = 'queued' | 'sent' | 'queued-in-session' | 'confirmed' | 'unconfirmed' | 'expired';

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

export type OwnedHostKind = 'stream-json' | 'hc';

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
  /** A claude process of an interrupted session that is still alive after a daemon crash (never killed automatically; a resume then needs acknowledgeLeftover). */
  leftoverPid?: number;
  lastResult?: { subtype: string; isError: boolean; stopReason?: string; text?: string; at: number };
  /** The last messages sent through the daemon and what became of them (at most 50). */
  messages: OwnedMessageDto[];
  exit?: OwnedExitDto;
  interruptedAt?: number;
  resumedAt?: number;
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

/** POST /owned/:id/forget (no body): removes an ended session from the list; a live one is refused (409 'session-live'). */
export interface OwnedForgetOk {
  ok: true;
  id: string;
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
