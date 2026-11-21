import type { Session } from '../session.js';
import { ReplyError } from './errors.js';
import { DEFAULT_HC_COMMAND, asRecord, asText, childEnvironment, createHcRunner, excerpt, failureOf, parseJson } from './hcRunner.js';
import type { HcRun } from './hcRunner.js';
import { DEFAULT_QUERY_TIMEOUT_MS, DEFAULT_SNAPSHOT_TTL_MS, createHcTerminals } from './hcTerminals.js';
import type { Resolved, TerminalFacts } from './hcTerminals.js';
import type { ProbeCheck, ProbeResult, ReplyMessage, ReplyTransport, SendResult } from './types.js';

/*
 * The `hc` transport: types the reply into the terminal of the session with herdr-core's `hc send` (hc 0.1.21). Measured (research/reply-wrapper-and-user-origin.md):
 * the text arrives as a prompt typed by the user (transcript origin human, no wrapper), queued and absorbed mid-turn when the agent works, refused as
 * `blocked` when a dialog is open unless --force. THIS FILE NEVER PASSES --force: it would answer the dialog (the Enter hits the default "1. Yes").
 *
 * Mapping session -> terminal: the registry pid of the session equals `foreground.pid` of exactly one `hc get` (measured on 2 of 2 claude terminals).
 * No terminal, or two: unavailable, never a guess. Not implemented: matching through the process tree (a claude that is not the foreground program
 * of its terminal is reported unavailable), other machines (`machine/t7`).
 *
 * UNKNOWN / not confirmed: the size limit of `hc send` text, the way Claude Code collapses a long paste in the transcript, the draft wait (hc holds the
 * send up to `draft_wait` seconds while a person has an unfinished draft; that is why the send timeout is longer than that), macOS and Linux hosts.
 */

export const HC_TRANSPORT_ID = 'hc';
export { DEFAULT_HC_COMMAND, childEnvironment };
/** hc waits up to 60 s (config `draft_wait`) while a person has an unfinished draft, then about 3 s of quiet. */
export const DEFAULT_SEND_TIMEOUT_MS = 90_000;
export { DEFAULT_QUERY_TIMEOUT_MS, DEFAULT_SNAPSHOT_TTL_MS };
/** CreateProcess refuses a command line above 32767 characters; quotes and backslashes are escaped (counted conservatively). */
const WINDOWS_COMMAND_LINE_LIMIT = 30_000;
const POSIX_ARGUMENT_LIMIT_BYTES = 100_000;

export interface HcTransportOptions {
  /** Program to run. Default 'hc' (found on the PATH, started without a shell). */
  command?: string;
  /** Arguments put before the hc arguments (a test runs `node fake-hc.mjs`). */
  commandArgs?: readonly string[];
  /** The environment hc inherits, minus HC_TERMINAL_ID. Default: process.env at each call. */
  env?: () => NodeJS.ProcessEnv;
  sendTimeoutMs?: number;
  queryTimeoutMs?: number;
  snapshotTtlMs?: number;
  clock?: () => number;
  platform?: NodeJS.Platform;
}

/**
 * The arguments of `hc send`. The one place that builds them: there is no --force, no --wait and no --if (the registry status "done" matches neither
 * idle nor working, so --if would refuse a finished turn; the blocked check is done before, and hc repeats it). `--` ends the options so that a
 * text that starts with '-' stays text.
 */
export function buildSendArgs(address: string, text: string): string[] {
  const args = ['send', '--json', '--', address, text];
  if (args.some((arg, index) => index < 3 && arg.toLowerCase().includes('force'))) {
    throw new Error('the hc transport must never pass --force');
  }
  return args;
}

export function createHcTransport(options: HcTransportOptions = {}): ReplyTransport {
  const runner = createHcRunner({ ...(options.command === undefined ? {} : { command: options.command }), ...(options.commandArgs === undefined ? {} : { commandArgs: options.commandArgs }), ...(options.env === undefined ? {} : { env: options.env }) });
  const command = runner.command;
  const sendTimeoutMs = options.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
  const queryTimeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const snapshotTtlMs = options.snapshotTtlMs ?? DEFAULT_SNAPSHOT_TTL_MS;
  const clock = options.clock ?? Date.now;
  const platform = options.platform ?? process.platform;

  const { resolveTerminal, freshTerminal } = createHcTerminals({ runner, queryTimeoutMs, snapshotTtlMs, clock });

  /** Starts hc through the shared runner (no shell); the timeout of a send says that the text may have been typed. */
  function runHc(args: readonly string[], timeoutMs: number, what: string): Promise<HcRun> {
    return runner.run(args, timeoutMs, what, what === 'send' ? 'the text may or may not have been typed: look at the terminal and the transcript before sending it again; a person with an unfinished draft in the terminal delays the send (hc setting draft_wait)' : undefined);
  }

  function blockedFailure(terminal: TerminalFacts): ReplyError {
    const what = terminal.statusKind === undefined ? 'a dialog' : `a ${terminal.statusKind} dialog`;
    return new ReplyError(
      'terminal-blocked',
      `the terminal ${terminal.address} is blocked on ${what}: typing would answer it`,
      'answer the dialog in its terminal first (or use Approve / Deny); agent-manager never forces typing into a dialog',
    );
  }

  async function probe(session: Session): Promise<ProbeResult> {
    const checks: ProbeCheck[] = [];
    const warnings: string[] = [];
    const details: Record<string, unknown> = { checks, warnings };
    const unavailable = (code: string, name: string, reason: string, fix: string): ProbeResult => {
      checks.push({ name, ok: false, detail: reason });
      details['code'] = code;
      return { available: false, reason, fix, details };
    };
    let resolved: Resolved;
    try {
      resolved = await resolveTerminal(session, false);
    } catch (error) {
      if (error instanceof ReplyError) {
        return unavailable(error.code, error.code === 'hc-missing' ? 'hc-present' : 'herdr-core-reachable', error.reason, error.fix);
      }
      throw error;
    }
    checks.push({ name: 'hc-present', ok: true, detail: `${command} answered` });
    checks.push({ name: 'herdr-core-reachable', ok: true, detail: `${resolved.examined} Claude Code terminal(s) listed` });
    if (!resolved.ok) {
      return unavailable(resolved.code, 'terminal-match', resolved.reason, resolved.fix);
    }
    const { terminal } = resolved;
    details['terminal'] = terminal.address;
    checks.push({ name: 'terminal-match', ok: true, detail: `${terminal.address} runs pid ${session.pid}` });
    if (terminal.statusState === 'blocked') {
      const failure = blockedFailure(terminal);
      return unavailable(failure.code, 'not-blocked', failure.reason, failure.fix);
    }
    if (terminal.statusState === undefined) {
      warnings.push(`the terminal ${terminal.address} reports no status: a dialog cannot be ruled out before typing (hc itself still refuses a blocked program)`);
    }
    checks.push({ name: 'not-blocked', ok: true, detail: `status ${terminal.statusState ?? 'not reported'}` });
    return { available: true, reason: `the session runs in the herdr-core terminal ${terminal.address}; replies are typed there as the user`, fix: '', details };
  }

  function assertSendable(text: string): void {
    if (text.includes('\0')) {
      throw new ReplyError('invalid-text', 'the reply contains a NUL character, which cannot be typed into a terminal', 'remove the NUL character');
    }
    if (platform === 'win32') {
      // Each quote and backslash may be escaped when the command line is built: counted twice, conservatively.
      const cost = text.length + (text.match(/["\\]/g)?.length ?? 0);
      if (cost > WINDOWS_COMMAND_LINE_LIMIT) {
        throw new ReplyError('text-too-long-for-hc', `the reply is too long for the command line of hc on Windows (about ${cost} of ${WINDOWS_COMMAND_LINE_LIMIT} characters, hc send takes the text as an argument)`, 'shorten the reply, save the text in a file in the project and send its path, or select the socket transport');
      }
    } else if (Buffer.byteLength(text) > POSIX_ARGUMENT_LIMIT_BYTES) {
      throw new ReplyError('text-too-long-for-hc', `the reply is larger than ${POSIX_ARGUMENT_LIMIT_BYTES} bytes, too long for the argument of hc send`, 'shorten the reply, or select the socket transport');
    }
  }

  async function send(session: Session, message: ReplyMessage): Promise<SendResult> {
    assertSendable(message.text);
    // The terminal is read again now: it may have ended, changed owner or opened a dialog since the probe.
    const terminal = await freshTerminal(session);
    if (terminal.statusState === 'blocked') {
      throw blockedFailure(terminal);
    }
    const run = await runHc(buildSendArgs(terminal.address, message.text), sendTimeoutMs, 'send');
    const failure = failureOf(run);
    if (run.code !== 0 || failure !== undefined) {
      if (failure?.kind === 'blocked') {
        throw new ReplyError('terminal-blocked', `hc refused: ${failure.message}`, `answer the dialog in its terminal first (${failure.hint === '' ? 'read its screen with hc read' : failure.hint}); agent-manager never forces typing into a dialog`);
      }
      if (failure?.kind === 'not_found') {
        throw new ReplyError('terminal-gone', `hc refused: ${failure.message}`, 'the terminal ended; refresh the session list');
      }
      const reason = failure === undefined ? `hc send failed (exit ${String(run.code)}): ${excerpt(run.stderr || run.stdout) || 'no output'}` : `hc send refused (${failure.kind}): ${failure.message}`;
      throw new ReplyError('hc-send-failed', reason, failure?.hint !== undefined && failure.hint !== '' ? failure.hint : 'read the terminal (hc read), then retry or select the socket transport');
    }
    const result = asRecord(parseJson(run.stdout.trim()));
    if (result === undefined) {
      // Exit 0: hc accepted the call, but its answer is not the documented shape.
      throw new ReplyError('hc-bad-answer', `hc send exited 0 but did not print its JSON result (${excerpt(run.stdout) || 'no output'}): the text may have been typed`, 'look at the terminal and the transcript before sending it again; report this: the hc output format changed (tested with hc 0.1.21)');
    }
    const turn = result['turn'];
    const started = result['started'];
    const status = asText(result['status']);
    const handle = typeof turn === 'number' ? `${terminal.address}#turn${turn}` : undefined;
    const startedNote = started === false ? '; the program did not go working within a few seconds (it may be queued behind a running turn, or have ignored the text)' : '';
    return {
      accepted: true,
      detail: `typed into ${terminal.address} by hc send (status ${status ?? 'not reported'}${typeof turn === 'number' ? `, turn ${turn}` : ''})${startedNote}; delivery is confirmed when the transcript shows a user line (origin human) with the text`,
      sentAt: clock(),
      ...(typeof started === 'boolean' ? { started } : {}),
      ...(handle === undefined ? {} : { handle }),
    };
  }

  return {
    id: HC_TRANSPORT_ID,
    kind: 'direct',
    deliveredAs: 'typed',
    describe: () => "herdr-core terminal typing (`hc send`): only for sessions started in a herdr-core terminal (hc cannot adopt a terminal it did not create); the reply is typed there as the user, queued while the agent works, refused while a dialog is open",
    probe,
    send,
  };
}

/** The hc transport with default settings (hc on the PATH, the environment of this process). */
export const hcTransport: ReplyTransport = createHcTransport();
