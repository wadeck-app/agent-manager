// violations-suppress: ts/no-barrel-index public API of the launch side; subpath export ./launch of the package
export { LaunchError } from './errors.js';
export { DEFAULT_MAX_LINE_CHARS, NdjsonFramer } from './ndjsonFramer.js';
export type { Frame } from './ndjsonFramer.js';
export { buildStreamJsonArgs } from './streamJsonArgs.js';
export type { StreamJsonArgsOptions } from './streamJsonArgs.js';
export { DEFAULT_CLAUDE_COMMAND, DEFAULT_CLOSE_TIMEOUT_MS, DEFAULT_CONTROL_TIMEOUT_MS, DEFAULT_STDERR_TAIL_CHARS, StreamJsonSession } from './StreamJsonSession.js';
export type { StreamJsonSessionOptions } from './StreamJsonSession.js';
export { DEFAULT_POLL_INTERVAL_MS, DEFAULT_REGISTRY_TIMEOUT_MS, DEFAULT_RUN_TIMEOUT_MS, HcLauncher, buildRunArgs } from './HcLauncher.js';
export type { HcLaunchRequest, HcLaunchResult, HcLauncherOptions } from './HcLauncher.js';
export type {
  DeliveryOutcome,
  ExitCause,
  ExitInfo,
  ImageInput,
  InterruptReceipt,
  LifecycleState,
  PendingPermission,
  SentMessage,
  SessionEvent,
  SessionState,
  ToolUse,
} from './types.js';
export { DEFAULT_VERSION_TIMEOUT_MS, readClaudeVersion } from './host/claudeVersion.js';
export type { ClaudeVersionOptions } from './host/claudeVersion.js';
export { DEFAULT_EVENT_CAPACITY, EventLog } from './host/EventLog.js';
export type { ReplayResult } from './host/EventLog.js';
export { appendHostAudit, hostAuditFile } from './host/hostAudit.js';
export type { HostAuditAction, HostAuditRecord } from './host/hostAudit.js';
export { describeLeftover, findLeftovers } from './host/leftovers.js';
export type { Leftover } from './host/leftovers.js';
export { DEFAULT_MAX_LIVE_SESSIONS, DEFAULT_MAX_RECORDS, SessionHost } from './host/SessionHost.js';
export type { HcLauncherLike, HostStatus, InitResult, SessionHostOptions, ShutdownResult } from './host/SessionHost.js';
export { STATE_FILE_NAME, STATE_FILE_VERSION, ownedStatePath, readOwnedState, writeOwnedState } from './host/stateFile.js';
export { HOST_KINDS, MAX_MESSAGES_PER_SESSION, MAX_RESULT_TEXT_CHARS, MAX_STDERR_TAIL_CHARS } from './host/types.js';
export type {
  ExitBy,
  HostEvent,
  HostEventType,
  HostKind,
  LastResult,
  MessageStatus,
  OwnedExit,
  OwnedSessionRecord,
  OwnedSessionView,
  OwnedState,
  PermissionSummary,
  PersistedStatus,
} from './host/types.js';
export {
  DEFAULT_DENY_MESSAGE,
  MAX_CWD_CHARS,
  MAX_DENY_MESSAGE_CHARS,
  MAX_IMAGES,
  MAX_NAME_CHARS,
  assertWorkingDirectory,
  parseDecisionBody,
  parseLaunchBody,
  parsePermissionModeBody,
  parseSendBody,
} from './host/validation.js';
export type { DecisionRequest, LaunchRequest, SendRequest } from './host/validation.js';
