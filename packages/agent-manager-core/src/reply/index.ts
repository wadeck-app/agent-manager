// violations-suppress: ts/no-barrel-index public API of the reply side; src/index.ts re-exports from here
export { NotImplementedError, ReplyError, SAFE_ID, assertSafeId } from './errors.js';
export type { ReplyFs } from './fsTypes.js';
export { DEFAULT_PRIORITY, REPLY_PRIORITIES } from './types.js';
export type { ProbeCheck, ProbeContext, ProbeResult, ReplyMessage, ReplyPriority, ReplyTransport, SendResult, TransportKind } from './types.js';
export { DEFAULT_CONNECT_TIMEOUT_MS, DEFAULT_GRACE_MS, SOCKET_TRANSPORT_ID, buildSocketFrame, createSocketTransport, socketTransport, tokenFileName } from './socketTransport.js';
export type { SocketTransportOptions } from './socketTransport.js';
export { asyncRewakeTransport, herdrTransport, hotWaitTransport, queueModTransport } from './hookTransports.js';
export { MAX_TEXT_CHARS, assertTextLength, composeMessageText, originMarkerFor } from './compose.js';
export type { ComposeInput } from './compose.js';
export { MAX_UPLOAD_BYTES, detectImageExt, saveUpload } from './uploads.js';
export type { ImageExt, SaveUploadInput, SavedUpload } from './uploads.js';
export { DEFAULT_MAX_AGE_MS, DEFAULT_MAX_BYTES, PURGE_CATEGORIES, purge } from './retention.js';
export type { PurgeCategory, PurgeCategoryResult, PurgeOptions, PurgeResult } from './retention.js';
export { appendAudit, auditDay, findSentInAudit, readAudit } from './audit.js';
export type { AuditReadOptions, AuditReadResult, AuditRecord } from './audit.js';
export { DEFAULT_REPLY_CONFIG, DEFAULT_TRANSPORT_ID, parseReplyConfig, readTransportsConfig, writeTransportsConfig } from './config.js';
export type { RawReplyConfig, ReplyConfig, TransportsConfig } from './config.js';
export { deliveryState } from './deliveryState.js';
export type { DeliveryContext, DeliveryRecord, DeliveryStateName, DeliveryStatus, ReplyTranscriptEntry } from './deliveryState.js';
export { createReplyService } from './replyService.js';
export type { ReplyImage, ReplyService, ReplyServiceDeps, SendRequest, SessionTransportStatus, TransportStatusEntry } from './replyService.js';
// The duration parser lives one level up (shared with the CLI); re-exported so that the reply side is self-contained.
export { DurationError, parseDuration } from '../duration.js';
