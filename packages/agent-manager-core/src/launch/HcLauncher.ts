import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { getErrorMessage } from '../errors.js';
import { ReplyError } from '../reply/errors.js';
import { asRecord, asText, createHcRunner, excerpt, failureOf, parseJson } from '../reply/hcRunner.js';
import type { HcRun, HcRunner, HcRunnerOptions } from '../reply/hcRunner.js';
import { readSessionRegistry } from '../readSessionRegistry.js';
import type { RegistryResult, Session } from '../session.js';
import { resolveSessionsDir } from '../sessionsDir.js';
import { LaunchError } from './errors.js';
import { assertModel, assertNewSessionId, assertPermissionMode, assertResumeId } from './streamJsonArgs.js';

/*
 * The X3 launcher: starts `claude` in a herdr-core terminal with `hc run --bg` (measured in research/session-launch-options.md round 3: hc run returns
 * in 36 ms, the registry entry appears and goes idle about 5.6 s later, the terminal outlives the manager). Nothing is owned: the terminal belongs to
 * herdr-core, replies go through the hc reply transport. THIS FILE NEVER PASSES --force.
 *
 * The session is linked to its terminal the way the hc transport does it: `foreground.pid` of `hc get` equals the registry pid of the session.
 * No match within the wait is an error, never a guess; the terminal is left running (it may show a trust dialog the user must answer).
 *
 * Environment: the claude inside the terminal inherits the environment of herdr-core, NOT of this process (measured: a Bedrock setup needs its `env`
 * in the project settings, else the terminal says "Not logged in").
 */

export const DEFAULT_RUN_TIMEOUT_MS = 30_000;
export const DEFAULT_QUERY_TIMEOUT_MS = 10_000;
export const DEFAULT_REGISTRY_TIMEOUT_MS = 60_000;
export const DEFAULT_POLL_INTERVAL_MS = 500;
/** hc names: 1-32 of a-z 0-9 - _ (`hc run --help`). */
const MAX_ARGUMENT_CHARS = 4096;
const HC_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export interface HcLauncherOptions extends HcRunnerOptions {
  /** The registry folder. Default: resolveSessionsDir(process.env). */
  sessionsDir?: string;
  runTimeoutMs?: number;
  queryTimeoutMs?: number;
  /** How long to wait for the registry entry of the new terminal. Claude Code needs about 6 s to start (measured). */
  registryTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Test seams. */
  readRegistry?: (dir: string) => Promise<RegistryResult>;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
}

export interface HcLaunchRequest {
  /** An existing absolute folder. It must be trusted by Claude Code already, else the terminal waits on the trust dialog and the launch times out. */
  cwd: string;
  /** The hc terminal name: 1-32 of a-z 0-9 - _ , unique among live terminals. */
  name: string;
  /** The arguments of claude (after the program name): `['--model', 'haiku', '--permission-mode', 'default']`. */
  args: readonly string[];
}

export interface HcLaunchResult {
  /** The hc terminal address (`t1z`), what the hc transport and `hc send` take. */
  address: string;
  name: string;
  cwd: string;
  /** The registry entry linked to the terminal (its pid is the foreground pid of the terminal). */
  session: Session;
  /** Milliseconds from the start of `hc run` to the registry match. */
  linkedAfterMs: number;
}

/**
 * The arguments of `hc run`, the one place that builds them. Options come first, then the program: `--no-parent --no-notify` because the manager is
 * not a terminal (no parent to notify). No --force, no --rm, no --outlive-parent.
 */
export function buildRunArgs(request: HcLaunchRequest): string[] {
  assertClaudeArgs(request.args);
  return ['run', '--json', '--bg', '--no-parent', '--no-notify', '--name', request.name, '--cwd', request.cwd, 'claude', ...request.args];
}

/** The flags of claude whose value is checked like the stream-json launcher checks it. */
const CHECKED_VALUES: Readonly<Record<string, (value: string) => void>> = {
  '--model': assertModel,
  '--permission-mode': assertPermissionMode,
  '--session-id': assertNewSessionId,
  '--resume': assertResumeId,
};

/**
 * The arguments of claude after the program name. Each one is a single-line text; the flags that take a value of a known shape get the same checks
 * as buildStreamJsonArgs (so a value cannot be a flag or a command); an exact `--force` or `-f` is refused (never forwarded to hc or claude).
 * hc has no documented `--` separator for `run` and tokens after the program pass through (measured with `--model`), so none is added.
 */
export function assertClaudeArgs(args: readonly string[]): void {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (typeof arg !== 'string' || /[\0\r\n]/.test(arg) || arg.length > MAX_ARGUMENT_CHARS) {
      throw new LaunchError('invalid-argument', `argument ${index} of claude is not a single-line text of at most ${MAX_ARGUMENT_CHARS} characters`, 'pass the claude arguments as an array of plain single-line strings');
    }
    if (arg === '--force' || arg === '-f') {
      throw new LaunchError('force-refused', `the argument ${arg} is refused`, 'agent-manager never passes --force; remove it from the arguments');
    }
    const equals = arg.indexOf('=');
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    const check = CHECKED_VALUES[flag];
    if (check !== undefined) {
      const value = equals === -1 ? args[index + 1] : arg.slice(equals + 1);
      if (value === undefined) {
        throw new LaunchError('invalid-argument', `${flag} has no value`, `give ${flag} a value, e.g. ${flag} ${flag === '--model' ? 'haiku' : flag === '--permission-mode' ? 'default' : '<id>'}`);
      }
      check(value);
    }
  }
}

function toLaunchError(error: unknown): unknown {
  return error instanceof ReplyError && !(error instanceof LaunchError) ? new LaunchError(error.code, error.reason, error.fix) : error;
}

export class HcLauncher {
  readonly #runner: HcRunner;
  readonly #sessionsDir: string;
  readonly #runTimeoutMs: number;
  readonly #queryTimeoutMs: number;
  readonly #registryTimeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #readRegistry: (dir: string) => Promise<RegistryResult>;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #clock: () => number;

  constructor(options: HcLauncherOptions = {}) {
    this.#runner = createHcRunner(options);
    this.#sessionsDir = options.sessionsDir ?? resolveSessionsDir(process.env);
    this.#runTimeoutMs = options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    this.#queryTimeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
    this.#registryTimeoutMs = options.registryTimeoutMs ?? DEFAULT_REGISTRY_TIMEOUT_MS;
    this.#pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.#readRegistry = options.readRegistry ?? ((dir) => readSessionRegistry(dir));
    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#clock = options.clock ?? Date.now;
  }

  /** Starts claude in a new hc terminal, then waits for its registry entry. Rejects with a LaunchError (reason and fix) at the first problem. */
  async launch(request: HcLaunchRequest): Promise<HcLaunchResult> {
    await this.#validate(request);
    const startedAt = this.#clock();
    const address = await this.#run(request);
    const session = await this.#waitForSession(address, request.name, startedAt);
    return { address, name: request.name, cwd: request.cwd, session, linkedAfterMs: this.#clock() - startedAt };
  }

  async #validate(request: HcLaunchRequest): Promise<void> {
    if (!HC_NAME.test(request.name)) {
      throw new LaunchError('invalid-terminal-name', `the terminal name ${JSON.stringify(request.name)} is not valid for hc`, 'use 1 to 32 characters of a-z, 0-9, "-" and "_", starting with a letter or digit');
    }
    if (!isAbsolute(request.cwd)) {
      throw new LaunchError('cwd-not-absolute', `the working directory ${JSON.stringify(request.cwd)} is not an absolute path`, 'pass the absolute path of the project folder (hc would resolve a relative one against the core, not against this process)');
    }
    try {
      if (!(await stat(request.cwd)).isDirectory()) {
        throw new LaunchError('cwd-not-a-folder', `the working directory ${request.cwd} is not a folder`, 'pass the path of an existing project folder');
      }
    } catch (error) {
      if (error instanceof LaunchError) {
        throw error;
      }
      throw new LaunchError('cwd-missing', `the working directory ${request.cwd} cannot be used (${getErrorMessage(error)})`, 'create the folder or pass the path of an existing project folder');
    }
    assertClaudeArgs(request.args);
  }

  async #hc(args: readonly string[], timeoutMs: number, what: string, timeoutFix?: string): Promise<HcRun> {
    try {
      return await this.#runner.run(args, timeoutMs, what, timeoutFix);
    } catch (error) {
      throw toLaunchError(error);
    }
  }

  async #run(request: HcLaunchRequest): Promise<string> {
    // hc may have created the terminal before it stopped answering: the fix says how to find it by the name given here and never leaves it unmentioned.
    const timeoutFix = `a terminal named ${request.name} may have been started anyway: look for it with hc ls, close it with hc kill ${request.name} (never --force), then retry`;
    const run = await this.#hc(buildRunArgs(request), this.#runTimeoutMs, 'run', timeoutFix);
    const failure = failureOf(run);
    if (run.code !== 0 || failure !== undefined) {
      const reason = failure === undefined ? `hc run failed (exit ${String(run.code)}): ${excerpt(run.stderr || run.stdout) || 'no output'}` : `hc run refused (${failure.kind}): ${failure.message}`;
      throw new LaunchError('hc-run-failed', reason, failure?.hint !== undefined && failure.hint !== '' ? failure.hint : 'check that herdr-core runs (hc server status) and that the name is not used by a live terminal (hc ls), then retry');
    }
    const address = asText(asRecord(parseJson(run.stdout.trim()))?.['address']);
    if (address === undefined || address === '') {
      throw new LaunchError('hc-bad-answer', `hc run exited 0 but printed no terminal address (${excerpt(run.stdout) || 'no output'}): a terminal may have been started`, `look at hc ls for the terminal named ${request.name}; report this: the hc output format changed (tested with hc 0.1.21)`);
    }
    return address;
  }

  async #foregroundPid(address: string): Promise<number | undefined> {
    const run = await this.#hc(['get', '--json', '--', address], this.#queryTimeoutMs, `get ${address}`);
    const failure = failureOf(run);
    if (run.code !== 0 || failure !== undefined) {
      if (failure?.kind === 'not_found') {
        throw new LaunchError('terminal-gone', `the terminal ${address} ended before claude registered`, `claude exited at start: start it by hand in a terminal of that folder (claude) to see why (trust dialog, login), then retry`);
      }
      throw new LaunchError('hc-query-failed', `hc get ${address} failed (exit ${String(run.code)}): ${excerpt(run.stderr || run.stdout) || 'no output'}`, 'check that herdr-core runs (hc server status), then look at the terminal with hc read');
    }
    const pid = asRecord(asRecord(parseJson(run.stdout.trim()))?.['foreground'])?.['pid'];
    return typeof pid === 'number' ? pid : undefined;
  }

  async #waitForSession(address: string, name: string, startedAt: number): Promise<Session> {
    const terminalNote = `the terminal ${address} (${name}) was started and left running: read it with hc read ${address}, close it with hc kill ${address} when it is not wanted`;
    // The last failure of a poll that did not settle the question (hc busy, registry being rewritten): kept, and reported at the deadline.
    let lastFailure: LaunchError | undefined;
    let pid: number | undefined;
    for (;;) {
      try {
        pid = await this.#foregroundPid(address);
        const registry = await this.#readRegistry(this.#sessionsDir);
        if (registry.ok) {
          const match = pid === undefined ? undefined : registry.sessions.find((session) => session.pid === pid && session.alive);
          if (match !== undefined) {
            return match;
          }
          lastFailure = undefined;
        } else {
          const { message: reason, hint } = registry.error;
          lastFailure = new LaunchError('registry-unreadable', reason, hint);
        }
      } catch (error) {
        if (error instanceof LaunchError && error.code === 'terminal-gone') {
          throw error;
        }
        lastFailure = error instanceof LaunchError ? error : new LaunchError('launch-poll-failed', `waiting for the session of ${address} failed (${getErrorMessage(error)})`, 'retry the launch');
      }
      if (this.#clock() - startedAt >= this.#registryTimeoutMs) {
        if (lastFailure !== undefined) {
          throw new LaunchError(lastFailure.code, `${lastFailure.reason} (still failing at the end of the ${this.#registryTimeoutMs} ms wait for the terminal ${address})`, `${lastFailure.fix}; ${terminalNote}`);
        }
        throw new LaunchError(
          'session-not-registered',
          `the terminal ${address} (${name}) started but no Claude Code session registered for it within ${this.#registryTimeoutMs} ms (foreground pid ${pid === undefined ? 'unknown' : String(pid)})`,
          `read what the terminal shows: hc read ${address} (a workspace trust dialog or a login prompt blocks claude: answer it, or trust the folder once with claude); the terminal was left running, close it with hc kill ${address} when it is not wanted`,
        );
      }
      await this.#sleep(this.#pollIntervalMs);
    }
  }
}
