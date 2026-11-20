import type { HostKind, HostStatus, MessageStatus, OwnedExit, OwnedSessionView, OwnedState, PersistedStatus } from '@wadeck-app/agent-manager-core/launch';
// violations-suppress: ts/no-deep-relative the module's own commons/ contract, one level above this subfolder
import type { DaemonStatusDto, OwnedExitDto, OwnedHostKind, OwnedMessageDto, OwnedSessionDto, OwnedStateDto } from '../../commons/api.js';

/*
 * Compile-time checks that the DTOs of commons/api.ts stay the daemon's types: a field added, renamed or retyped in core makes this file fail to compile
 * instead of silently drifting (the routes pass the daemon's view through as the DTO). The only intended difference is the added 'unknown' state.
 * Types only: nothing here exists at run time.
 */

type Assert<T extends true> = T;
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export type HostKindsAgree = Assert<Mutual<OwnedHostKind, HostKind>>;
export type StatesAgree = Assert<Mutual<Exclude<OwnedStateDto, 'unknown'>, OwnedState>>;
export type PersistedAgree = Assert<Mutual<OwnedSessionDto['status'], PersistedStatus>>;
export type MessageStatesAgree = Assert<Mutual<Exclude<OwnedMessageDto['state'], 'unknown'>, MessageStatus['state']>>;
/** Every field of the daemon's view is in the DTO with the same type, and the other way round (state, rawState and messages carry the 'unknown' addition). */
export type SessionFieldsAgree = Assert<Mutual<Omit<OwnedSessionDto, 'state' | 'rawState' | 'messages' | 'exit'>, Omit<OwnedSessionView, 'state' | 'messages' | 'exit'>>>;
/** The exit report: the DTO carries the cause as plain text (the core union is assignable to it). */
export type ExitFieldsAgree = Assert<Mutual<Omit<OwnedExitDto, 'cause'>, Omit<OwnedExit, 'cause'>>>;
export type ExitCauseIsText = Assert<[OwnedExit['cause']] extends [string] ? true : false>;
/** The daemon status the module shows is the host status plus the optional extras of GET /status. */
export type StatusFieldsAgree = Assert<Mutual<Pick<DaemonStatusDto, keyof HostStatus>, HostStatus>>;
