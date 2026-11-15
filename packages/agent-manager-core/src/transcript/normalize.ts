import {
  LIMITS,
  type Entry,
  type EntryBase,
  type ImageRef,
  type NoticeKind,
  type PromptSource,
  type TailerState,
  type ToolCallEntry,
  type UsageEntry,
  type UserPromptEntry,
} from './types.js';
import { classifyHarnessText } from './harness.js';
import { parseWebReply } from './webReply.js';
import { asNumber, asString, base64Bytes, boundValue, isRecord, oneLine, parseTimestamp, stripAnsi, truncateText } from './text.js';

/** Line types skipped by prefix, WITHOUT JSON.parse, and counted per type (decision 29 / R-08 plus the types observed on real transcripts). */
export const SKIPPED_LINE_TYPES: ReadonlySet<string> = new Set([
  'attachment',
  'api-request',
  'api-request-blob',
  'api-request-shape',
  'file-history-snapshot',
  'file-history-delta',
  'last-prompt',
  'atis-latch',
  'permission-mode',
  'mode',
  'custom-title',
  'agent-name',
  'ai-title',
  'tools-used',
]);

/** Where a normalised line goes, and what it needs from the tailer. */
export type Sink = {
  state: TailerState;
  /** Stamped on every entry that has no `agentId` of its own (sub-agent tailers). */
  agentId?: string;
  entries: Entry[];
  /** Tool calls created in this batch: a result arriving in the same batch completes them in place instead of emitting an update. */
  batchCalls: Map<string, ToolCallEntry>;
  /** Usage entries created in this batch, by message id: a later line of the same message raises them in place. */
  batchUsage: Map<string, UsageEntry>;
};

export function createSink(state: TailerState, agentId?: string): Sink {
  return { state, agentId, entries: [], batchCalls: new Map(), batchUsage: new Map() };
}

/** Counts a line skipped without parsing. */
export function countSkipped(state: TailerState, lineType: string): void {
  state.counts.lines += 1;
  state.counts.skipped[lineType] = (state.counts.skipped[lineType] ?? 0) + 1;
}

/** Fields of the summary of a tool input, in order of preference (the first seven are the agent-fleet ToolCallTracker list). */
const SUMMARY_KEYS = ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'skill', 'subagent_type', 'to', 'prompt', 'message'] as const;

/** One line describing what a tool call does; empty when the input has none of the usual fields. */
export function summarizeToolInput(input: unknown): string {
  if (!isRecord(input)) {
    return '';
  }
  for (const key of SUMMARY_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return oneLine(value, LIMITS.inputSummaryChars);
    }
  }
  return '';
}

/** Processes one parsed line (already known not to be skipped by prefix). `bytes` is the size of the line in the file. */
export function handleLine(sink: Sink, line: Record<string, unknown>, offset: number, bytes: number): void {
  const { state } = sink;
  state.counts.lines += 1;
  const type = asString(line.type);
  const ctx = lineContext(sink, line, offset);
  if (type === 'assistant') {
    handleAssistant(sink, ctx, line);
    return;
  }
  if (type === 'user') {
    handleUser(sink, ctx, line);
    return;
  }
  if (type === 'system') {
    handleSystem(sink, ctx, line);
    return;
  }
  if (type === 'queue-operation') {
    handleQueue(sink, ctx, line);
    return;
  }
  if (type === 'fork-context-ref') {
    push(sink, ctx, {
      kind: 'fork-ref',
      parentSessionId: asString(line.parentSessionId),
      parentLastUuid: asString(line.parentLastUuid),
      contextLength: asNumber(line.contextLength),
    });
    return;
  }
  if (type === 'attachment' && handleModelAttachment(sink, ctx, line)) {
    return;
  }
  if (type !== undefined && SKIPPED_LINE_TYPES.has(type)) {
    // The prefix check missed it (key order changed): the line was parsed, but it is still counted as skipped and produces no entry.
    state.counts.lines -= 1;
    countSkipped(state, type);
    return;
  }
  state.counts.unknown += 1;
  push(sink, ctx, { kind: 'unknown', lineType: type ?? '(no type)', keys: Object.keys(line).slice(0, 24), bytes });
}

/** `attachment` of type `model` with an identity: a model-info entry. Any other attachment is not handled (it stays a skipped line). */
function handleModelAttachment(sink: Sink, ctx: LineContext, line: Record<string, unknown>): boolean {
  const attachment = isRecord(line.attachment) ? line.attachment : undefined;
  const identity = isRecord(attachment?.identity) ? attachment.identity : undefined;
  const modelId = asString(identity?.modelId);
  if (attachment?.type !== 'model' || identity === undefined || modelId === undefined || modelId === '') {
    return false;
  }
  const marketingName = asString(identity.marketingName);
  const cutoff = asString(identity.knowledgeCutoff);
  push(sink, ctx, { kind: 'model-info', modelId, displayName: marketingName !== undefined && marketingName !== '' ? marketingName : modelId, ...(cutoff !== undefined ? { knowledgeCutoff: cutoff } : {}) });
  return true;
}

type LineContext = { offset: number; timestamp?: number; ownerAgentId?: string; n: number };

function lineContext(sink: Sink, line: Record<string, unknown>, offset: number): LineContext {
  return { offset, timestamp: parseTimestamp(line.timestamp), ownerAgentId: asString(line.agentId) ?? sink.agentId, n: 0 };
}

type DOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Adds an entry with the common fields. Returns it. */
function push(sink: Sink, ctx: LineContext, payload: DOmit<Entry, keyof EntryBase>, key?: string): Entry {
  const entry = { key: key ?? `${ctx.offset}.${ctx.n}`, offset: ctx.offset, ...payload } as Entry;
  if (ctx.timestamp !== undefined) {
    entry.timestamp = ctx.timestamp;
  }
  if (ctx.ownerAgentId !== undefined) {
    entry.ownerAgentId = ctx.ownerAgentId;
  }
  ctx.n += 1;
  sink.entries.push(entry);
  return entry;
}

function boundedText(text: string): { text: string; textTruncated: boolean; textBytes: number } {
  const cut = truncateText(text, LIMITS.textChars);
  return { text: cut.text, textTruncated: cut.truncated, textBytes: Buffer.byteLength(text, 'utf8') };
}

function imageRef(block: Record<string, unknown>): ImageRef {
  const source = isRecord(block.source) ? block.source : {};
  const data = asString(source.data);
  // A url source has no data: the size is unknown, recorded as 0.
  return { type: 'image', mediaType: asString(source.media_type) ?? 'unknown', bytes: data === undefined ? 0 : base64Bytes(data) };
}

// ---------------------------------------------------------------- assistant

function handleAssistant(sink: Sink, ctx: LineContext, line: Record<string, unknown>): void {
  const message = isRecord(line.message) ? line.message : {};
  const messageId = asString(message.id);
  const model = asString(message.model);
  const content = message.content;
  if (typeof content === 'string') {
    push(sink, ctx, { kind: 'assistant-text', messageId, model, ...boundedText(content) });
  } else if (Array.isArray(content)) {
    // Every block of the line, not only the first: older writers put several blocks (and parallel tool calls) in one line.
    for (const block of content) {
      if (isRecord(block)) {
        handleAssistantBlock(sink, ctx, line, block, messageId, model);
      }
    }
  }
  recordUsage(sink, ctx, message, messageId, model);
}

function handleAssistantBlock(
  sink: Sink,
  ctx: LineContext,
  line: Record<string, unknown>,
  block: Record<string, unknown>,
  messageId: string | undefined,
  model: string | undefined,
): void {
  const type = asString(block.type);
  if (type === 'text') {
    push(sink, ctx, { kind: 'assistant-text', messageId, model, ...boundedText(asString(block.text) ?? '') });
  } else if (type === 'thinking' || type === 'redacted_thinking') {
    push(sink, ctx, {
      kind: 'thinking',
      collapsible: true,
      messageId,
      ...boundedText(asString(block.thinking) ?? ''),
      durationMs: asNumber(line.thinkingDurationMs),
    });
  } else if (type === 'tool_use') {
    startToolCall(sink, ctx, block);
  } else {
    const bytes = JSON.stringify(block).length;
    sink.state.counts.unknown += 1;
    push(sink, ctx, { kind: 'unknown', lineType: `assistant.block:${type ?? '(no type)'}`, keys: Object.keys(block).slice(0, 24), bytes });
  }
}

function startToolCall(sink: Sink, ctx: LineContext, block: Record<string, unknown>): void {
  const id = asString(block.id);
  if (id === undefined) {
    // Without an id the result can never be paired: shown as a call that is not running and not finished.
    const bytes = JSON.stringify(block).length;
    sink.state.counts.unknown += 1;
    push(sink, ctx, { kind: 'unknown', lineType: 'assistant.block:tool_use(no id)', keys: Object.keys(block).slice(0, 24), bytes });
    return;
  }
  const bounded = boundValue(block.input, LIMITS.inputChars);
  const call = push(
    sink,
    ctx,
    {
      kind: 'tool-call',
      id,
      name: asString(block.name) ?? 'unknown',
      inputSummary: summarizeToolInput(block.input),
      input: bounded.value,
      inputTruncated: bounded.truncated,
      status: 'running',
      ...(ctx.timestamp !== undefined ? { startedAt: ctx.timestamp } : {}),
    },
    `call:${id}`,
  ) as ToolCallEntry;
  sink.batchCalls.set(id, call);
  sink.state.pending[id] = call;
  evictOldest(sink);
}

/** Keeps the pending list within LIMITS.maxPendingCalls: the oldest calls get status 'unknown' (an update entry is emitted for each). */
function evictOldest(sink: Sink): void {
  const ids = Object.keys(sink.state.pending);
  for (let i = 0; i < ids.length - LIMITS.maxPendingCalls; i++) {
    const id = ids[i]!;
    const call = sink.state.pending[id]!;
    delete sink.state.pending[id];
    if (sink.batchCalls.get(id) === call) {
      call.status = 'unknown';
      sink.batchCalls.delete(id);
    } else {
      sink.entries.push({ ...call, status: 'unknown' });
    }
  }
}

function recordUsage(sink: Sink, ctx: LineContext, message: Record<string, unknown>, messageId: string | undefined, model: string | undefined): void {
  const usage = message.usage;
  if (!isRecord(usage)) {
    return;
  }
  const { state } = sink;
  const seen = state.recentMessageIds;
  const inputTokens = asNumber(usage.input_tokens) ?? 0;
  const outputTokens = asNumber(usage.output_tokens) ?? 0;
  const cacheRead = asNumber(usage.cache_read_input_tokens) ?? 0;
  const cacheCreate = asNumber(usage.cache_creation_input_tokens) ?? 0;
  if (messageId === undefined) {
    push(sink, ctx, { kind: 'usage', messageId, model, inputTokens, outputTokens, cacheRead, cacheCreate, contextEstimate: inputTokens + cacheRead + cacheCreate + outputTokens });
    return;
  }
  if (seen.includes(messageId)) {
    // Another line of a message already counted: keep the field-wise maximum (output_tokens grows while the message streams; measured on real transcripts).
    const previous = state.usageById?.[messageId];
    if (previous === undefined) {
      return;
    }
    const max = {
      inputTokens: Math.max(previous.inputTokens, inputTokens),
      outputTokens: Math.max(previous.outputTokens, outputTokens),
      cacheRead: Math.max(previous.cacheRead, cacheRead),
      cacheCreate: Math.max(previous.cacheCreate, cacheCreate),
    };
    if (max.inputTokens === previous.inputTokens && max.outputTokens === previous.outputTokens && max.cacheRead === previous.cacheRead && max.cacheCreate === previous.cacheCreate) {
      return;
    }
    const contextEstimate = max.inputTokens + max.cacheRead + max.cacheCreate + max.outputTokens;
    if (sink.batchUsage.get(messageId) === previous) {
      // The first line is in this batch too: complete it in place instead of emitting an update.
      Object.assign(previous, max, { contextEstimate });
    } else {
      const updated = push(sink, ctx, { kind: 'usage', messageId, model: previous.model ?? model, ...max, contextEstimate }, previous.key) as UsageEntry;
      state.usageById = { ...state.usageById, [messageId]: updated };
      sink.batchUsage.set(messageId, updated);
    }
    return;
  }
  seen.push(messageId);
  const entry = push(sink, ctx, { kind: 'usage', messageId, model, inputTokens, outputTokens, cacheRead, cacheCreate, contextEstimate: inputTokens + cacheRead + cacheCreate + outputTokens }) as UsageEntry;
  state.usageById = { ...state.usageById, [messageId]: entry };
  sink.batchUsage.set(messageId, entry);
  if (seen.length > LIMITS.recentMessageIds) {
    for (const dropped of seen.splice(0, seen.length - LIMITS.recentMessageIds)) {
      delete state.usageById[dropped];
      sink.batchUsage.delete(dropped);
    }
  }
}

// ---------------------------------------------------------------------- user

function handleUser(sink: Sink, ctx: LineContext, line: Record<string, unknown>): void {
  const message = isRecord(line.message) ? line.message : {};
  const content = message.content;
  const texts: string[] = [];
  const images: ImageRef[] = [];
  let sawPromptContent = false;
  if (typeof content === 'string') {
    texts.push(content);
    sawPromptContent = true;
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (!isRecord(block)) {
        continue;
      }
      const type = asString(block.type);
      if (type === 'tool_result') {
        finishToolCall(sink, ctx, line, block);
      } else if (type === 'text') {
        texts.push(asString(block.text) ?? '');
        sawPromptContent = true;
      } else if (type === 'image') {
        images.push(imageRef(block));
        sawPromptContent = true;
      }
    }
  }
  if (!sawPromptContent) {
    return;
  }
  const origin = isRecord(line.origin) ? line.origin : undefined;
  const originKind = asString(origin?.kind);
  const promptSource = asString(line.promptSource);
  const isMeta = line.isMeta === true;
  // ANSI escapes are removed here, once, so no client ever sees a raw ESC byte (a terminal colour in a command output shows as '[2m' in a browser).
  const promptText = stripAnsi(texts.join('\n'));
  const harness = classifyHarnessText(promptText);
  const promptKind = classifyPrompt(originKind, asString(line.turnOrigin), isMeta);
  // Only a message delivered as a peer message can be one of our replies: a typed prompt that merely contains the marker is not.
  const webReply = promptKind === 'peer' ? parseWebReply(promptText) : undefined;
  const entry = push(sink, ctx, {
    kind: 'user-prompt',
    source: promptKind,
    queued: promptSource === 'queued',
    isMeta,
    ...(originKind !== undefined ? { originKind } : {}),
    ...(asString(origin?.msg_id) !== undefined ? { originMsgId: asString(origin?.msg_id) } : {}),
    ...(promptSource !== undefined ? { promptSource } : {}),
    ...boundedText(promptText),
    ...(harness === undefined ? {} : { harness }),
    ...(webReply === undefined ? {} : { webReply }),
    images,
  }) as UserPromptEntry;
  if (origin !== undefined && entry.source === 'peer') {
    entry.peer = { name: asString(origin.name), from: asString(origin.from) };
  }
}

function classifyPrompt(originKind: string | undefined, turnOrigin: string | undefined, isMeta: boolean): PromptSource {
  const tag = originKind ?? turnOrigin;
  if (tag === 'human') {
    return 'human';
  }
  if (tag === 'peer') {
    return 'peer';
  }
  if (tag === 'task-notification' || tag === 'task_notification') {
    return 'task-notification';
  }
  return isMeta ? 'injected' : 'other';
}

function finishToolCall(sink: Sink, ctx: LineContext, line: Record<string, unknown>, block: Record<string, unknown>): void {
  const id = asString(block.tool_use_id);
  if (id === undefined) {
    return;
  }
  let call = sink.state.pending[id];
  let emit = false;
  if (call === undefined) {
    // The call is not known: the read window starts after it, or it was evicted. Shown as an orphan so the result is not lost.
    call = {
      key: `call:${id}`,
      offset: ctx.offset,
      kind: 'tool-call',
      id,
      name: '(unknown)',
      inputSummary: '',
      input: {},
      inputTruncated: false,
      status: 'unknown',
      orphan: true,
      ...(ctx.timestamp !== undefined ? { timestamp: ctx.timestamp } : {}),
      ...(ctx.ownerAgentId !== undefined ? { ownerAgentId: ctx.ownerAgentId } : {}),
    };
    emit = true;
  } else if (sink.batchCalls.get(id) === call) {
    sink.batchCalls.delete(id);
  } else {
    // The call was emitted by an earlier read: the consumer may hold that object, so the completed call is a new entry (an update).
    call = { ...call };
    emit = true;
  }
  delete sink.state.pending[id];
  applyResult(call, ctx, line, block);
  if (emit) {
    sink.entries.push(call);
  }
}

function applyResult(call: ToolCallEntry, ctx: LineContext, line: Record<string, unknown>, block: Record<string, unknown>): void {
  call.status = block.is_error === true ? 'error' : 'ok';
  const { text, images } = resultParts(block.content);
  const cut = truncateText(stripAnsi(text.length > 4 * LIMITS.resultPreviewChars ? text.slice(0, 4 * LIMITS.resultPreviewChars) : text), LIMITS.resultPreviewChars);
  call.resultPreview = cut.text;
  call.resultPreviewTruncated = cut.truncated || text.length > 4 * LIMITS.resultPreviewChars;
  call.resultBytes = Buffer.byteLength(text, 'utf8');
  call.resultOffset = ctx.offset;
  if (images.length > 0) {
    call.resultImages = images;
  }
  if (ctx.timestamp !== undefined) {
    call.finishedAt = ctx.timestamp;
    if (call.startedAt !== undefined) {
      call.durationMs = Math.max(0, ctx.timestamp - call.startedAt);
    }
  }
  const denial = asString(line.toolDenialKind);
  if (denial !== undefined) {
    call.denialKind = denial;
  }
  const toolUseResult = line.toolUseResult;
  const agentId = isRecord(toolUseResult) ? asString(toolUseResult.agentId) : undefined;
  if (agentId !== undefined) {
    call.agentId = agentId;
  }
}

function resultParts(content: unknown): { text: string; images: ImageRef[] } {
  if (typeof content === 'string') {
    return { text: content, images: [] };
  }
  const texts: string[] = [];
  const images: ImageRef[] = [];
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!isRecord(block)) {
        continue;
      }
      if (block.type === 'text' && typeof block.text === 'string') {
        texts.push(block.text);
      } else if (block.type === 'image') {
        images.push(imageRef(block));
      }
    }
  }
  return { text: texts.join('\n'), images };
}

// -------------------------------------------------------------------- system

const NOTICE_KINDS: ReadonlyMap<string, NoticeKind> = new Map<string, NoticeKind>([
  ['stop_hook_summary', 'stop-hook'],
  ['turn_duration', 'turn-duration'],
  ['local_command', 'local-command'],
  ['compact_boundary', 'compact-boundary'],
  ['away_summary', 'away-summary'],
]);

/** The notice kind of a subtype; a subtype not listed is 'other' (its raw name stays in `subtype`). */
function noticeKindOf(subtype: string): NoticeKind {
  return NOTICE_KINDS.get(subtype) ?? 'other';
}

function handleSystem(sink: Sink, ctx: LineContext, line: Record<string, unknown>): void {
  const subtype = asString(line.subtype) ?? '(no subtype)';
  const text = asString(line.content);
  const cut = text === undefined ? undefined : truncateText(text, LIMITS.noticeChars);
  const compact = isRecord(line.compactMetadata) ? line.compactMetadata : undefined;
  push(sink, ctx, {
    kind: 'system-notice',
    noticeKind: noticeKindOf(subtype),
    subtype,
    ...(asString(line.level) !== undefined ? { level: asString(line.level) } : {}),
    isMeta: line.isMeta === true,
    ...(cut !== undefined ? { text: cut.text, textTruncated: cut.truncated } : {}),
    ...(asNumber(line.durationMs) !== undefined ? { durationMs: asNumber(line.durationMs) } : {}),
    ...(asNumber(line.messageCount) !== undefined ? { messageCount: asNumber(line.messageCount) } : {}),
    ...(asNumber(line.hookCount) !== undefined ? { hookCount: asNumber(line.hookCount) } : {}),
    ...(Array.isArray(line.hookErrors) ? { hookErrorCount: line.hookErrors.length } : {}),
    ...(typeof line.preventedContinuation === 'boolean' ? { preventedContinuation: line.preventedContinuation } : {}),
    ...(asString(line.stopReason) !== undefined && asString(line.stopReason) !== '' ? { stopReason: asString(line.stopReason) } : {}),
    ...(asString(compact?.trigger) !== undefined ? { compactTrigger: asString(compact?.trigger) } : {}),
    ...(asNumber(compact?.preTokens) !== undefined ? { compactPreTokens: asNumber(compact?.preTokens) } : {}),
  });
}

// --------------------------------------------------------------------- queue

function handleQueue(sink: Sink, ctx: LineContext, line: Record<string, unknown>): void {
  const content = asString(line.content);
  let contentKind: 'task-notification' | 'cross-session-message' | 'text' | undefined;
  if (content !== undefined) {
    contentKind = content.startsWith('<task-notification') ? 'task-notification' : content.startsWith('<cross-session-message') ? 'cross-session-message' : 'text';
  }
  const preview = content === undefined ? undefined : truncateText(oneLine(content, LIMITS.noticeChars + 1), LIMITS.noticeChars);
  push(sink, ctx, {
    kind: 'queue-operation',
    operation: asString(line.operation) ?? '(no operation)',
    ...(asString(line.reason) !== undefined ? { reason: asString(line.reason) } : {}),
    ...(asString(line.deliveryId) !== undefined ? { deliveryId: asString(line.deliveryId) } : {}),
    ...(asString(line.commandUuid) !== undefined ? { commandUuid: asString(line.commandUuid) } : {}),
    ...(contentKind !== undefined ? { contentKind } : {}),
    ...(preview !== undefined ? { contentPreview: preview.text, contentTruncated: preview.truncated || (content?.length ?? 0) > LIMITS.noticeChars } : {}),
  });
}

/** Adds the entries a tailer must emit for a line that is not JSON or is too long. */
export function pushMarker(sink: Sink, entry: Entry): void {
  sink.entries.push(entry);
}

