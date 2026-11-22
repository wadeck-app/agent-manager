// violations-suppress: ts/no-barrel-index public API of the transcript reader: the lead wires it into the package exports (src/index.ts)
// Public API of the transcript reader of @wadeck-app/agent-manager-core.
export { PROJECTS_DIR_ENV, projectSlug, resolveProjectsDir, transcriptPath } from './transcriptPath.js';
export type { TranscriptPathError, TranscriptPathResult } from './transcriptPath.js';
export { TranscriptTailer } from './tailer.js';
export type { TailerOptions } from './tailer.js';
export { MAX_RANGE_BYTES, pageBackwards, readRange, readTail } from './windows.js';
export type { WindowOptions } from './windows.js';
export { createTailerState, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINE_BYTES } from './lines.js';
export { mergeToolCallEntries } from './merge.js';
export { SKIPPED_LINE_TYPES, summarizeToolInput } from './normalize.js';
export { agentCallOwners, buildAgentTree, linkSubagents, listSubagents, SubagentTailer } from './subagents.js';
export type { ListSubagentsResult, SubagentFileProblem } from './subagents.js';
export { ActivityAccumulator, summarizeActivity, toolSummary } from './activity.js';
export { scanInFlight } from './inFlight.js';
export type { InFlightFacts, OpenCall, ScanWindow } from './inFlight.js';
export { classifyReadiness, isSubagentRunning, RUNNING_FRESH_MS, SETTLE_MS } from './readiness.js';
export type { AdoptReadiness, ReadinessInput, ReadinessState, SubagentActivity } from './readiness.js';
export { IN_FLIGHT_MAX_BYTES, IN_FLIGHT_WINDOW_BYTES, readInFlight, readSubagentActivity } from './readInFlight.js';
export type { InFlightRead, ReadInFlightOptions, SubagentActivityRead } from './readInFlight.js';
export { stripAnsi } from './text.js';
export { classifyHarnessText } from './harness.js';
export { parseWebReply, stripPeerWrapper } from './webReply.js';
export { LIMITS } from './types.js';
export { AUTO_COMPACT_BUFFER, compactAtOf, contextWindowOf, describeModel, describeModelName, MODEL_TABLE, parseModelId, sameModel } from './models.js';
export type { ContextWindow, ModelRow, ParsedModelId, WindowSource } from './models.js';
export { createModelTrackerState, insertModelChanges } from './modelChanges.js';
export type { ModelTrackerState } from './modelChanges.js';
export { MAX_PREVIOUS_MODELS, ModelUsageAccumulator, rollupModelUsage } from './modelUsage.js';
export type { LastUsage, ModelUsageRollup } from './modelUsage.js';
export type {
  ActivitySummary,
  AssistantTextEntry,
  Entry,
  EntryBase,
  EntryKind,
  ForkRefEntry,
  HarnessInfo,
  HookEntry,
  HookOutcome,
  ToolMeta,
  WebReplyInfo,
  ImageRef,
  ModelChangeEntry,
  ModelInfoEntry,
  ModelRef,
  NoticeKind,
  OversizeEntry,
  PromptSource,
  QueueOperationEntry,
  ReadError,
  ReadErrorCode,
  ReadNewResult,
  ReadOptions,
  SubagentInfo,
  SubagentNode,
  SystemNoticeEntry,
  TailerCounts,
  TailerState,
  ThinkingEntry,
  ToolCallEntry,
  ToolCallStatus,
  UnknownEntry,
  UnparsableEntry,
  UsageEntry,
  UserPromptEntry,
  WindowResult,
} from './types.js';
