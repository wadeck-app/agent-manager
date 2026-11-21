import { LaunchError } from './errors.js';

export interface StreamJsonArgsOptions {
  /** `--permission-mode`: default, acceptEdits, plan, auto, ... (any single token that starts with a letter). Omitted: Claude Code decides. */
  permissionMode?: string;
  /** `--model`: an alias (haiku) or a model id. Omitted: the default of the user. */
  model?: string;
  /** `--session-id` of a NEW session (a UUID). Exclusive with `resume`. */
  sessionId?: string;
  /** `--resume` of an existing session id. Exclusive with `sessionId`. */
  resume?: string;
  /**
   * Fork of an existing session: `--resume <forkOf> --fork-session --session-id <sessionId>` (research/session-fork.md). The source stays untouched, the
   * child continues a copy of its history under `sessionId` (required: Claude Code refuses `--session-id` with `--resume` without `--fork-session`, and
   * the host needs the id before the first message). Exclusive with `resume`.
   */
  forkOf?: string;
  /**
   * `--resume-session-at <uuid>`: the fork keeps only the transcript up to and including the entry with this `uuid` (a thread, #65). A HIDDEN print-mode flag of
   * Claude Code (not in `claude --help`, measured on 2.1.330 in research/session-fork.md): only valid with `forkOf` (alone it would resume in place); the
   * integration test is its tripwire.
   */
  resumeSessionAt?: string;
  /** `--include-partial-messages`: live text deltas. Default true. */
  includePartialMessages?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_TOKEN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
// Model aliases and ids, including Bedrock ids and ARNs (':' '/' '[' ']'); never a leading '-' so a value cannot turn into a flag.
const MODEL = /^[A-Za-z0-9][A-Za-z0-9_.:/[\]-]{0,255}$/;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** The uuid of a transcript entry: the shape is checked so that a value can never become a flag or a second argument. */
export function assertResumeSessionAt(value: string): void {
  if (!UUID.test(value)) {
    throw new LaunchError('invalid-resume-session-at', `the message id ${JSON.stringify(value)} is not a UUID`, 'pass the uuid of a transcript entry (the `uuid` of a log row)');
  }
}

/** Each check throws a LaunchError with a fix. They are shared by the stream-json arguments and the hc launcher. */
export function assertPermissionMode(value: string): void {
  if (!SAFE_TOKEN.test(value)) {
    throw new LaunchError('invalid-permission-mode', `the permission mode ${JSON.stringify(value)} is not a single word`, 'use one of default, acceptEdits, plan, auto (as `claude --help` lists them)');
  }
}

export function assertModel(value: string): void {
  if (!MODEL.test(value)) {
    throw new LaunchError('invalid-model', `the model ${JSON.stringify(value)} is not an alias or a model id`, 'use an alias such as haiku or a full model id (letters, digits and . _ : / [ ] - only, no leading "-")');
  }
}

export function assertNewSessionId(value: string): void {
  if (!UUID.test(value)) {
    throw new LaunchError('invalid-session-id', `the session id ${JSON.stringify(value)} is not a UUID`, 'pass a UUID (crypto.randomUUID()), or leave it out to get a generated one');
  }
}

export function assertResumeId(value: string): void {
  if (!SESSION_ID.test(value)) {
    throw new LaunchError('invalid-session-id', `the session id to resume ${JSON.stringify(value)} is not a safe identifier`, 'pass the session id as the registry shows it (a UUID)');
  }
}

/** The session to fork is the one of the registry or a transcript name: a UUID (a looser value would only produce a "No conversation found" from claude). */
export function assertForkSourceId(value: string): void {
  if (!UUID.test(value)) {
    throw new LaunchError('invalid-fork-source', `the session to fork ${JSON.stringify(value)} is not a UUID`, 'pass the session id as the registry shows it (a UUID)');
  }
}

/**
 * The arguments of the owned stream-json child, the shape proven in research/session-launch-options.md (rounds 1-3). The one place that builds
 * them: an argument array for a process started WITHOUT a shell, so no value is ever interpreted. Every value is checked (a value that starts
 * with '-' or holds a space would change the meaning of the command line) and a bad one throws a LaunchError, never a silent default.
 * Not passed on purpose: --setting-sources (the user's settings, hooks and Bedrock env apply), --dangerously-skip-permissions, --allowedTools.
 */
export function buildStreamJsonArgs(options: StreamJsonArgsOptions = {}): string[] {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--replay-user-messages', '--permission-prompt-tool', 'stdio'];
  if (options.includePartialMessages ?? true) {
    args.push('--include-partial-messages');
  }
  if (options.permissionMode !== undefined) {
    assertPermissionMode(options.permissionMode);
    args.push('--permission-mode', options.permissionMode);
  }
  if (options.model !== undefined) {
    assertModel(options.model);
    args.push('--model', options.model);
  }
  if (options.resumeSessionAt !== undefined && options.forkOf === undefined) {
    throw new LaunchError('resume-at-without-fork', 'resumeSessionAt was given without forkOf', 'pass forkOf (the session to branch from): without a fork the session would be resumed in place, not branched');
  }
  if (options.forkOf !== undefined) {
    if (options.resume !== undefined) {
      throw new LaunchError('fork-and-resume', 'forkOf and resume were both given', 'pass forkOf to start a copy of a session, or resume to continue one, not both');
    }
    if (options.sessionId === undefined) {
      throw new LaunchError('fork-without-session-id', 'a fork needs the id of the new session', 'pass sessionId (crypto.randomUUID()) with forkOf');
    }
    assertForkSourceId(options.forkOf);
    assertNewSessionId(options.sessionId);
    if (options.sessionId.toLowerCase() === options.forkOf.toLowerCase()) {
      throw new LaunchError('fork-same-id', 'the fork and its source have the same session id', 'give the fork a new UUID');
    }
    args.push('--resume', options.forkOf, '--fork-session', '--session-id', options.sessionId);
    if (options.resumeSessionAt !== undefined) {
      assertResumeSessionAt(options.resumeSessionAt);
      args.push('--resume-session-at', options.resumeSessionAt);
    }
    return args;
  }
  if (options.sessionId !== undefined && options.resume !== undefined) {
    throw new LaunchError('session-id-and-resume', 'sessionId and resume were both given', 'pass sessionId to start a new session, or resume to continue an existing one, not both');
  }
  if (options.sessionId !== undefined) {
    assertNewSessionId(options.sessionId);
    args.push('--session-id', options.sessionId);
  }
  if (options.resume !== undefined) {
    assertResumeId(options.resume);
    args.push('--resume', options.resume);
  }
  return args;
}
