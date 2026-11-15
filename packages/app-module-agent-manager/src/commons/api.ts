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
export interface SessionRowDto {
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
// - Entries of kind 'usage' (token counts) are never sent: the context size is in `activity.contextEstimate`.
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
  /** The sub-agent marked itself finished. */
  finished: boolean;
  isFork: boolean;
  model?: string;
  /** The tool call (LogEntry kind 'tool-call', field `id`) of the parent that started it. */
  toolUseId?: string;
  /** The parent sub-agent, absent for a direct child of the main session. */
  parentAgentId?: string;
  children: SubagentDto[];
}

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
  messageId: string;
  /** True when this id was already sent: nothing was sent again. */
  duplicate: boolean;
  /** Set when the message WAS delivered but its audit line could not be written: do not send it again. Empty otherwise. */
  auditWarning: string;
  /** Number of images saved and referenced by path. */
  imagesSaved: number;
}

/** Codes: 'bad-request' (400), 'unknown-session' (404 or 200), 'session-dead', 'transport-unavailable', 'transport-refused', 'no-token-file', 'confirm-now-required', 'text-too-long', 'upload-too-large', 'unsupported-image', 'mime-mismatch', 'transports-invalid', ... (the code of the core ReplyError, with its `fix` as `hint`). */
export type ReplyResponse = ReplyOk | ApiFailure;

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// GET /sessions/:sessionId/reply/status
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export interface TransportStatusDto {
  transportId: string;
  description: string;
  /** 'direct' (written into the session now) or 'mailbox' (waits until a hook picks it up). */
  kind: string;
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
