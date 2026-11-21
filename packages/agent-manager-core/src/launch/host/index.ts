// violations-suppress: ts/no-barrel-index public API of the session host; re-exported by launch/index.ts (subpath export ./launch of the package)
export { DEFAULT_VERSION_TIMEOUT_MS, readClaudeVersion } from './claudeVersion.js';
export type { ClaudeVersionOptions } from './claudeVersion.js';
export { DEFAULT_EVENT_CAPACITY, EventLog } from './EventLog.js';
export type { ReplayResult } from './EventLog.js';
export { appendHostAudit, hostAuditFile } from './hostAudit.js';
export type { HostAuditAction, HostAuditRecord } from './hostAudit.js';
export { describeLeftover, findLeftovers } from './leftovers.js';
export type { Leftover } from './leftovers.js';
export { DEFAULT_BG_OBSERVE_INTERVAL_MS, DEFAULT_MAX_LIVE_SESSIONS, DEFAULT_MAX_RECORDS, SessionHost, bgOwnedState } from './SessionHost.js';
export type { BgLauncherLike, HcLauncherLike, HostStatus, InitResult, SessionHostOptions, ShutdownResult } from './SessionHost.js';
export { STATE_FILE_NAME, STATE_FILE_VERSION, ownedStatePath, readOwnedState, writeOwnedState } from './stateFile.js';
export { HOST_KINDS, MAX_MESSAGES_PER_SESSION, MAX_RESULT_TEXT_CHARS, MAX_STDERR_TAIL_CHARS } from './types.js';
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
} from './types.js';
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
} from './validation.js';
export type { DecisionRequest, LaunchRequest, SendRequest } from './validation.js';
