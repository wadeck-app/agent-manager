import { ReplyError } from '../reply/errors.js';
import { asRecord, asText, createHcRunner, excerpt, failureOf, parseJson } from '../reply/hcRunner.js';
import type { HcRun, HcRunner, HcRunnerOptions } from '../reply/hcRunner.js';
import { LaunchError } from './errors.js';

/*
 * What the host switch (#71) needs of herdr-core besides launching: read one terminal, type keys into it, end it, remove it once finished. One `hc` call each,
 * an argument array (never a shell), the address after `--` so that it can never be read as an option. THIS FILE NEVER PASSES --force (`hc kill` has none, and
 * `hc send --force` is the one that would answer a dialog by accident). Measured on hc 0.1.21 (research/adopt-host-switch.md a10, a11, a15): `hc keys <t> ctrl+c
 * ctrl+c` on an idle prompt ends claude cleanly (exit 0, registry file removed); `hc kill` works but leaves the registry file and orphans the tool children;
 * `hc rm` refuses a live terminal.
 */

export const DEFAULT_CONTROL_TIMEOUT_MS = 15_000;
/** `t7`, a name (a-z 0-9 - _), or `machine/t7`: never an option (no leading dash). */
const ADDRESS = /^[A-Za-z0-9][A-Za-z0-9_./-]{0,63}$/;

export interface HcTerminalInfo {
  address: string;
  /** `hc get` says the terminal ended (`finished_ms` is set): nothing runs in it any more. */
  finished: boolean;
  /** `foreground.pid`: the claude pid of a Claude Code terminal. */
  foregroundPid?: number;
  /** `status.state`: idle, working, done, blocked, error. */
  state?: string;
  /** `status.kind` of a blocked terminal: permission, question, auth. */
  kind?: string;
  exitCode?: number | null;
  reason?: string | null;
}

export interface HcControlLike {
  /** The terminal, or undefined when hc does not know it (removed, or never existed). Throws a LaunchError when hc cannot answer. */
  get(address: string): Promise<HcTerminalInfo | undefined>;
  /** The text of the screen (what a person sees now), to look at the prompt before typing keys. Throws a LaunchError when hc cannot give it. */
  screen(address: string): Promise<string>;
  keys(address: string, keys: readonly string[]): Promise<void>;
  kill(address: string): Promise<void>;
  /** Removes a FINISHED terminal (hc refuses a live one). */
  remove(address: string): Promise<void>;
}

export interface HcControlOptions extends HcRunnerOptions {
  timeoutMs?: number;
}

export function buildKeysArgs(address: string, keys: readonly string[]): string[] {
  return ['keys', '--json', '--', address, ...keys];
}

function assertAddress(address: string): void {
  if (!ADDRESS.test(address)) {
    throw new LaunchError('invalid-terminal-address', `${JSON.stringify(address)} is not a herdr-core terminal address`, 'pass the address as hc ls shows it (t7)');
  }
}

const RULE = /^\s*\u2500{5,}\s*$/;
const PROMPT = /^\s*[\u276F>]\s?(.*)$/;

/**
 * What is typed in the prompt box of Claude Code (the last prompt line directly under a horizontal rule; the same mark in the history above is a past message).
 * `found: false` when the screen has no prompt box (a dialog, another layout): the caller must not read that as "empty". Measured on Claude Code 2.1.325 (hc read).
 * A placeholder suggestion shown in an empty box cannot be told from a draft in plain text: it reads as a draft (the safe direction: the switch asks for force).
 */
export function promptDraft(screen: string): { found: true; draft: string } | { found: false } {
  const lines = screen.split('\n');
  for (let index = lines.length - 1; index > 0; index--) {
    const match = PROMPT.exec(lines[index] ?? '');
    if (match !== null && RULE.test(lines[index - 1] ?? '')) {
      return { found: true, draft: (match[1] ?? '').trim() };
    }
  }
  return { found: false };
}

export class HcControl implements HcControlLike {
  readonly #runner: HcRunner;
  readonly #timeoutMs: number;

  constructor(options: HcControlOptions = {}) {
    this.#runner = createHcRunner(options);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_CONTROL_TIMEOUT_MS;
  }

  async #hc(args: readonly string[], what: string): Promise<HcRun> {
    try {
      return await this.#runner.run(args, this.#timeoutMs, what);
    } catch (error) {
      throw error instanceof ReplyError && !(error instanceof LaunchError) ? new LaunchError(error.code, error.reason, error.fix) : error;
    }
  }

  async #ok(args: readonly string[], what: string): Promise<HcRun> {
    const run = await this.#hc(args, what);
    const failure = failureOf(run);
    if (run.code !== 0 || failure !== undefined) {
      const reason = failure === undefined ? `hc ${what} failed (exit ${String(run.code)}): ${excerpt(run.stderr || run.stdout) || 'no output'}` : `hc ${what} refused (${failure.kind}): ${failure.message}`;
      throw new LaunchError('hc-control-failed', reason, failure?.hint !== undefined && failure.hint !== '' ? `${failure.hint}; check that herdr-core runs (hc server status)` : 'check that herdr-core runs (hc server status) and look at the terminal with hc ls --all, then retry');
    }
    return run;
  }

  async get(address: string): Promise<HcTerminalInfo | undefined> {
    assertAddress(address);
    const run = await this.#hc(['get', '--json', '--', address], `get ${address}`);
    const failure = failureOf(run);
    if (failure?.kind === 'not_found') {
      return undefined;
    }
    if (run.code !== 0 || failure !== undefined) {
      throw new LaunchError('hc-control-failed', `hc get ${address} failed (exit ${String(run.code)}): ${excerpt(run.stderr || run.stdout) || 'no output'}`, 'check that herdr-core runs (hc server status), then retry');
    }
    const record = asRecord(parseJson(run.stdout.trim()));
    if (record === undefined) {
      throw new LaunchError('hc-bad-answer', `hc get ${address} did not print a JSON object (${excerpt(run.stdout) || 'no output'})`, 'report this: the hc output format changed (tested with hc 0.1.21)');
    }
    const pid = asRecord(record['foreground'])?.['pid'];
    const status = asRecord(record['status']);
    const exitCode = record['exit_code'];
    const reason = record['reason'];
    return {
      address,
      finished: record['finished_ms'] !== null && record['finished_ms'] !== undefined,
      ...(typeof pid === 'number' ? { foregroundPid: pid } : {}),
      ...(asText(status?.['state']) === undefined ? {} : { state: asText(status?.['state']) }),
      ...(asText(status?.['kind']) === undefined ? {} : { kind: asText(status?.['kind']) }),
      ...(typeof exitCode === 'number' || exitCode === null ? { exitCode } : {}),
      ...(typeof reason === 'string' || reason === null ? { reason } : {}),
    };
  }

  async screen(address: string): Promise<string> {
    assertAddress(address);
    const run = await this.#ok(['read', '--json', '--', address], `read ${address}`);
    const text = asRecord(parseJson(run.stdout.trim()))?.['text'];
    if (typeof text !== 'string') {
      throw new LaunchError('hc-bad-answer', `hc read ${address} did not print a JSON object with a text (${excerpt(run.stdout) || 'no output'})`, 'report this: the hc output format changed (tested with hc 0.1.21)');
    }
    return text;
  }

  async keys(address: string, keys: readonly string[]): Promise<void> {
    assertAddress(address);
    await this.#ok(buildKeysArgs(address, keys), `keys ${address}`);
  }

  async kill(address: string): Promise<void> {
    assertAddress(address);
    await this.#ok(['kill', '--json', '--', address], `kill ${address}`);
  }

  async remove(address: string): Promise<void> {
    assertAddress(address);
    await this.#ok(['rm', '--json', '--', address], `rm ${address}`);
  }
}
