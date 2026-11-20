import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithStdioTuple } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { getErrorMessage } from '../errors.js';
import { LaunchError } from './errors.js';
import { DEFAULT_MAX_LINE_CHARS, NdjsonFramer } from './ndjsonFramer.js';
import type { Frame } from './ndjsonFramer.js';
import { buildStreamJsonArgs } from './streamJsonArgs.js';
import type { StreamJsonArgsOptions } from './streamJsonArgs.js';
import type { DeliveryOutcome, ExitCause, ExitInfo, ImageInput, InterruptReceipt, LifecycleState, PendingPermission, SentMessage, SessionEvent, SessionState, ToolUse } from './types.js';

/*
 * An OWNED Claude Code session: `claude -p --input-format stream-json --output-format stream-json ...` as a child process whose stdin and stdout this
 * object holds. Every frame below is one measured in research/session-launch-options.md (rounds 1-3, claude 2.1.326-2.1.328): user messages with a
 * client uuid, `command_lifecycle`, `control_request` interrupt / set_permission_mode, `can_use_tool` and its `control_response`. Nothing else is sent.
 *
 * The child lives as long as its stdin is open and ends with its owner (closing the pipe is EOF to it, measured): whoever owns this object must
 * outlive the session (the daemon, decision L1). A restart is a new process with `resume`; an in-flight turn or pending permission is lost (measured).
 *
 * NOT handled, reported instead: control requests other than can_use_tool (event `unsupported_control_request`, not answered: no answer frame is
 * proven), `cancel_queued` of interrupt, `set_model`, `initialize`.
 */

export const DEFAULT_CLAUDE_COMMAND = 'claude';
export const DEFAULT_CLOSE_TIMEOUT_MS = 10_000;
export const DEFAULT_CONTROL_TIMEOUT_MS = 30_000;
export const DEFAULT_STDERR_TAIL_CHARS = 4_000;
/** After the process ended, how long to wait for its pipes to drain before the exit is reported anyway. */
const PIPE_DRAIN_MS = 2_000;
const KILL_WAIT_MS = 10_000;
const IMAGE_MEDIA_TYPE = /^image\/(png|jpeg|gif|webp)$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export interface StreamJsonSessionOptions extends StreamJsonArgsOptions {
  /** The working directory of the session: an existing folder (and, for Claude Code, a trusted one: `-p` shows no trust dialog but runs project hooks). */
  cwd: string;
  /** Program to run. Default 'claude' (found on the PATH, started without a shell). */
  command?: string;
  /** Arguments put before the claude arguments (a test runs `node fakeClaude.mjs`). */
  commandArgs?: readonly string[];
  /** The environment of the child. Default: process.env of this process. */
  env?: NodeJS.ProcessEnv;
  /** A line above this size (characters) is dropped and reported as a `line-too-large` protocol error. */
  maxLineChars?: number;
  stderrTailChars?: number;
  /** How long `close()` waits for the process to end after closing stdin, before it kills it. */
  closeTimeoutMs?: number;
  /** How long a control request (interrupt, set_permission_mode) waits for its response. */
  controlTimeoutMs?: number;
  platform?: NodeJS.Platform;
  /** Test seam: starts the process. Default: child_process.spawn. */
  spawnProcess?: (command: string, args: string[], options: SpawnOptionsWithStdioTuple<'pipe', 'pipe', 'pipe'>) => ChildProcessWithoutNullStreams;
}

type Listener = (event: SessionEvent) => void;

interface TrackedMessage {
  startedSettled: boolean;
  resolveStarted: () => void;
  rejectStarted: (error: Error) => void;
  resolveCompleted: (outcome: DeliveryOutcome) => void;
  rejectCompleted: (error: Error) => void;
}

interface TrackedControl {
  what: string;
  timer: NodeJS.Timeout;
  resolve: (response: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined;
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? `${flat.slice(0, 200)}...` : flat;
}

const LIFECYCLE_STATES: readonly string[] = ['queued', 'started', 'completed', 'cancelled'];

function isLifecycleState(value: string): value is LifecycleState {
  return LIFECYCLE_STATES.includes(value);
}

export class StreamJsonSession {
  readonly pid: number;
  readonly cwd: string;
  /** The arguments claude was started with (after `command` and `commandArgs`). */
  readonly args: readonly string[];

  readonly #child: ChildProcessWithoutNullStreams;
  readonly #framer: NdjsonFramer;
  readonly #stderrTailChars: number;
  readonly #closeTimeoutMs: number;
  readonly #controlTimeoutMs: number;
  readonly #platform: NodeJS.Platform;
  readonly #listeners = new Set<Listener>();
  readonly #messages = new Map<string, TrackedMessage>();
  readonly #controls = new Map<string, TrackedControl>();
  readonly #permissions = new Map<string, PendingPermission>();
  readonly #answering = new Set<string>();
  readonly #queued = new Set<string>();
  readonly #active = new Set<string>();
  readonly #listenerFailures: string[] = [];
  readonly #exited: Promise<ExitInfo>;
  #resolveExited: (info: ExitInfo) => void = () => undefined;
  #sessionId: string;
  #state: SessionState = 'idle';
  #stderrTail = '';
  #closeRequested = false;
  #killRequested = false;
  #exitInfo: ExitInfo | undefined;
  #exitEvent: { code: number | null; signal: string | null } | undefined;
  /** The exit is being reported: no more stdout is read. */
  #finalizing = false;
  /** The exit report exists: the state is `exited`. */
  #finalized = false;
  /** The `exit` event was delivered: it is the last event of the session. */
  #sealed = false;
  #drainTimer: NodeJS.Timeout | undefined;

  private constructor(child: ChildProcessWithoutNullStreams, options: StreamJsonSessionOptions, args: readonly string[], sessionId: string) {
    this.#child = child;
    this.pid = child.pid ?? -1;
    this.cwd = options.cwd;
    this.args = args;
    this.#sessionId = sessionId;
    this.#framer = new NdjsonFramer(options.maxLineChars ?? DEFAULT_MAX_LINE_CHARS);
    this.#stderrTailChars = options.stderrTailChars ?? DEFAULT_STDERR_TAIL_CHARS;
    this.#closeTimeoutMs = options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
    this.#controlTimeoutMs = options.controlTimeoutMs ?? DEFAULT_CONTROL_TIMEOUT_MS;
    this.#platform = options.platform ?? process.platform;
    this.#exited = new Promise((resolve) => {
      this.#resolveExited = resolve;
    });
    child.stdout.on('data', (chunk: Buffer) => {
      // Nothing is read once the exit is being reported: the report is the last word.
      if (!this.#finalizing) {
        this.#handleFrames(this.#framer.push(chunk));
      }
    });
    child.stdout.on('end', () => {
      if (!this.#finalizing) {
        this.#handleFrames(this.#framer.end());
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      this.#stderrTail = `${this.#stderrTail}${chunk.toString('utf8')}`.slice(-this.#stderrTailChars);
    });
    child.stdin.on('error', (error) => {
      // EPIPE when the process died: the exit report carries the cause, this one tells that a write was lost.
      this.#emit({ kind: 'protocol_error', code: 'stdin-failed', detail: `writing to the stdin of claude failed (${getErrorMessage(error)})` });
    });
    child.on('error', (error) => {
      // After a successful start: a failed kill or a failed write. The exit report is separate; this one is never silent.
      this.#emit({ kind: 'protocol_error', code: 'process-error', detail: `the claude process reported an error (${getErrorMessage(error)})` });
    });
    child.once('exit', (code, signal) => {
      this.#exitEvent = { code, signal };
      // The pipes normally close with the process; if a grandchild keeps them open, report the exit anyway after a short wait.
      this.#drainTimer = setTimeout(() => this.#finalize(), PIPE_DRAIN_MS);
      this.#drainTimer.unref();
    });
    child.once('close', (code, signal) => {
      this.#exitEvent ??= { code, signal };
      this.#finalize();
    });
  }

  /**
   * Starts the process. Rejects with a LaunchError (reason and fix) when the folder does not exist, an option is invalid, or the program cannot be
   * started (claude not installed). `sessionId` defaults to a generated UUID unless `resume` is given (then it is the resumed id), so the session
   * can be linked to the registry and the transcript before its first message.
   */
  static async start(options: StreamJsonSessionOptions): Promise<StreamJsonSession> {
    try {
      const folder = await stat(options.cwd);
      if (!folder.isDirectory()) {
        throw new LaunchError('cwd-not-a-folder', `the working directory ${options.cwd} is not a folder`, 'pass the path of an existing project folder');
      }
    } catch (error) {
      if (error instanceof LaunchError) {
        throw error;
      }
      throw new LaunchError('cwd-missing', `the working directory ${options.cwd} cannot be used (${getErrorMessage(error)})`, 'create the folder or pass the path of an existing project folder');
    }
    const sessionId = options.resume ?? options.sessionId ?? randomUUID();
    const claudeArgs = buildStreamJsonArgs({ ...options, ...(options.resume === undefined && options.sessionId === undefined ? { sessionId } : {}) });
    const command = options.command ?? DEFAULT_CLAUDE_COMMAND;
    const child = await new Promise<ChildProcessWithoutNullStreams>((resolve, reject) => {
      const started = (options.spawnProcess ?? spawn)(command, [...(options.commandArgs ?? []), ...claudeArgs], { cwd: options.cwd, env: options.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
      started.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          reject(new LaunchError('claude-missing', `the program '${command}' was not found`, 'install Claude Code and put `claude` on the PATH of the process that runs agent-manager (check with: claude --version)'));
        } else {
          reject(new LaunchError('claude-cannot-start', `the program '${command}' cannot be started (${error.code ?? 'error'}: ${getErrorMessage(error)})`, 'check that `claude` runs from a terminal in the same environment (claude --version), then retry'));
        }
      });
      started.once('spawn', () => resolve(started));
    });
    return new StreamJsonSession(child, options, claudeArgs, sessionId);
  }

  /** The Claude Code session id: the one given or generated at start, or the resumed one. */
  get sessionId(): string {
    return this.#sessionId;
  }

  /** idle (waiting for a message), running (a message started and not finished, or queued), requires_action (a permission waits), exited. */
  get state(): SessionState {
    return this.#state;
  }

  /** Set once the process ended. */
  get exitInfo(): ExitInfo | undefined {
    return this.#exitInfo;
  }

  /** Errors thrown by listeners (bounded to the last 20): a listener that fails never stops the session. */
  get listenerFailures(): readonly string[] {
    return this.#listenerFailures;
  }

  /** The permission requests that wait for allow() or deny(), oldest first. */
  pendingPermissions(): PendingPermission[] {
    return [...this.#permissions.values()];
  }

  /** Subscribes to the events; returns the function that unsubscribes. Events are delivered in the order of the stream. */
  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Resolves when the process has ended (never rejects). */
  waitForExit(): Promise<ExitInfo> {
    return this.#exited;
  }

  /**
   * Sends a user message. Resolves once the line was written; `started` and `completed` follow `command_lifecycle`. The text must not be empty
   * unless images are given. Images become base64 blocks after the text; their size limits are the caller's.
   */
  async send(text: string, images: readonly ImageInput[] = []): Promise<SentMessage> {
    if (text.trim() === '' && images.length === 0) {
      throw new LaunchError('empty-message', 'the message has no text and no image', 'type a message or attach an image');
    }
    for (const image of images) {
      if (!IMAGE_MEDIA_TYPE.test(image.mediaType)) {
        throw new LaunchError('invalid-image', `the image type ${JSON.stringify(image.mediaType)} is not supported`, 'use image/png, image/jpeg, image/gif or image/webp');
      }
      if (!BASE64.test(image.dataBase64)) {
        throw new LaunchError('invalid-image', 'the image data is not base64', 'pass the bytes as plain base64, without a "data:" prefix');
      }
    }
    const uuid = randomUUID();
    const content = images.length === 0 ? text : [{ type: 'text', text }, ...images.map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.dataBase64 } }))];
    const tracked = this.#track(uuid);
    try {
      await this.#write({ type: 'user', uuid, message: { role: 'user', content } });
    } catch (error) {
      this.#messages.delete(uuid);
      this.#queued.delete(uuid);
      throw error;
    }
    this.#recompute();
    return tracked;
  }

  /** Interrupts the running turn (control_request `interrupt`); resolves with the receipt. Without a running turn it succeeds and does nothing (measured). */
  async interrupt(): Promise<InterruptReceipt> {
    const response = await this.#control({ subtype: 'interrupt' }, 'interrupt');
    const stillQueued = response['still_queued'];
    const cancelled = response['cancelled'];
    return {
      stillQueued: Array.isArray(stillQueued) ? stillQueued.filter((entry): entry is string => typeof entry === 'string') : [],
      ...(Array.isArray(cancelled) ? { cancelled: cancelled.filter((entry): entry is string => typeof entry === 'string') } : {}),
    };
  }

  /** Changes the permission mode now (control_request `set_permission_mode`); resolves with the mode Claude Code reports back. */
  async setPermissionMode(mode: string): Promise<string> {
    // Same shape check as the start argument: a single word.
    buildStreamJsonArgs({ permissionMode: mode });
    const response = await this.#control({ subtype: 'set_permission_mode', mode }, `set_permission_mode ${mode}`);
    return asText(response['mode']) ?? mode;
  }

  /** Allows one pending tool call. `updatedInput` defaults to the input as it was requested. */
  async allow(requestId: string, updatedInput?: Record<string, unknown>): Promise<void> {
    const pending = this.#takePermission(requestId);
    await this.#answer(pending, { behavior: 'allow', updatedInput: updatedInput ?? pending.input });
    this.#emit({ kind: 'permission_resolved', requestId, behavior: 'allow' });
  }

  /** Denies one pending tool call; the model receives `message` as the reason. */
  async deny(requestId: string, message: string): Promise<void> {
    if (message.trim() === '') {
      throw new LaunchError('empty-deny-message', 'a denial needs a message: the model reads it as the reason', 'pass a short reason, e.g. "Denied by the user"');
    }
    const pending = this.#takePermission(requestId);
    await this.#answer(pending, { behavior: 'deny', message });
    this.#emit({ kind: 'permission_resolved', requestId, behavior: 'deny' });
  }

  /**
   * Ends the session: closes stdin (Claude Code finishes what it runs and exits, measured 72 ms after the close when idle), waits for the exit, and
   * kills the process when it has not ended after `closeTimeoutMs`. Resolves with the exit report.
   */
  async close(): Promise<ExitInfo> {
    if (this.#exitInfo !== undefined) {
      return this.#exitInfo;
    }
    // A close that comes after the process ended by itself must not turn that exit into a "closed" one.
    this.#closeRequested = this.#exitEvent === undefined;
    if (!this.#child.stdin.writableEnded) {
      this.#child.stdin.end();
    }
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.#closeTimeoutMs);
    });
    try {
      const winner = await Promise.race([this.#exited, timedOut]);
      if (winner === 'timeout') {
        return await this.kill();
      }
      return winner;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Ends the process and its children at once (taskkill /T on Windows). A pending turn and permission are lost. Resolves with the exit report. */
  async kill(): Promise<ExitInfo> {
    if (this.#exitInfo !== undefined) {
      return this.#exitInfo;
    }
    // 'killed' only when the exit came after the kill: a process that already ended by itself keeps its own cause (a crash stays a crash), and its
    // pid is not signalled (it may belong to another program by now).
    if (this.#exitEvent === undefined) {
      this.#killRequested = true;
      this.#killTree();
    }
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), KILL_WAIT_MS);
    });
    try {
      const winner = await Promise.race([this.#exited, timedOut]);
      if (winner === 'timeout') {
        throw new LaunchError('kill-failed', `the process ${this.pid} did not end ${KILL_WAIT_MS} ms after the kill`, `end it by hand (${this.#platform === 'win32' ? `taskkill /PID ${this.pid} /T /F` : `kill -9 ${this.pid}`}); agent-manager will not retry`);
      }
      return winner;
    } finally {
      clearTimeout(timer);
    }
  }

  #killTree(): void {
    if (this.#platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(this.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, shell: false });
      killer.once('error', () => {
        // taskkill itself is missing or failed to start: the plain kill still ends the main process.
        this.#child.kill('SIGKILL');
      });
      return;
    }
    this.#child.kill('SIGKILL');
  }

  #track(uuid: string): SentMessage {
    const tracked: TrackedMessage = {
      startedSettled: false,
      resolveStarted: () => undefined,
      rejectStarted: () => undefined,
      resolveCompleted: () => undefined,
      rejectCompleted: () => undefined,
    };
    const started = new Promise<void>((resolve, reject) => {
      tracked.resolveStarted = resolve;
      tracked.rejectStarted = reject;
    });
    const completed = new Promise<DeliveryOutcome>((resolve, reject) => {
      tracked.resolveCompleted = resolve;
      tracked.rejectCompleted = reject;
    });
    // A message nobody awaits must never become an unhandled rejection; a caller that awaits still sees the rejection.
    started.catch(() => undefined);
    completed.catch(() => undefined);
    this.#messages.set(uuid, tracked);
    this.#queued.add(uuid);
    return { uuid, started, completed };
  }

  #write(frame: Record<string, unknown>): Promise<void> {
    if (this.#exitInfo !== undefined || this.#exitEvent !== undefined) {
      return Promise.reject(this.#notRunning());
    }
    if (this.#child.stdin.writableEnded || this.#child.stdin.destroyed) {
      return Promise.reject(new LaunchError('session-closing', 'the session is closing: its stdin is already closed', 'start a new session (or resume this one) to send more'));
    }
    return new Promise((resolve, reject) => {
      this.#child.stdin.write(`${JSON.stringify(frame)}\n`, (error) => {
        if (error === null || error === undefined) {
          resolve();
        } else {
          reject(new LaunchError('write-failed', `writing to claude failed (${getErrorMessage(error)}); the process probably ended`, 'look at the exit report (stderr tail) of the session, then resume it'));
        }
      });
    });
  }

  #notRunning(): LaunchError {
    const info = this.#exitInfo;
    const how = info === undefined ? 'is ending' : `ended (${info.cause}, exit code ${String(info.code)}${info.signal === null ? '' : `, signal ${info.signal}`})`;
    return new LaunchError('session-exited', `the claude process ${this.pid} ${how}${info === undefined || info.stderrTail === '' ? '' : `; stderr: ${excerpt(info.stderrTail)}`}`, 'start a new session, or resume this one by its session id');
  }

  #control(request: Record<string, unknown>, what: string): Promise<Record<string, unknown>> {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#controls.delete(requestId);
        reject(new LaunchError('control-timeout', `claude did not answer the ${what} request within ${this.#controlTimeoutMs} ms`, 'the process may be stuck: close() or kill() the session and resume it'));
      }, this.#controlTimeoutMs);
      this.#controls.set(requestId, { what, timer, resolve, reject });
      this.#write({ type: 'control_request', request_id: requestId, request }).catch((error: unknown) => {
        clearTimeout(timer);
        this.#controls.delete(requestId);
        reject(error);
      });
    });
  }

  #takePermission(requestId: string): PendingPermission {
    const pending = this.#permissions.get(requestId);
    if (pending === undefined) {
      throw new LaunchError('unknown-permission-request', `no pending permission request ${JSON.stringify(requestId)} (already answered, or the process ended)`, 'reload the list of pending permissions of the session');
    }
    if (this.#answering.has(requestId)) {
      throw new LaunchError('permission-being-answered', `the permission request ${JSON.stringify(requestId)} is being answered`, 'wait for the first answer to finish');
    }
    return pending;
  }

  /** Writes the control_response of a permission request. The request leaves the queue only after the write succeeded. */
  async #answer(pending: PendingPermission, answer: Record<string, unknown>): Promise<void> {
    // Marked first so that a second answer for the same request is refused while this one is being written. The request stays in the queue until the
    // write succeeded: if the process ends meanwhile, the exit report still resolves it as process-ended, and nothing is ever put back afterwards.
    this.#answering.add(pending.requestId);
    try {
      await this.#write({ type: 'control_response', response: { subtype: 'success', request_id: pending.requestId, response: answer } });
      this.#permissions.delete(pending.requestId);
    } catch (error) {
      if (this.#finalizing) {
        throw this.#notRunning();
      }
      throw error;
    } finally {
      this.#answering.delete(pending.requestId);
      this.#recompute();
    }
  }

  #emit(event: SessionEvent): void {
    if (this.#sealed) {
      return;
    }
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch (error) {
        const detail = `a listener threw on '${event.kind}' (${getErrorMessage(error)})`;
        this.#listenerFailures.push(detail);
        if (this.#listenerFailures.length > 20) {
          this.#listenerFailures.shift();
        }
        // Not re-emitted for a protocol_error itself: a listener that always throws would loop.
        if (event.kind !== 'protocol_error') {
          this.#emit({ kind: 'protocol_error', code: 'listener-failed', detail });
        }
      }
    }
  }

  #recompute(): void {
    const next: SessionState = this.#finalized ? 'exited' : this.#permissions.size > 0 ? 'requires_action' : this.#active.size > 0 || this.#queued.size > 0 ? 'running' : 'idle';
    if (next !== this.#state) {
      const previous = this.#state;
      this.#state = next;
      this.#emit({ kind: 'state', state: next, previous });
    }
  }

  #handleFrames(frames: readonly Frame[]): void {
    for (const frame of frames) {
      if (frame.kind === 'oversize') {
        this.#emit({ kind: 'protocol_error', code: 'line-too-large', detail: `a line of ${frame.chars} characters was dropped (limit reached): the event it carried is lost` });
        continue;
      }
      let value: unknown;
      try {
        value = JSON.parse(frame.text);
      } catch (error) {
        this.#emit({ kind: 'protocol_error', code: 'bad-json', detail: `a line of claude is not JSON (${getErrorMessage(error)}): ${excerpt(frame.text)}` });
        continue;
      }
      const raw = asRecord(value);
      if (raw === undefined) {
        this.#emit({ kind: 'protocol_error', code: 'bad-json', detail: `a line of claude is not a JSON object: ${excerpt(frame.text)}` });
        continue;
      }
      this.#handleObject(raw);
    }
  }

  #handleObject(raw: Record<string, unknown>): void {
    const type = asText(raw['type']);
    switch (type) {
      case 'system':
        this.#handleSystem(raw);
        break;
      case 'stream_event':
        this.#handleStreamEvent(raw);
        break;
      case 'assistant':
        this.#handleAssistant(raw);
        break;
      case 'user':
        if (raw['isReplay'] === true) {
          const uuid = asText(raw['uuid']);
          this.#emit({ kind: 'user_replay', ...(uuid === undefined ? {} : { uuid }), raw });
        } else {
          this.#emit({ kind: 'unknown', type: 'user', raw });
        }
        break;
      case 'result':
        this.#handleResult(raw);
        break;
      case 'command_lifecycle':
        this.#handleLifecycle(raw);
        break;
      case 'control_request':
        this.#handleControlRequest(raw);
        break;
      case 'control_response':
        this.#handleControlResponse(raw);
        break;
      default:
        this.#emit({ kind: 'unknown', ...(type === undefined ? {} : { type }), raw });
    }
  }

  #handleSystem(raw: Record<string, unknown>): void {
    const subtype = asText(raw['subtype']) ?? '';
    if (subtype === 'init') {
      const sessionId = asText(raw['session_id']);
      if (sessionId !== undefined) {
        this.#sessionId = sessionId;
      }
      const cwd = asText(raw['cwd']);
      const model = asText(raw['model']);
      const tools = Array.isArray(raw['tools']) ? raw['tools'].filter((tool): tool is string => typeof tool === 'string') : [];
      this.#emit({ kind: 'init', sessionId: this.#sessionId, ...(cwd === undefined ? {} : { cwd }), ...(model === undefined ? {} : { model }), tools, raw });
      return;
    }
    this.#emit({ kind: 'system', subtype, raw });
  }

  #handleStreamEvent(raw: Record<string, unknown>): void {
    const event = asRecord(raw['event']);
    const delta = asRecord(event?.['delta']);
    if (event?.['type'] === 'content_block_delta' && delta?.['type'] === 'text_delta' && typeof delta['text'] === 'string') {
      this.#emit({ kind: 'text_delta', text: delta['text'], raw });
      return;
    }
    this.#emit({ kind: 'stream_event', raw });
  }

  #handleAssistant(raw: Record<string, unknown>): void {
    const content = asRecord(raw['message'])?.['content'];
    const blocks = Array.isArray(content) ? content.map(asRecord) : [];
    let text = '';
    const toolUses: ToolUse[] = [];
    for (const block of blocks) {
      if (block?.['type'] === 'text' && typeof block['text'] === 'string') {
        text += block['text'];
      } else if (block?.['type'] === 'tool_use') {
        toolUses.push({ toolUseId: asText(block['id']) ?? '', name: asText(block['name']) ?? '', input: block['input'] });
      }
    }
    this.#emit({ kind: 'assistant', text, toolUses, raw });
  }

  #handleResult(raw: Record<string, unknown>): void {
    // The turn is over: what was running is not; `completed` follows a few ms later and removes the message itself.
    this.#active.clear();
    const stopReason = asText(raw['stop_reason']);
    const text = asText(raw['result']);
    this.#emit({ kind: 'result', subtype: asText(raw['subtype']) ?? '', isError: raw['is_error'] === true, ...(stopReason === undefined ? {} : { stopReason }), ...(text === undefined ? {} : { text }), raw });
    this.#recompute();
  }

  #handleLifecycle(raw: Record<string, unknown>): void {
    const uuid = asText(raw['command_uuid']);
    const state = asText(raw['state']);
    if (uuid === undefined || state === undefined || !isLifecycleState(state)) {
      this.#emit({ kind: 'protocol_error', code: 'bad-json', detail: `a command_lifecycle line has no usable command_uuid and state: ${excerpt(JSON.stringify(raw))}` });
      return;
    }
    const tracked = this.#messages.get(uuid);
    if (state === 'queued') {
      this.#queued.add(uuid);
    } else if (state === 'started') {
      this.#queued.delete(uuid);
      this.#active.add(uuid);
      if (tracked !== undefined && !tracked.startedSettled) {
        tracked.startedSettled = true;
        tracked.resolveStarted();
      }
    } else {
      this.#queued.delete(uuid);
      this.#active.delete(uuid);
      this.#messages.delete(uuid);
      if (tracked !== undefined) {
        if (!tracked.startedSettled) {
          tracked.startedSettled = true;
          if (state === 'completed') {
            tracked.resolveStarted();
          } else {
            tracked.rejectStarted(new LaunchError('message-cancelled', `the message ${uuid} was cancelled before it started (interrupt)`, 'send it again if it is still wanted'));
          }
        }
        tracked.resolveCompleted(state);
      }
    }
    this.#emit({ kind: 'lifecycle', uuid, state, raw });
    this.#recompute();
  }

  #handleControlRequest(raw: Record<string, unknown>): void {
    const requestId = asText(raw['request_id']);
    const request = asRecord(raw['request']);
    const subtype = asText(request?.['subtype']);
    if (subtype !== 'can_use_tool' || requestId === undefined || request === undefined) {
      this.#emit({ kind: 'unsupported_control_request', ...(requestId === undefined ? {} : { requestId }), ...(subtype === undefined ? {} : { subtype }), raw });
      return;
    }
    const displayName = asText(request['display_name']);
    const description = asText(request['description']);
    const toolUseId = asText(request['tool_use_id']);
    const blockedPath = asText(request['blocked_path']);
    const suggestions = request['permission_suggestions'];
    const pending: PendingPermission = {
      requestId,
      toolName: asText(request['tool_name']) ?? '',
      ...(displayName === undefined ? {} : { displayName }),
      input: request['input'],
      ...(description === undefined ? {} : { description }),
      ...(toolUseId === undefined ? {} : { toolUseId }),
      ...(blockedPath === undefined ? {} : { blockedPath }),
      permissionSuggestions: Array.isArray(suggestions) ? suggestions : [],
      receivedAt: Date.now(),
    };
    this.#permissions.set(requestId, pending);
    this.#emit({ kind: 'permission_request', request: pending });
    this.#recompute();
  }

  #handleControlResponse(raw: Record<string, unknown>): void {
    const response = asRecord(raw['response']);
    const requestId = asText(response?.['request_id']);
    const tracked = requestId === undefined ? undefined : this.#controls.get(requestId);
    if (requestId === undefined || tracked === undefined || response === undefined) {
      this.#emit({ kind: 'control_response', ...(requestId === undefined ? {} : { requestId }), raw });
      return;
    }
    clearTimeout(tracked.timer);
    this.#controls.delete(requestId);
    if (response['subtype'] === 'success') {
      tracked.resolve(asRecord(response['response']) ?? {});
    } else {
      // The error frame is not documented: its text is shown as received.
      const reason = asText(response['error']) ?? excerpt(JSON.stringify(response));
      tracked.reject(new LaunchError('control-refused', `claude refused the ${tracked.what} request (${reason})`, 'check the value and the state of the session, then retry'));
    }
  }

  #finalize(): void {
    if (this.#finalizing) {
      return;
    }
    this.#finalizing = true;
    clearTimeout(this.#drainTimer);
    // Whatever was buffered is still an event (the last line may have no newline): delivered BEFORE the state becomes `exited`.
    this.#handleFrames(this.#framer.end());
    this.#finalized = true;
    const { code, signal } = this.#exitEvent ?? { code: null, signal: null };
    let cause: ExitCause;
    if (this.#killRequested) {
      cause = 'killed';
    } else if (this.#closeRequested && code === 0) {
      cause = 'closed';
    } else if (code === 0) {
      cause = 'exited';
    } else {
      cause = 'crashed';
    }
    const info: ExitInfo = { cause, code, signal, stderrTail: this.#stderrTail };
    if (cause === 'crashed' || cause === 'exited') {
      const how = cause === 'crashed' ? `crashed (exit code ${String(code)}${signal === null ? '' : `, signal ${signal}`})` : 'ended by itself (exit code 0) although nobody closed it';
      info.error = new LaunchError(
        cause === 'crashed' ? 'claude-crashed' : 'claude-exited',
        `the claude process ${this.pid} ${how}${this.#stderrTail === '' ? '' : `; stderr: ${excerpt(this.#stderrTail)}`}`,
        'read the stderr tail of the exit report, then resume the session by its id (an in-flight turn and a pending permission are lost)',
      );
    }
    this.#exitInfo = info;
    for (const tracked of this.#controls.values()) {
      clearTimeout(tracked.timer);
      tracked.reject(this.#notRunning());
    }
    this.#controls.clear();
    const lost = this.#notRunning();
    for (const tracked of this.#messages.values()) {
      if (!tracked.startedSettled) {
        tracked.startedSettled = true;
        tracked.rejectStarted(lost);
      }
      tracked.rejectCompleted(lost);
    }
    this.#messages.clear();
    this.#queued.clear();
    this.#active.clear();
    for (const requestId of [...this.#permissions.keys()]) {
      this.#permissions.delete(requestId);
      this.#emit({ kind: 'permission_resolved', requestId, behavior: 'process-ended' });
    }
    this.#recompute();
    this.#emit({ kind: 'exit', info });
    this.#sealed = true;
    this.#resolveExited(info);
  }
}
