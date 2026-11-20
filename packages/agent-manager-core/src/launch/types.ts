/** What the session is doing, derived from the events (see StreamJsonSession). */
export type SessionState = 'idle' | 'running' | 'requires_action' | 'exited';

/** The states of a message that was sent (stream-json `command_lifecycle`, measured in research/session-launch-options.md rounds 1-2). */
export type LifecycleState = 'queued' | 'started' | 'completed' | 'cancelled';

export interface ImageInput {
  /** image/png, image/jpeg, image/gif or image/webp. */
  mediaType: string;
  /** The image bytes as base64 (no data: prefix). The size limits are the caller's. */
  dataBase64: string;
}

export interface ToolUse {
  toolUseId: string;
  name: string;
  input: unknown;
}

/** A `can_use_tool` request the host has not answered yet. The session stays blocked until it is allowed or denied (permission prompts never time out). */
export interface PendingPermission {
  /** The `request_id` of the control_request, echoed in the answer. */
  requestId: string;
  toolName: string;
  displayName?: string;
  input: unknown;
  description?: string;
  toolUseId?: string;
  blockedPath?: string;
  /** What Claude Code proposes to remember (rules, directories, mode). Informational: agent-manager never echoes them back (an allow is once). */
  permissionSuggestions: unknown[];
  /** Epoch ms. */
  receivedAt: number;
}

/** How a message ended: `completed` (the turn that answered it finished) or `cancelled` (an interrupt or cancel dropped it). */
export type DeliveryOutcome = 'completed' | 'cancelled';

/** Returned by `send`: `uuid` is the client uuid of the message; the promises settle on `command_lifecycle` and reject when the process ends first. */
export interface SentMessage {
  uuid: string;
  /** Resolves when Claude Code started the message (`started`); rejects with a LaunchError if the process exited or the message was cancelled before. */
  started: Promise<void>;
  /** Resolves when the message ended (`completed` or `cancelled`); rejects with a LaunchError if the process exited first. */
  completed: Promise<DeliveryOutcome>;
}

/** The receipt of an interrupt (`{still_queued, cancelled?}`): the uuids of the messages that stay queued, and those dropped. */
export interface InterruptReceipt {
  stillQueued: string[];
  cancelled?: string[];
}

export type ExitCause =
  /** The process ended after `close()` (stdin closed). */
  | 'closed'
  /** The process was ended by `kill()` (or by `close()` that ran out of time). */
  | 'killed'
  /** The process ended by itself with exit code 0. */
  | 'exited'
  /** The process ended by itself with another exit code or a signal. */
  | 'crashed'
  /** The program could not be started. */
  | 'spawn-failed';

export interface ExitInfo {
  cause: ExitCause;
  code: number | null;
  signal: string | null;
  /** The last bytes of stderr (bounded, see `stderrTailBytes`). */
  stderrTail: string;
  /** Set for `crashed` and `spawn-failed`: what happened and what to do. */
  error?: Error;
}

export type SessionEvent =
  /** `system/init`: emitted per turn by Claude Code, not once. */
  | { kind: 'init'; sessionId: string; cwd?: string; model?: string; tools: string[]; raw: Record<string, unknown> }
  /** A piece of assistant text (needs --include-partial-messages, on by default). */
  | { kind: 'text_delta'; text: string; raw: Record<string, unknown> }
  /** A whole assistant message: its text and its tool calls. */
  | { kind: 'assistant'; text: string; toolUses: ToolUse[]; raw: Record<string, unknown> }
  /** The user message echoed back (--replay-user-messages); arrives with the first assistant line, not on receipt. */
  | { kind: 'user_replay'; uuid?: string; raw: Record<string, unknown> }
  /** The end of a turn. `isError` is true for error_during_execution (interrupt) and error results. */
  | { kind: 'result'; subtype: string; isError: boolean; stopReason?: string; text?: string; raw: Record<string, unknown> }
  | { kind: 'lifecycle'; uuid: string; state: LifecycleState; raw: Record<string, unknown> }
  | { kind: 'permission_request'; request: PendingPermission }
  | { kind: 'permission_resolved'; requestId: string; behavior: 'allow' | 'deny' | 'process-ended' }
  /** A control_response that matched no request of this session (e.g. the echo of a permission answer). */
  | { kind: 'control_response'; requestId?: string; raw: Record<string, unknown> }
  /** A control_request this host does not handle (anything but can_use_tool). NOT answered: report it. */
  | { kind: 'unsupported_control_request'; requestId?: string; subtype?: string; raw: Record<string, unknown> }
  /** Any other `system` line (thinking_tokens, status, permission_denied, ...): kept as is. */
  | { kind: 'system'; subtype: string; raw: Record<string, unknown> }
  /** A `stream_event` that is not a text delta. */
  | { kind: 'stream_event'; raw: Record<string, unknown> }
  /** A JSON line of a type this class does not know: forwarded, never dropped. */
  | { kind: 'unknown'; type?: string; raw: Record<string, unknown> }
  /** A line that is not a JSON object, a line above the size limit, or a listener that threw. */
  | { kind: 'protocol_error'; code: 'bad-json' | 'line-too-large' | 'listener-failed' | 'stdin-failed' | 'process-error'; detail: string }
  | { kind: 'state'; state: SessionState; previous: SessionState }
  | { kind: 'exit'; info: ExitInfo };
