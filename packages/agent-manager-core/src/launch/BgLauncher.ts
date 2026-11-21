import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { getErrorMessage } from '../errors.js';
import { LaunchError } from './errors.js';
import { assertModel, assertPermissionMode } from './streamJsonArgs.js';

/*
 * The X2 launcher: `claude --bg` (a background session hosted by the Claude Code supervisor) and the documented commands around it. Nothing here is owned:
 * the supervisor owns the process, this module only starts it and asks about it (measured in research/session-launch-options.md rounds 1 and 3, official
 * docs in "Round 4").
 *
 * Every call is an argument array for a process started WITHOUT a shell. What is documented (agent-view and cli-reference pages): `--bg`, `--name`,
 * `--model`, `--permission-mode`, `agents --json [--all]`, `stop`, `respawn`, `rm`. What is only observed: the line `backgrounded - <id> - <name>` that
 * `--bg` prints (the docs show it, they do not promise it), and `kind: "background"` of an entry. A format that does not match is an error with the
 * output in it, never a guess.
 */

export const DEFAULT_BG_LAUNCH_TIMEOUT_MS = 60_000;
export const DEFAULT_BG_COMMAND_TIMEOUT_MS = 20_000;
export const DEFAULT_BG_LIST_TIMEOUT_MS = 30_000;
export const DEFAULT_BG_LINK_TIMEOUT_MS = 30_000;
export const DEFAULT_BG_POLL_INTERVAL_MS = 500;
/** Grace after the CLI exited to read what it still wrote (a supervisor started by `--bg` may hold the pipes open: the exit is the end). */
const EXIT_DRAIN_MS = 250;
/** The output of a command is read up to this many bytes: more is an explicit error for `agents`, never a truncated JSON. */
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_NAME_CHARS = 64;
const BG_ID = /^[0-9a-f]{6,16}$/i;
// `backgrounded <separator> <short id>`: the separator is a middle dot in the docs, whatever the console encoding makes of it here.
const BACKGROUNDED_LINE = /backgrounded[^0-9a-zA-Z\r\n]{1,8}([0-9a-f]{6,16})\b/i;
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export interface BgCommandOptions {
  /** The program. Default `claude` on the PATH. Tests run `node fakeBgClaude.mjs`. */
  command?: string;
  commandArgs?: readonly string[];
  env?: NodeJS.ProcessEnv;
}

export interface BgLauncherOptions extends BgCommandOptions {
  launchTimeoutMs?: number;
  commandTimeoutMs?: number;
  listTimeoutMs?: number;
  /** How long to wait for the new session to show up in `claude agents --json` with its session id. */
  linkTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Receives what a read of `agents --json` skipped (entries it could not understand): visible, never silent. */
  onWarning?: (text: string) => void;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
}

export interface BgLaunchRequest {
  /** An existing absolute folder, already trusted by Claude Code (else `--bg` refuses with `Workspace not trusted`). */
  cwd: string;
  model?: string;
  permissionMode?: string;
  name?: string;
}

/** One entry of `claude agents --json`. Only what is documented is read; `state` and `status` stay plain text (a newer Claude Code may add values). */
export interface BgAgent {
  /** The short id (the job id): what `attach`, `logs`, `stop`, `respawn`, `rm` take. Background entries only. */
  id: string;
  /** The full session UUID: the registry id and the transcript name. Absent until the session started. */
  sessionId?: string;
  cwd: string;
  kind: string;
  name?: string;
  /** working | blocked | done | failed | stopped. */
  state?: string;
  /** busy | waiting | idle, while the process is alive. */
  status?: string;
  /** `permission prompt`, `input needed`, ... when `status` is waiting. */
  waitingFor?: string;
  pid?: number;
  startedAt?: number;
}

export interface BgLaunchResult {
  jobId: string;
  agent: BgAgent & { sessionId: string };
  /** Milliseconds from the start of `claude --bg` to the match in `agents --json`. */
  linkedAfterMs: number;
}

interface CommandRun {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Bytes the process wrote to stdout in all, also those not kept because of MAX_OUTPUT_BYTES. */
  stdoutBytes: number;
}

const plain = (text: string): string => text.replace(ANSI, '');
const excerpt = (text: string): string => plain(text).replace(/\s+/g, ' ').trim().slice(0, 300);

/** The short id of a background session as a command argument: hexadecimal only, so it can never be read as a flag. */
export function assertBgId(value: string): void {
  if (!BG_ID.test(value)) {
    throw new LaunchError('invalid-job-id', `the background session id ${JSON.stringify(value)} is not a short hexadecimal id`, 'use the id that `claude agents` shows (8 hexadecimal characters)');
  }
}

/** The arguments of `claude --bg`, the one place that builds them. No prompt is passed: the session starts idle and costs no model call. */
export function buildBgArgs(request: Pick<BgLaunchRequest, 'model' | 'permissionMode' | 'name'>): string[] {
  const args = ['--bg'];
  if (request.model !== undefined) {
    assertModel(request.model);
    args.push('--model', request.model);
  }
  if (request.permissionMode !== undefined) {
    assertPermissionMode(request.permissionMode);
    args.push('--permission-mode', request.permissionMode);
  }
  if (request.name !== undefined) {
    if (request.name === '' || request.name.length > MAX_NAME_CHARS || /[\u0000-\u001f\u007f]/.test(request.name) || request.name.startsWith('-')) {
      throw new LaunchError('invalid-name', `the session name ${JSON.stringify(request.name)} is not valid`, `use 1 to ${MAX_NAME_CHARS} characters on one line, not starting with "-"`);
    }
    args.push('--name', request.name);
  }
  return args;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(entry: Record<string, unknown>, key: string): string | undefined {
  const value = entry[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function optionalNumber(entry: Record<string, unknown>, key: string): number | undefined {
  const value = entry[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export interface AgentsReport {
  agents: BgAgent[];
  /** One text per entry that could not be read (why), in order: the valid entries are kept, these are reported, never thrown. */
  skipped: string[];
}

/**
 * The background entries of the output of `claude agents --json [--all]`, entry by entry: an interactive entry (no `id`, kind other than background) is left
 * out as documented, an entry that has no usable id, cwd and kind is SKIPPED and reported in `skipped` (one unreadable or newer entry must not blank the list,
 * nor make a removal impossible). Output that is not a JSON array at all is an error: the whole format is then not the documented one.
 */
export function parseAgentsReport(output: string): AgentsReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plain(output).trim());
  } catch (error) {
    throw new LaunchError('bg-bad-answer', `claude agents --json did not print JSON (${getErrorMessage(error)}): ${excerpt(output) || 'no output'}`, 'run `claude agents --json` in a terminal to see what it prints; report this if the format changed (tested with Claude Code 2.1.330)');
  }
  if (!Array.isArray(parsed)) {
    throw new LaunchError('bg-bad-answer', `claude agents --json printed ${typeof parsed}, not an array: ${excerpt(output)}`, 'report this: the documented output is a JSON array');
  }
  const agents: BgAgent[] = [];
  const skipped: string[] = [];
  for (const [index, entry] of parsed.entries()) {
    if (!isRecord(entry)) {
      skipped.push(`entry ${index} is not an object`);
      continue;
    }
    const kind = optionalText(entry, 'kind');
    const id = optionalText(entry, 'id');
    // An interactive session has no id (documented): it is not ours to list.
    if (id === undefined && kind !== 'background') {
      continue;
    }
    const cwd = optionalText(entry, 'cwd');
    if (id === undefined || cwd === undefined || kind === undefined || !BG_ID.test(id)) {
      skipped.push(`entry ${index} has no usable id, cwd and kind (${excerpt(JSON.stringify(entry)).slice(0, 120)})`);
      continue;
    }
    const sessionId = optionalText(entry, 'sessionId');
    const name = optionalText(entry, 'name');
    const state = optionalText(entry, 'state');
    const status = optionalText(entry, 'status');
    const waitingFor = optionalText(entry, 'waitingFor');
    const pid = optionalNumber(entry, 'pid');
    const startedAt = optionalNumber(entry, 'startedAt');
    agents.push({
      id,
      cwd,
      kind,
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(name === undefined ? {} : { name }),
      ...(state === undefined ? {} : { state }),
      ...(status === undefined ? {} : { status }),
      ...(waitingFor === undefined ? {} : { waitingFor }),
      ...(pid === undefined ? {} : { pid }),
      ...(startedAt === undefined ? {} : { startedAt }),
    });
  }
  return { agents, skipped };
}

/** The valid background entries of the output (see parseAgentsReport for what is skipped). */
export function parseAgentsJson(output: string): BgAgent[] {
  return parseAgentsReport(output).agents;
}

/** The short id `claude --bg` printed, or undefined when no line has the documented shape. */
export function parseBackgroundedId(output: string): string | undefined {
  return BACKGROUNDED_LINE.exec(plain(output))?.[1]?.toLowerCase();
}

/** Runs the program with an argument array (no shell). The exit of the process ends the call: a supervisor it started may keep the pipes open. */
function runProgram(options: BgCommandOptions, args: readonly string[], timeoutMs: number, cwd?: string): Promise<CommandRun> {
  return new Promise((resolve, reject) => {
    const command = options.command ?? 'claude';
    const child = spawn(command, [...(options.commandArgs ?? []), ...args], { ...(cwd === undefined ? {} : { cwd }), env: options.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= MAX_OUTPUT_BYTES) {
        stdout += chunk.toString('utf8');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(0, 100_000);
    });
    const finish = (code: number | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      // Output that is still in the pipes when the process is gone is read within a short grace, then the pipes are let go.
      setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        resolve({ code, stdout, stderr, timedOut, stdoutBytes });
      }, EXIT_DRAIN_MS);
    };
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error.code === 'ENOENT') {
        reject(new LaunchError('claude-missing', `the program '${command}' was not found`, 'install Claude Code and put `claude` on the PATH of the process that runs the agent-manager daemon (check with: claude --version)'));
      } else {
        reject(new LaunchError('bg-spawn-failed', `'${command}' could not be started (${getErrorMessage(error)})`, 'check that `claude --version` works in a terminal with the same environment as the daemon'));
      }
    });
    child.on('exit', (code) => finish(code));
  });
}

export class BgLauncher {
  readonly #options: BgCommandOptions;
  readonly #launchTimeoutMs: number;
  readonly #commandTimeoutMs: number;
  readonly #listTimeoutMs: number;
  readonly #linkTimeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #clock: () => number;
  readonly #onWarning: (text: string) => void;

  constructor(options: BgLauncherOptions = {}) {
    this.#onWarning = options.onWarning ?? (() => undefined);
    this.#options = {
      ...(options.command === undefined ? {} : { command: options.command }),
      ...(options.commandArgs === undefined ? {} : { commandArgs: options.commandArgs }),
      ...(options.env === undefined ? {} : { env: options.env }),
    };
    this.#launchTimeoutMs = options.launchTimeoutMs ?? DEFAULT_BG_LAUNCH_TIMEOUT_MS;
    this.#commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_BG_COMMAND_TIMEOUT_MS;
    this.#listTimeoutMs = options.listTimeoutMs ?? DEFAULT_BG_LIST_TIMEOUT_MS;
    this.#linkTimeoutMs = options.linkTimeoutMs ?? DEFAULT_BG_LINK_TIMEOUT_MS;
    this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_BG_POLL_INTERVAL_MS;
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#clock = options.clock ?? Date.now;
  }

  /** Starts a background session and waits (bounded) until `claude agents --json` lists it with its session id. Throws a LaunchError (reason and fix). */
  async launch(request: BgLaunchRequest): Promise<BgLaunchResult> {
    const args = buildBgArgs(request);
    await this.#assertFolder(request.cwd);
    const startedAt = this.#clock();
    const run = await runProgram(this.#options, args, this.#launchTimeoutMs, request.cwd);
    const output = `${run.stdout}\n${run.stderr}`;
    if (run.timedOut) {
      throw new LaunchError('bg-launch-timeout', `claude --bg did not finish within ${this.#launchTimeoutMs} ms (${excerpt(output) || 'no output'}): a background session may have been started anyway`, 'look at `claude agents` for a session of this folder and stop it with `claude stop <id>` if it is not wanted, then retry');
    }
    if (run.code !== 0) {
      if (/workspace not trusted/i.test(output)) {
        throw new LaunchError('workspace-not-trusted', `Claude Code does not trust the folder ${request.cwd} (claude --bg refuses a folder whose trust dialog was never accepted)`, `run \`claude\` once in ${request.cwd}, accept the trust dialog, quit, then retry`);
      }
      throw new LaunchError('bg-launch-failed', `claude --bg failed (exit ${String(run.code)}): ${excerpt(output) || 'no output'}`, 'run the same command in a terminal (claude --bg) in that folder to see the full message, then retry');
    }
    const jobId = parseBackgroundedId(output);
    if (jobId === undefined) {
      throw new LaunchError('bg-bad-answer', `claude --bg exited 0 but printed no "backgrounded <id>" line (${excerpt(output) || 'no output'}): a session may have been started`, 'look at `claude agents`, stop what you do not want with `claude stop <id>`; report this if the format changed (tested with Claude Code 2.1.330)');
    }
    const agent = await this.#waitForAgent(jobId, startedAt);
    return { jobId, agent, linkedAfterMs: this.#clock() - startedAt };
  }

  /** The background sessions `claude agents --json --all` lists (completed ones included: the manager follows a session until it removes it). */
  async list(): Promise<BgAgent[]> {
    const run = await runProgram(this.#options, ['agents', '--json', '--all'], this.#listTimeoutMs);
    if (run.timedOut) {
      throw new LaunchError('bg-list-timeout', `claude agents --json did not answer within ${this.#listTimeoutMs} ms`, 'run `claude daemon status`; if the supervisor does not answer, `claude daemon stop --any --keep-workers` then `claude agents` restarts it without stopping the sessions (documented)');
    }
    if (run.code !== 0) {
      throw new LaunchError('bg-list-failed', `claude agents --json failed (exit ${String(run.code)}): ${excerpt(run.stderr || run.stdout) || 'no output'}`, 'run `claude agents --json` in a terminal to see the message');
    }
    if (run.stdoutBytes > MAX_OUTPUT_BYTES) {
      throw new LaunchError('bg-output-too-large', `claude agents --json printed ${run.stdoutBytes} bytes, more than the ${MAX_OUTPUT_BYTES} this reader accepts: the list is not read, because a cut JSON would be misleading`, 'remove sessions you do not need (claude rm <id>, or claude agents in a terminal), then retry; report it if the list is not that long');
    }
    const report = parseAgentsReport(run.stdout);
    if (report.skipped.length > 0) {
      this.#onWarning(`claude agents --json: ${report.skipped.length} entr${report.skipped.length === 1 ? 'y was' : 'ies were'} skipped, the others are used (first: ${report.skipped[0] ?? ''})`);
    }
    return report.agents;
  }

  /** `claude stop <id>`: the supervisor stops the process, the conversation is kept. */
  async stop(jobId: string): Promise<void> {
    await this.#simple('stop', jobId);
  }

  /** `claude respawn <id>`: restarts a running or stopped session with its conversation (documented). */
  async respawn(jobId: string): Promise<void> {
    await this.#simple('respawn', jobId);
  }

  /** `claude rm <id>`: removes the session from the supervisor list (the transcript stays). A refusal (worktree) is reported with the CLI message. */
  async remove(jobId: string): Promise<void> {
    await this.#simple('rm', jobId);
  }

  async #simple(verb: 'stop' | 'respawn' | 'rm', jobId: string): Promise<void> {
    assertBgId(jobId);
    const run = await runProgram(this.#options, [verb, jobId], this.#commandTimeoutMs);
    if (run.timedOut) {
      throw new LaunchError('bg-command-timeout', `claude ${verb} ${jobId} did not finish within ${this.#commandTimeoutMs} ms`, `check the state with \`claude agents\`, then retry or run \`claude ${verb} ${jobId}\` in a terminal`);
    }
    if (run.code !== 0) {
      throw new LaunchError('bg-command-failed', `claude ${verb} ${jobId} failed (exit ${String(run.code)}): ${excerpt(run.stderr || run.stdout) || 'no output'}`, `run \`claude ${verb} ${jobId}\` in a terminal to see the full message (a worktree refusal of rm explains its own retry command)`);
    }
  }

  async #assertFolder(cwd: string): Promise<void> {
    if (!isAbsolute(cwd)) {
      throw new LaunchError('cwd-not-absolute', `the working directory ${JSON.stringify(cwd)} is not an absolute path`, 'pass the absolute path of the project folder');
    }
    try {
      if (!(await stat(cwd)).isDirectory()) {
        throw new LaunchError('cwd-not-a-folder', `the working directory ${cwd} is not a folder`, 'pass the path of an existing project folder');
      }
    } catch (error) {
      if (error instanceof LaunchError) {
        throw error;
      }
      throw new LaunchError('cwd-missing', `the working directory ${cwd} cannot be used (${getErrorMessage(error)})`, 'create the folder or pass the path of an existing project folder');
    }
  }

  async #waitForAgent(jobId: string, startedAt: number): Promise<BgAgent & { sessionId: string }> {
    const note = `the background session ${jobId} was started and left running: see it with \`claude agents\`, stop it with \`claude stop ${jobId}\` when it is not wanted`;
    let lastFailure: LaunchError | undefined;
    for (;;) {
      try {
        const found = (await this.list()).find((agent) => agent.id === jobId);
        lastFailure = undefined;
        if (found?.sessionId !== undefined) {
          return { ...found, sessionId: found.sessionId };
        }
      } catch (error) {
        lastFailure = error instanceof LaunchError ? error : new LaunchError('bg-list-failed', getErrorMessage(error), 'retry the launch');
      }
      if (this.#clock() - startedAt >= this.#linkTimeoutMs) {
        if (lastFailure !== undefined) {
          throw new LaunchError(lastFailure.code, `${lastFailure.reason} (still failing at the end of the ${this.#linkTimeoutMs} ms wait for the session ${jobId})`, `${lastFailure.fix}; ${note}`);
        }
        throw new LaunchError('bg-session-not-listed', `the background session ${jobId} was started but \`claude agents --json\` did not list it with a session id within ${this.#linkTimeoutMs} ms`, note);
      }
      await this.#sleep(this.#pollIntervalMs);
    }
  }
}
