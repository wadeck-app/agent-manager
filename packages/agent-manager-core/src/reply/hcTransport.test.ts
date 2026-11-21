import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSession } from '../parseSession.js';
import type { Session } from '../session.js';
import { registryEntry } from '../testFixtures.js';
import { ReplyError } from './errors.js';
import { buildSendArgs, childEnvironment, createHcTransport } from './hcTransport.js';
import type { HcTransportOptions } from './hcTransport.js';

/*
 * Fakes only: the transport runs `node fakeHc.mjs`, never the real hc, so nothing here can type into a real terminal.
 * (A node script cannot be put on the PATH as `hc` on Windows without a shell wrapper: the transport takes `command` + `commandArgs` instead.)
 */

const FAKE_HC = fileURLToPath(new URL('./fakeHc.mjs', import.meta.url));
const SESSION_PID = 4242;
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

const claude = (address: string) => ({ address, agent: 'claude-code', state: 'live', status: 'idle', turn: 3 });
const terminal = (pid: number, state: string | null, kind?: string) => ({ foreground: { pid, name: 'claude.exe' }, status: state === null ? null : { app: 'claude-code', state, ...(kind === undefined ? {} : { kind }) } });

interface Scenario {
  ls?: unknown;
  get?: Record<string, unknown>;
  send?: { exit?: number; stdout: unknown; delayMs?: number };
}

const BASE: Scenario = { ls: { terminals: [{ address: 't1', agent: 'powershell.exe', state: 'live' }, claude('t2'), claude('t3')] }, get: { t2: terminal(SESSION_PID, 'idle'), t3: terminal(9999, 'working') } };

interface Call {
  argv: string[];
  hasCallerId: boolean;
}

function setup(scenario: Scenario = BASE, options: HcTransportOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-manager-fakehc-'));
  dirs.push(dir);
  const scenarioFile = join(dir, 'scenario.json');
  const logFile = join(dir, 'calls.ndjson');
  writeFileSync(scenarioFile, JSON.stringify(scenario));
  writeFileSync(logFile, '');
  const transport = createHcTransport({
    command: process.execPath,
    commandArgs: [FAKE_HC],
    // The caller id is set on purpose: the transport must remove it from the child.
    env: () => ({ ...process.env, FAKE_HC_SCENARIO: scenarioFile, FAKE_HC_LOG: logFile, HC_TERMINAL_ID: 't77' }),
    queryTimeoutMs: 20_000,
    sendTimeoutMs: 20_000,
    ...options,
  });
  const calls = (): Call[] =>
    readFileSync(logFile, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Call);
  return { transport, calls };
}

function session(pid = SESSION_PID, sessionId = 'sess-1'): Session {
  return parseSession(`${pid}.json`, registryEntry(pid, { sessionId }), { now: 2_000_000, isAlive: () => true });
}

const message = (text = '[web reply via agent-manager #m1]\nhello') => ({ id: 'm1', text, imagePaths: [], priority: 'next' as const, origin: 'web' });
const sends = (calls: Call[]): Call[] => calls.filter((call) => call.argv[0] === 'send');

async function failureOf(promise: Promise<unknown>): Promise<ReplyError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ReplyError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a ReplyError, the call succeeded');
}

describe('buildSendArgs and childEnvironment', () => {
  it('never contains --force, --wait or --if, and ends the options before the text', () => {
    const args = buildSendArgs('t2', '--force');
    expect(args).toEqual(['send', '--json', '--', 't2', '--force']);
    expect(args.slice(0, 3).join(' ')).not.toMatch(/force|wait|--if/);
  });
  it('removes HC_TERMINAL_ID whatever its case and keeps the rest', () => {
    const env = childEnvironment({ HC_TERMINAL_ID: 't1', hc_terminal_id: 't2', HC_SESSION: 's', PATH: 'x' });
    expect(Object.keys(env).sort()).toEqual(['HC_SESSION', 'PATH']);
  });
});

describe('probe cost', () => {
  it('lists the terminals once for probes within the snapshot window (15 s by default), and again once it has passed', async () => {
    let now = 1_000;
    const { transport, calls } = setup(BASE, { clock: () => now });
    await transport.probe(session());
    const afterFirst = calls().length;
    expect(calls().filter((call) => call.argv[0] === 'ls')).toHaveLength(1);
    // Concurrent and later probes inside the window spawn nothing.
    await Promise.all([transport.probe(session()), transport.probe(session())]);
    now += 14_000;
    await transport.probe(session());
    expect(calls()).toHaveLength(afterFirst);
    now += 2_000;
    await transport.probe(session());
    expect(calls().filter((call) => call.argv[0] === 'ls')).toHaveLength(2);
  });
});

describe('probe', () => {
  it('maps the session to the one terminal whose foreground pid is its pid, with read-only calls', async () => {
    const { transport, calls } = setup();
    const result = await transport.probe(session());
    expect(result.available).toBe(true);
    expect(result.details['terminal']).toBe('t2');
    // Only the Claude Code terminals are asked.
    expect(calls().map((call) => `${call.argv[0]} ${call.argv.at(-1)}`).sort()).toEqual(['get t2', 'get t3', 'ls --json']);
  });

  it('is unavailable with the reason when no terminal runs the session', async () => {
    const { transport } = setup();
    const result = await transport.probe(session(1234));
    expect(result.available).toBe(false);
    expect(result.details['code']).toBe('no-terminal');
    expect(result.reason).toContain('pid 1234');
    expect(result.fix).toContain('hc run --bg claude');
    expect(result.reason).toContain('only drives terminals created by herdr-core');
  });

  it('is unavailable, never a guess, when two terminals report the pid', async () => {
    const { transport } = setup({ ls: BASE.ls, get: { t2: terminal(SESSION_PID, 'idle'), t3: terminal(SESSION_PID, 'idle') } });
    const result = await transport.probe(session());
    expect(result.available).toBe(false);
    expect(result.details['code']).toBe('ambiguous-terminal');
    expect(result.reason).toContain('t2, t3');
  });

  it('is unavailable while the terminal is blocked on a dialog, and says to answer it there', async () => {
    const { transport } = setup({ ...BASE, get: { t2: terminal(SESSION_PID, 'blocked', 'permission'), t3: terminal(9999, 'idle') } });
    const result = await transport.probe(session());
    expect(result.available).toBe(false);
    expect(result.details['code']).toBe('terminal-blocked');
    expect(result.reason).toContain('permission dialog');
    expect(result.fix).toContain('answer the dialog in its terminal first');
  });

  it('warns when the terminal reports no status', async () => {
    const { transport } = setup({ ...BASE, get: { t2: terminal(SESSION_PID, null), t3: terminal(9999, 'idle') } });
    const result = await transport.probe(session());
    expect(result.available).toBe(true);
    expect(result.details['warnings']).toHaveLength(1);
  });

  it('is unavailable with the install fix when hc is missing', async () => {
    const { transport } = setup(BASE, { command: join(tmpdir(), 'agent-manager-no-such-hc-program'), commandArgs: [] });
    const result = await transport.probe(session());
    expect(result.available).toBe(false);
    expect(result.details['code']).toBe('hc-missing');
    expect(result.fix).toContain('PATH');
  });

  it('is unavailable when herdr-core answers an error', async () => {
    const { transport } = setup({ ls: { error: { kind: 'unreachable', message: 'cannot reach herdr-core', hint: 'run hc server start' } } });
    const result = await transport.probe(session());
    expect(result.available).toBe(false);
    expect(result.reason).toContain('cannot reach herdr-core');
    expect(result.fix).toContain('run hc server start');
  });

  it('skips a terminal that ended between ls and get', async () => {
    const { transport } = setup({ ls: BASE.ls, get: { t2: terminal(SESSION_PID, 'idle') } });
    expect((await transport.probe(session())).available).toBe(true);
  });
});

describe('send', () => {
  it('types the text as one argument after `--`, with no --force, and without HC_TERMINAL_ID in the child', async () => {
    const { transport, calls } = setup();
    await transport.probe(session());
    const result = await transport.send(session(), message());
    expect(result.accepted).toBe(true);
    expect(result.handle).toBe('t2#turn7');
    expect(result.detail).toContain('turn 7');
    expect(sends(calls())).toHaveLength(1);
    expect(sends(calls())[0]!.argv).toEqual(['send', '--json', '--', 't2', '[web reply via agent-manager #m1]\nhello']);
    // The transport got HC_TERMINAL_ID in its environment: no child got it.
    expect(calls().some((call) => call.hasCallerId)).toBe(false);
    expect(calls().some((call) => call.argv.some((arg) => arg.includes('--force')))).toBe(false);
  });

  it('keeps a multi-line text with blank lines, quotes, backslashes and a leading dash exactly', async () => {
    const { transport, calls } = setup();
    const text = '-x "quoted" \\back\nline two\n\nline four with `ticks` and $VAR';
    await transport.send(session(), message(text));
    expect(sends(calls())[0]!.argv[4]).toBe(text);
  });

  it('works without a probe first (it lists the terminals itself)', async () => {
    const { transport } = setup();
    expect((await transport.send(session(), message())).accepted).toBe(true);
  });

  it('after a probe, re-reads only the matched terminal', async () => {
    const { transport, calls } = setup();
    await transport.probe(session());
    const before = calls().length;
    await transport.send(session(), message());
    expect(calls().slice(before).map((call) => `${call.argv[0]} ${call.argv.at(-1)}`.slice(0, 7))).toEqual(['get t2', 'send [w']);
  });

  it('refuses with the dialog hint, and does not call hc send, when the terminal is blocked right before', async () => {
    const { transport, calls } = setup({ ...BASE, get: { t2: terminal(SESSION_PID, 'blocked', 'permission'), t3: terminal(9999, 'idle') } });
    const error = await failureOf(transport.send(session(), message()));
    expect(error.code).toBe('terminal-blocked');
    expect(error.fix).toContain('answer the dialog in its terminal first');
    expect(sends(calls())).toHaveLength(0);
  });

  it('turns a refusal of hc itself (blocked after our check) into the same error', async () => {
    const send = { exit: 4, stdout: { error: { kind: 'blocked', message: 't2 is blocked (permission)', hint: 'typing would answer its dialog; read its screen first (hc read t2), or --force' } } };
    const { transport } = setup({ ...BASE, send });
    const error = await failureOf(transport.send(session(), message()));
    expect(error.code).toBe('terminal-blocked');
    expect(error.reason).toContain('t2 is blocked (permission)');
    expect(error.fix).toContain('answer the dialog in its terminal first');
  });

  it('fails with the hc message on another refusal', async () => {
    const { transport } = setup({ ...BASE, send: { exit: 1, stdout: { error: { kind: 'internal', message: 'pipe closed', hint: 'restart herdr-core' } } } });
    const error = await failureOf(transport.send(session(), message()));
    expect(error.code).toBe('hc-send-failed');
    expect(error.reason).toContain('pipe closed');
    expect(error.fix).toBe('restart herdr-core');
  });

  it('refuses on an ambiguous or missing terminal, without calling hc send', async () => {
    const ambiguous = setup({ ls: BASE.ls, get: { t2: terminal(SESSION_PID, 'idle'), t3: terminal(SESSION_PID, 'idle') } });
    expect((await failureOf(ambiguous.transport.send(session(), message()))).code).toBe('ambiguous-terminal');
    expect(sends(ambiguous.calls())).toHaveLength(0);
    const absent = setup();
    expect((await failureOf(absent.transport.send(session(1234), message()))).code).toBe('no-terminal');
    expect(sends(absent.calls())).toHaveLength(0);
  });

  it('reports hc missing', async () => {
    const { transport } = setup(BASE, { command: join(tmpdir(), 'agent-manager-no-such-hc-program'), commandArgs: [] });
    expect((await failureOf(transport.send(session(), message()))).code).toBe('hc-missing');
  });

  it('stops hc after the timeout and says the text may have been typed', async () => {
    const { transport } = setup({ ...BASE, send: { stdout: { turn: 1 }, delayMs: 30_000 } }, { sendTimeoutMs: 1500 });
    const error = await failureOf(transport.send(session(), message()));
    expect(error.code).toBe('hc-timeout');
    expect(error.fix).toContain('may or may not have been typed');
  });

  it('flags a success answer that is not JSON instead of reporting a clean send', async () => {
    const { transport } = setup({ ...BASE, send: { stdout: 'ok then' } });
    const error = await failureOf(transport.send(session(), message()));
    expect(error.code).toBe('hc-bad-answer');
    expect(error.reason).toContain('may have been typed');
  });

  it('notes in the detail when the program did not start working', async () => {
    const { transport } = setup({ ...BASE, send: { stdout: { started: false, status: 'done', turn: 9 } } });
    expect((await transport.send(session(), message())).detail).toContain('did not go working');
  });

  it('refuses a text too long for the Windows command line before starting hc', async () => {
    const { transport, calls } = setup(BASE, { platform: 'win32' });
    const error = await failureOf(transport.send(session(), message('x'.repeat(31_000))));
    expect(error.code).toBe('text-too-long-for-hc');
    expect(calls()).toHaveLength(0);
  });

  it('refuses a NUL character', async () => {
    const { transport } = setup();
    expect((await failureOf(transport.send(session(), message('a\0b')))).code).toBe('invalid-text');
  });
});
