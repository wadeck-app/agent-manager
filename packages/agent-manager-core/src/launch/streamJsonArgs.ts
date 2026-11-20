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
  /** `--include-partial-messages`: live text deltas. Default true. */
  includePartialMessages?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_TOKEN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
// Model aliases and ids, including Bedrock ids and ARNs (':' '/' '[' ']'); never a leading '-' so a value cannot turn into a flag.
const MODEL = /^[A-Za-z0-9][A-Za-z0-9_.:/[\]-]{0,255}$/;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

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
