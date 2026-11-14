/** busy and idle are the two states the registry `status` gives; any other value (observed: "waiting") is `other`, its raw text stays in `status`. */
export type StatusGroup = 'busy' | 'idle' | 'other';

/**
 * How `alive` was decided. Only 'pid-only' exists in M1b: the process exists. NOT implemented yet (decision 30 of the spec): the comparison of the
 * registry `procStart` (a Windows FILETIME) with the start time of the process, which is what detects a pid reused by another program. Until then a
 * dead session whose pid was taken by an unrelated process is shown alive.
 */
export type LivenessCheck = 'pid-only';

/** One `<pid>.json` of the Claude Code session registry, plus what is derived from it. Unknown fields of the file are ignored. */
export interface Session {
  /** The registry file this session was read from (name only). */
  file: string;
  pid: number;
  sessionId: string;
  cwd: string;
  /** Last directory of `cwd` ("shop" for C:\work\shop). */
  folder: string;
  /** Epoch ms. */
  startedAt?: number;
  /** Process start time as the registry writes it (a Windows FILETIME as text). Read but not yet compared (see LivenessCheck). */
  procStart?: string;
  /** Claude Code version. */
  version?: string;
  peerProtocol?: number;
  kind?: string;
  entrypoint?: string;
  /** The name of the session, when it has one. */
  name?: string;
  nameSource?: string;
  /** Raw registry status ("busy", "idle", "waiting", ...). */
  status: string;
  statusGroup: StatusGroup;
  /** What a "waiting" session waits for ("permission prompt"), when the registry says. */
  waitingFor?: string;
  /** Epoch ms. */
  updatedAt?: number;
  /** Epoch ms. */
  statusUpdatedAt?: number;
  /** now - statusUpdatedAt, never negative; absent when the registry has no statusUpdatedAt. */
  statusAgeMs?: number;
  messagingSocketPath?: string;
  alive: boolean;
  livenessCheck: LivenessCheck;
}

/** A registry file that could not become a Session: shown by the UI, never dropped silently. */
export interface UnreadableFile {
  file: string;
  reason: string;
}

export type RegistryErrorCode = 'missing-dir' | 'not-a-directory' | 'unreadable-dir';

export interface RegistryError {
  code: RegistryErrorCode;
  /** What happened, naming the folder. */
  message: string;
  /** What to do about it. */
  hint: string;
}

export type RegistryResult =
  | { ok: true; dir: string; sessions: Session[]; unreadable: UnreadableFile[] }
  // No `sessions` on purpose: a caller that forgets to test `ok` cannot show an empty list as if the registry was empty.
  | { ok: false; dir: string; error: RegistryError };
