/**
 * Normalised model of a Claude Code transcript (`~/.claude/projects/<slug>/<sessionId>.jsonl` and
 * `<sessionId>/subagents/agent-<id>.jsonl`). Shapes come from real transcripts (Claude Code 2.1.3xx), see
 * scripts/probe-real-transcripts.mjs; whatever is not observed is marked UNVERIFIED.
 *
 * Rules of the model:
 * - Every field that can hold user or model text is BOUNDED (see the LIMITS constant) and has a `*Truncated` flag next to it.
 * - Image blocks are recorded as {type, mediaType, bytes}, never the base64.
 * - Entries are plain JSON (they can be sent to a browser as is).
 * - `key` is unique per entry in one transcript. Tool calls are UPSERTED: several entries can carry the same `key` ("call:<tool_use id>"), the
 *   LAST one wins (the first has status 'running', a later one carries the result). Use mergeToolCallEntries() to fold a list.
 */

/** Hard bounds of the model. Exported so the UI can show "N more characters" without guessing. */
export const LIMITS = {
  /** Characters of the text of a prompt, an assistant text or a thinking block kept in an entry. */
  textChars: 20_000,
  /** Characters of the one-line summary of a tool call input. */
  inputSummaryChars: 200,
  /** Serialised size (characters) of the kept tool call input. */
  inputChars: 8192,
  /** Characters of the preview of a tool result. */
  resultPreviewChars: 500,
  /** Characters of the preview of a queue-operation content or a system notice text. */
  noticeChars: 500,
  /** Tool calls waiting for their result that a tailer state keeps. The oldest beyond it become status 'unknown'. */
  maxPendingCalls: 256,
  /** Assistant message ids remembered to count the usage of a message once (a message is written as one line per content block). */
  recentMessageIds: 64,
} as const;

export type EntryBase = {
  /** Unique within one transcript; "call:<id>" for tool calls (upserted), else "<offset>.<n>". */
  key: string;
  /** Byte offset of the line this entry comes from (start of the line). */
  offset: number;
  /** Epoch ms of the line `timestamp`, when present and parsable. */
  timestamp?: number;
  /** Set on lines of a sub-agent transcript: the agent that owns the transcript (the `agentId` field of the line, or the one given to the tailer). */
  ownerAgentId?: string;
};

/**
 * Who wrote a user line (observed):
 * - human: `origin.kind` human (or `turnOrigin` human), typed or queued by the person
 * - peer: a message from another session (`origin.kind` peer, `name`/`from` kept in `peer`)
 * - task-notification: a background task or sub-agent finished (`origin.kind` task-notification)
 * - injected: `isMeta` line with no origin (hook output, local command caveat, system reminder)
 * - other: nothing identifies it (older lines, or the first prompt line of a sub-agent)
 */
export type PromptSource = 'human' | 'peer' | 'task-notification' | 'injected' | 'other';

export type ImageRef = { type: 'image'; mediaType: string; bytes: number };

/** A user entry that is only text Claude Code injected itself (a slash command, its output, a caveat, a reminder): see classifyHarnessText(). */
export type HarnessInfo = {
  /** Short readable name: 'Command /compact', 'Command output', 'System reminder'. */
  label: string;
  /** One line of what it says. */
  summary: string;
  /** The inner text (the arguments of a command, the output), empty when there is none. */
  detail: string;
  /** The harness tags found, once each. */
  tags: string[];
  /** 'error' for an error stream (stderr). */
  level?: 'error';
};

/** A message the person sent from agent-manager, as it comes back in the transcript (a "peer" entry carrying our marker): see parseWebReply(). */
export type WebReplyInfo = {
  /** The id in the marker: the client message id of POST /reply, what the optimistic message is matched by. */
  messageId: string;
  /** What the person wrote: the text after the marker line, without the paragraph Claude Code adds. */
  text: string;
};

export type UserPromptEntry = EntryBase & {
  kind: 'user-prompt';
  source: PromptSource;
  /** `promptSource` was "queued": the person typed it while the session was busy. */
  queued: boolean;
  isMeta: boolean;
  /** Raw `origin.kind` / `promptSource`, kept for what the classification hides. */
  originKind?: string;
  /** `origin.msg_id`: the socket `msg_id` Claude Code kept (only when it is a UUID). Matches a reply to its line without reading the text. */
  originMsgId?: string;
  promptSource?: string;
  peer?: { name?: string; from?: string };
  /** Set when the whole text is made of harness tags (not a prompt the person wrote); the text is kept, ANSI escapes removed. */
  harness?: HarnessInfo;
  /** Set on a peer entry that carries the marker of a reply sent from agent-manager. The full text stays in `text`. */
  webReply?: WebReplyInfo;
  text: string;
  textTruncated: boolean;
  /** UTF-8 size of the full text. */
  textBytes: number;
  images: ImageRef[];
};

export type AssistantTextEntry = EntryBase & {
  kind: 'assistant-text';
  messageId?: string;
  model?: string;
  text: string;
  textTruncated: boolean;
  textBytes: number;
};

/** A thinking block. Always collapsible in the UI. The text is empty when the transcript only holds a signature (UNVERIFIED which versions). */
export type ThinkingEntry = EntryBase & {
  kind: 'thinking';
  collapsible: true;
  messageId?: string;
  text: string;
  textTruncated: boolean;
  textBytes: number;
  durationMs?: number;
};

export type ToolCallStatus = 'running' | 'ok' | 'error' | 'unknown';

export type ToolCallEntry = EntryBase & {
  kind: 'tool-call';
  /** The `tool_use` id (the key of the pairing). */
  id: string;
  name: string;
  /** One line (command, file_path, path, pattern, url, query, description, ...) of at most LIMITS.inputSummaryChars characters. */
  inputSummary: string;
  /** The input, every string cut so the serialisation stays within LIMITS.inputChars. */
  input: Record<string, unknown>;
  inputTruncated: boolean;
  /**
   * running: no result seen yet. ok / error: result seen (`is_error`). unknown: no result will be paired (evicted from the bounded pending list, or
   * a result with no call in the read window: then `orphan` is true).
   */
  status: ToolCallStatus;
  /** Epoch ms of the assistant line that holds the tool_use (absent on an orphan result). */
  startedAt?: number;
  /** Epoch ms of the line that holds the tool_result. */
  finishedAt?: number;
  durationMs?: number;
  /** ANSI stripped, at most LIMITS.resultPreviewChars characters. */
  resultPreview?: string;
  resultPreviewTruncated?: boolean;
  /** UTF-8 size of the full result text (images excluded). */
  resultBytes?: number;
  /** Byte offset of the line holding the result, to fetch it whole with readRange(). */
  resultOffset?: number;
  resultImages?: ImageRef[];
  /** `toolDenialKind` of the result line when present (observed: permission-rule, user-rejected). */
  denialKind?: string;
  /** `toolUseResult.agentId` of an Agent tool result (observed). */
  agentId?: string;
  /** Sub-agent matched through its meta `toolUseId` (see linkSubagents). */
  subagentId?: string;
  /** True when this entry was built from a result whose call was not seen. */
  orphan?: boolean;
};

export type NoticeKind = 'stop-hook' | 'turn-duration' | 'local-command' | 'compact-boundary' | 'away-summary' | 'other';

/** A `system` line. Observed subtypes: stop_hook_summary, turn_duration, local_command, away_summary. compact_boundary is expected, UNVERIFIED. */
export type SystemNoticeEntry = EntryBase & {
  kind: 'system-notice';
  noticeKind: NoticeKind;
  /** Raw `subtype`. */
  subtype: string;
  level?: string;
  isMeta: boolean;
  text?: string;
  textTruncated?: boolean;
  durationMs?: number;
  messageCount?: number;
  hookCount?: number;
  hookErrorCount?: number;
  preventedContinuation?: boolean;
  stopReason?: string;
  /** compact_boundary only (UNVERIFIED field names: compactMetadata.trigger / preTokens). */
  compactTrigger?: string;
  compactPreTokens?: number;
};

/** `queue-operation` lines: the delivery state signal of a message sent to a busy session (enqueue -> dequeue, or remove). */
export type QueueOperationEntry = EntryBase & {
  kind: 'queue-operation';
  /** Observed: enqueue, dequeue, remove. */
  operation: string;
  /** Observed on remove: absorbed_mid_turn. */
  reason?: string;
  deliveryId?: string;
  commandUuid?: string;
  /** What the enqueued text is (from its first characters): a <task-notification>, a <cross-session-message>, or plain text. */
  contentKind?: 'task-notification' | 'cross-session-message' | 'text';
  contentPreview?: string;
  contentTruncated?: boolean;
  /** Set by the module (not read from the transcript) on an enqueue that is a reply sent from agent-manager: the message id. Known by the exact text and the time, not by a marker. */
  webReplyId?: string;
};

/**
 * Tokens of one assistant message (counted once per `message.id`, although the message is written as one line per content block).
 * When later lines of the message carry larger counts, an entry with the SAME key and the field-wise maximum follows (upsert by key, like tool calls).
 */
export type UsageEntry = EntryBase & {
  kind: 'usage';
  messageId?: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheCreate: number;
  /**
   * Estimate of the context size after this message: inputTokens + cacheRead + cacheCreate (the prompt that was sent) + outputTokens. An estimate:
   * it ignores what the next request adds.
   */
  contextEstimate: number;
};

/**
 * A model as the UI shows it. `id` is the raw id when one is known (assistant `message.model`, attachment `modelId`); it is absent for a model known by its
 * name only (the stdout of `/model`). `known` is false when the name is not in the model table: `displayName` is then the raw id (never a guess).
 */
export type ModelRef = {
  id?: string;
  displayName: string;
  known: boolean;
};

/**
 * `attachment` lines of type `model` (observed: `{"attachment":{"type":"model","identity":{"modelId","marketingName","knowledgeCutoff"}}}`), written at the
 * start of a session and when the model changes. `modelId` is the exact id with the provider prefix and the `[1m]` tag (`us.anthropic.claude-opus-5-5[1m]`),
 * `displayName` the `marketingName` ("Opus 5.5 (1M context)"). The log route does not send these entries (like `usage`).
 */
export type ModelInfoEntry = EntryBase & {
  kind: 'model-info';
  modelId: string;
  displayName: string;
  knowledgeCutoff?: string;
};

/**
 * Derived, never read from a line: inserted into an entry list by insertModelChanges() where the model of the session changes. Two signals, one notice:
 * the stdout of `/model` ("Set model to `X` ...", placed at the command) and the first assistant entry whose model differs (placed before that message);
 * when both exist only the command one is kept.
 */
export type ModelChangeEntry = EntryBase & {
  kind: 'model-change';
  /** The model before; absent when it is not known (the first model seen, or the window starts after it). */
  from?: ModelRef;
  to: ModelRef;
  /** command: the stdout of `/model`. assistant: the model of the assistant messages changed with no command seen (fallback, plan mode, a command outside the window). */
  source: 'command' | 'assistant';
  /** command only, from the stdout: 'session' = "for this session only", 'default' = "saved as your default for new sessions". Absent when the text says neither. */
  scope?: 'session' | 'default';
  /** Ready to show: "Model changed: Sonnet 4.6 -> Haiku 5.5" ("Model changed to ..." when `from` is unknown). */
  text: string;
};

/** The first line of a fork sub-agent transcript (observed type fork-context-ref). */
export type ForkRefEntry = EntryBase & {
  kind: 'fork-ref';
  parentSessionId?: string;
  parentLastUuid?: string;
  contextLength?: number;
};

/** A line type the model does not know (kept visible, never dropped silently): the key names only. */
export type UnknownEntry = EntryBase & {
  kind: 'unknown';
  lineType: string;
  keys: string[];
  bytes: number;
};

/** A line that is not JSON. */
export type UnparsableEntry = EntryBase & { kind: 'unparsable'; bytes: number; reason: string };

/** A line longer than the limit: skipped without being parsed. */
export type OversizeEntry = EntryBase & { kind: 'oversize'; bytes: number; limit: number; lineType?: string };

export type Entry =
  | UserPromptEntry
  | AssistantTextEntry
  | ThinkingEntry
  | ToolCallEntry
  | SystemNoticeEntry
  | QueueOperationEntry
  | UsageEntry
  | ModelInfoEntry
  | ModelChangeEntry
  | ForkRefEntry
  | UnknownEntry
  | UnparsableEntry
  | OversizeEntry;

export type EntryKind = Entry['kind'];

/** Counters kept in a tailer state, cumulative since the state was created (or restarted after a truncation). */
export type TailerCounts = {
  /** Lines seen (parsed, skipped, oversize), blank lines excluded. */
  lines: number;
  /** Lines skipped WITHOUT JSON.parse, per line type (prefix check; or after the parse for a type the prefix check missed). */
  skipped: Record<string, number>;
  oversize: number;
  parseErrors: number;
  /** Lines of a type the model does not know. */
  unknown: number;
};

/** What a tailer needs to continue where it stopped. Plain JSON: persist it as is. */
export type TailerState = {
  /** Byte offset of the first byte not consumed yet: the start of the partial last line when there is one (it is read again next time). */
  offset: number;
  /** File size at the last read. */
  size: number;
  /** Identity of the file at the last read (inode), to notice a replaced file; undefined when the platform gives none. */
  fileId?: string;
  /** Set while inside a line that is being discarded (oversize), across reads. */
  discarding?: { startOffset: number; bytes: number; lineType?: string };
  /** Tool calls without result yet, by tool_use id (bounded by LIMITS.maxPendingCalls). */
  pending: Record<string, ToolCallEntry>;
  /** Last assistant message ids already counted for usage. */
  recentMessageIds: string[];
  /**
   * The usage entry emitted for each id of recentMessageIds (absent in states saved by an older version). A later line of the same message with a
   * larger count (output_tokens grows while the message streams) emits an update entry with the same key and the field-wise maximum.
   */
  usageById?: Record<string, UsageEntry>;
  counts: TailerCounts;
};

export type ReadErrorCode = 'missing' | 'busy' | 'io' | 'misaligned' | 'invalid-range';

/** A read that did not happen: explicit, never an empty success. */
export type ReadError = {
  code: ReadErrorCode;
  path: string;
  /** What happened. */
  message: string;
  /** What to do about it. */
  hint: string;
  /** True when trying again later can succeed (busy, or a transcript not written yet). */
  retry: boolean;
};

export type ReadNewResult = {
  /** Entries since the previous state, in file order. Tool calls may be updates of earlier entries (same key). */
  entries: Entry[];
  /** The state to pass to the next call. On an error it is the state that was passed in. */
  state: TailerState;
  /** True when the file was truncated or replaced since the previous state: the state restarted at 0 and the caller must drop what it kept. */
  truncated?: boolean;
  /** True when data remains after this window (call again, no need to wait). */
  more: boolean;
  bytesRead: number;
  error?: ReadError;
};

export type ReadOptions = {
  /** Window of one read, default 1 MiB. */
  maxBytes?: number;
};

/** The sub-agent description from `<sessionId>/subagents/agent-<id>.meta.json` and the first line of its transcript. */
export type SubagentInfo = {
  agentId: string;
  /** `agentType` of the meta (observed: general-purpose, Explore, fork). */
  agentType?: string;
  description?: string;
  /** The tool_use id of the parent Agent call. Absent for named agents (observed: meta has `name` instead). */
  toolUseId?: string;
  name?: string;
  /** The meta says `finished: true`. An absent field is read as false (probably running or never marked). */
  finished: boolean;
  spawnDepth?: number;
  isFork: boolean;
  model?: string;
  requestShape?: string;
  transcriptPath: string;
  metaPath: string;
  /** The meta says `stoppedByUser: true` (observed on real data: the user interrupted it). Absent field: false. */
  stoppedByUser: boolean;
  /** Epoch ms of the first timestamped line of its transcript (else the creation time of the file). Absent when the transcript does not exist yet. */
  startedAt?: number;
  /** Epoch ms of the last write to its transcript (file modification time). Absent when the transcript does not exist yet. */
  lastWriteAt?: number;
  /** The transcript exists but could not be opened or read (permissions, I/O): what happened, in words. Its status is then unknown, never "just started". */
  readError?: string;
  /** From the first transcript line of a fork (type fork-context-ref). */
  parentSessionId?: string;
  parentLastUuid?: string;
  contextLength?: number;
};

export type SubagentNode = {
  info: SubagentInfo;
  /** The agent that holds the Agent tool call, undefined for the main session. */
  parentAgentId?: string;
  children: SubagentNode[];
};

export type ActivitySummary = {
  /** Epoch ms of the last prompt written by a person (source human). */
  lastPromptAt?: number;
  /** Epoch ms of the last assistant line (text, thinking, tool call). */
  lastAssistantAt?: number;
  runningToolCalls: ToolCallEntry[];
  /** "Bash: npm test" of the most recent tool call, running or not. */
  lastToolSummary?: string;
  /** Sum of input + output + cache creation tokens of every assistant message (cache reads excluded, see cacheReadTotal). */
  tokensTotal: number;
  cacheReadTotal: number;
  /** contextEstimate of the last usage entry. */
  contextEstimate: number;
  /** Prompts that started a turn: human, peer and task-notification sources. */
  turnsCount: number;
  /** Tool calls with status error plus notices of level error. */
  errorsCount: number;
};

/** Result of readTail / pageBackwards / readRange: a window of whole lines. */
export type WindowResult = {
  /** Entries of the window, in file order. A tool call whose other half is outside the window is partial (see ToolCallEntry.orphan, mergeToolCallEntries). */
  entries: Entry[];
  /** Byte offset of the first line of the window: pass it as `beforeOffset` of pageBackwards() to get the previous page. */
  startOffset: number;
  /** Byte offset just after the last whole line of the window. */
  endOffset: number;
  /** True when the file holds lines before startOffset. */
  hasMoreBefore: boolean;
  /**
   * For readTail: a state positioned at endOffset (continue with TranscriptTailer.readNew; its pending calls are those of the window).
   * For the other two it only serves pairing inside the window.
   */
  state: TailerState;
  bytesRead: number;
  error?: ReadError;
};
