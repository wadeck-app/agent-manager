import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { isPidAlive } from '../../pidAlive.js';
import type { Session } from '../../session.js';
import { removeDir } from '../../testFixtures.js';
import { assistantLine, humanPrompt, jsonl, textBlock, toolUseBlock } from '../../transcript/testFixtures.js';
import type { Obj } from '../../transcript/testFixtures.js';
import { LaunchError } from '../errors.js';
import type { HcControlLike, HcTerminalInfo } from '../HcControl.js';
import type { HcLaunchRequest, HcLaunchResult } from '../HcLauncher.js';
import { hostAuditFile } from './hostAudit.js';
import { SessionHost } from './SessionHost.js';
import type { SessionHostOptions } from './SessionHost.js';
import { ownedStatePath, readOwnedState } from './stateFile.js';
import type { HostEvent, OwnedSessionView } from './types.js';

/*
 * Mock tests of the host switch (#71 phase 2): the fake claude (a real child process) and a fake herdr-core (an in-memory world: terminals, the Claude Code
 * registry, the calls made). Nothing here talks to the real hc, the real claude or the real registry. The ONE real test is SessionHost.switch.integration.test.ts.
 */

const FAKE_CLAUDE = fileURLToPath(new URL('../testSupport/fakeClaude.mjs', import.meta.url));

const hosts: SessionHost[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) {
    await host.shutdown();
  }
  for (const dir of dirs.splice(0)) {
    removeDir(dir);
  }
});

interface World {
  /** The clock of the host and of its sleeps: a wait costs no real time. */
  now: number;
  registry: Session[];
  terminals: Map<string, HcTerminalInfo>;
  /** Every call made on the fake hc, in order: `run <args>`, `get t1`, `keys t1 ctrl+c ctrl+c`, `kill t1`, `rm t1`. */
  hcCalls: string[];
  bgAgents: { id: string; sessionId: string; state: string }[];
  transcript: Obj[];
  /** The transcript is located (false: a session with no message yet). */
  located: boolean;
  /** The file the transcript seam points at. */
  transcriptFile: string;
  /** How the fake hc reacts to the keys: 'exit' removes the registry file and finishes the terminal (a clean end), 'ignore' does nothing. */
  onKeys: 'exit' | 'ignore';
  /** Makes the next launch of the fake hc fail with this error. */
  launchError?: LaunchError;
  /** Holds the launch until the promise resolves. */
  launchGate?: Promise<void>;
  /** The session id the launched terminal registers (default: the one of --resume). */
  launchRegistersId?: string;
  trusted: boolean;
  /** The folder is covered only through a parent that is trusted (not verified to be honoured by Claude Code). */
  trustedViaParent?: string;
  /** The screen the fake hc shows for a terminal (default: an idle prompt box with nothing typed). */
  screen?: (address: string) => string;
  /** Runs when keys are typed (before they take effect). */
  onKeysHook?: () => void;
  /** The supervisor cannot be asked (claude agents fails). */
  bgError?: Error;
  bgListCalls: number;
  nextTerminal: number;
  nextPid: number;
}

function regSession(pid: number, sessionId: string, over: Partial<Session> = {}): Session {
  return { file: `${pid}.json`, pid, sessionId, cwd: '/work', folder: 'work', status: 'idle', statusGroup: 'idle', statusAgeMs: 60_000, alive: true, livenessCheck: 'pid-only', ...over };
}

const RULE_LINE = '\u2500'.repeat(40);
const screenWith = (typed: string): string => `${'\u276F'} an old message\n  an answer\n\n${RULE_LINE}\n${'\u276F'} ${typed}\n${RULE_LINE}\n  status line`;
const EMPTY_SCREEN = screenWith('');

const QUIET_TRANSCRIPT = (): Obj[] => [humanPrompt(1, 'hello'), assistantLine(2, 'm1', 0, textBlock('hi'))];

interface Fixture {
  host: SessionHost;
  world: World;
  cwd: string;
  configDir: string;
  claudeLog: string;
  events: () => HostEvent[];
  audit: () => { action: string; outcome: string; sessionId?: string; details: Record<string, unknown> }[];
  /** A live X1 session with a readable quiet transcript, and a clock far enough from its start for the status to be settled. */
  launched: () => Promise<OwnedSessionView>;
}

async function setup(options: Partial<SessionHostOptions> = {}, maxLive?: number): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'agent-manager-switch-'));
  dirs.push(root);
  const configDir = join(root, 'config');
  const cwd = join(root, 'project');
  mkdirSync(cwd, { recursive: true });
  const claudeLog = join(root, 'claude.ndjson');
  const world: World = { now: 1_000_000, registry: [], terminals: new Map(), hcCalls: [], bgAgents: [], transcript: QUIET_TRANSCRIPT(), located: true, transcriptFile: join(root, 'transcript.jsonl'), onKeys: 'exit', trusted: true, bgListCalls: 0, nextTerminal: 1, nextPid: 9000 };
  const writeTranscript = (): void => writeFileSync(world.transcriptFile, jsonl(world.transcript));
  writeTranscript();

  const control: HcControlLike = {
    get: (address) => {
      world.hcCalls.push(`get ${address}`);
      const info = world.terminals.get(address);
      return Promise.resolve(info === undefined ? undefined : { ...info });
    },
    screen: (address) => {
      world.hcCalls.push(`read ${address}`);
      return Promise.resolve(world.screen?.(address) ?? EMPTY_SCREEN);
    },
    keys: (address, keys) => {
      world.onKeysHook?.();
      world.hcCalls.push(`keys ${address} ${keys.join(' ')}`);
      const info = world.terminals.get(address);
      if (info !== undefined && world.onKeys === 'exit') {
        world.terminals.set(address, { ...info, finished: true, exitCode: 0, reason: 'exited' });
        world.registry = world.registry.filter((session) => session.pid !== info.foregroundPid);
      }
      return Promise.resolve();
    },
    kill: (address) => {
      world.hcCalls.push(`kill ${address}`);
      const info = world.terminals.get(address);
      if (info !== undefined) {
        world.terminals.set(address, { ...info, finished: true, exitCode: 1, reason: 'killed' });
        // The measured residue of a kill: the registry file stays, busy, not alive.
        world.registry = world.registry.map((session) => (session.pid === info.foregroundPid ? { ...session, alive: false, status: 'busy', statusGroup: 'busy' as const } : session));
      }
      return Promise.resolve();
    },
    remove: (address) => {
      world.hcCalls.push(`rm ${address}`);
      const info = world.terminals.get(address);
      if (info !== undefined && !info.finished) {
        return Promise.reject(new LaunchError('hc-control-failed', `terminal ${address} is live`, 'hc kill it first'));
      }
      world.terminals.delete(address);
      return Promise.resolve();
    },
  };

  const hcLauncher = {
    launch: async (request: HcLaunchRequest): Promise<HcLaunchResult> => {
      world.hcCalls.push(`run ${request.args.join(' ')}`);
      await world.launchGate;
      if (world.launchError !== undefined) {
        throw world.launchError;
      }
      const resumeIndex = request.args.indexOf('--resume');
      const id = world.launchRegistersId ?? (resumeIndex >= 0 ? (request.args[resumeIndex + 1] ?? '') : randomUUID());
      const address = `t${world.nextTerminal++}`;
      const pid = world.nextPid++;
      const session = regSession(pid, id, { cwd: request.cwd });
      world.registry.push(session);
      world.terminals.set(address, { address, finished: false, foregroundPid: pid, state: 'done' });
      return { address, name: request.name, cwd: request.cwd, session, linkedAfterMs: 5 };
    },
  };

  const host = new SessionHost({
    configDir,
    claude: { command: process.execPath, commandArgs: [FAKE_CLAUDE], env: { ...process.env, FAKE_CLAUDE_LOG: claudeLog } },
    closeTimeoutMs: 3000,
    hcLauncher,
    hcControl: control,
    bgLauncher: { launch: () => Promise.reject(new Error('no bg launch in these tests')), list: () => (world.bgListCalls++, world.bgError !== undefined ? Promise.reject(world.bgError) : Promise.resolve(world.bgAgents.map((agent) => ({ ...agent, cwd, kind: 'interactive' })))), stop: () => Promise.resolve(), respawn: () => Promise.resolve(), remove: () => Promise.resolve() },
    readRegistry: () => Promise.resolve({ ok: true as const, dir: '(test)', sessions: [...world.registry], unreadable: [] }),
    locateTranscript: () => Promise.resolve(world.located ? { ok: true as const, path: world.transcriptFile, projectDir: join(root, 'projects'), via: 'slug' as const } : { ok: false as const, error: { code: 'not-found' as const, message: 'no transcript', fix: 'send a message first', tried: [] } }),
    trustCheck: () => Promise.resolve(world.trusted ? { trusted: true as const } : world.trustedViaParent !== undefined ? { trusted: false as const, inherited: world.trustedViaParent, reason: `the folder ${cwd} is covered only by its trusted parent ${world.trustedViaParent}` } : { trusted: false as const, reason: `the folder ${cwd} is not trusted by Claude Code` }),
    clock: () => world.now,
    sleep: (ms) => {
      world.now += ms;
      return Promise.resolve();
    },
    ...(maxLive === undefined ? {} : { maxLiveSessions: maxLive }),
    ...options,
  });
  hosts.push(host);
  await host.init();
  const launched = async (): Promise<OwnedSessionView> => {
    const view = await host.launch({ hostKind: 'stream-json', cwd, model: 'haiku', permissionMode: 'default', name: 'switch me' });
    // A session that has not been idle for a few seconds is "still settling": the clock moves on.
    world.now += 60_000;
    return view;
  };
  return {
    host,
    world,
    cwd,
    configDir,
    claudeLog,
    events: () => host.events.replay(undefined).events,
    audit: () =>
      readFileSync(hostAuditFile(configDir, world.now), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { action: string; outcome: string; sessionId?: string; details: Record<string, unknown> }),
    launched,
  };
}

async function rejection(work: Promise<unknown>): Promise<LaunchError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof LaunchError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a LaunchError, the call succeeded');
}

/** The argv of each run of the fake claude (the first line of each run is its argv). The child writes it a moment after it started: waited for. */
async function claudeArgvs(log: string): Promise<string[][]> {
  for (let attempt = 0; attempt < 100 && !existsSync(log); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { argv?: string[] })
    .filter((entry) => entry.argv !== undefined)
    .map((entry) => entry.argv as string[]);
}

/** A live hc session in the fake world, as a switch from hc starts with: a record made through the host's own launch of hc. */
async function hcSession(f: Fixture): Promise<{ view: OwnedSessionView; address: string; pid: number }> {
  const view = await f.host.launch({ hostKind: 'hc', cwd: f.cwd, model: 'haiku', permissionMode: 'default', name: 'on hc' });
  const address = view.hcAddress ?? '';
  const info = f.world.terminals.get(address);
  f.world.now += 60_000;
  return { view, address, pid: info?.foregroundPid ?? 0 };
}

describe('switch X1 -> hc', () => {
  it('stops the X1 child, starts claude --resume of the SAME id in an hc terminal with model and mode, and updates the same record', async () => {
    const f = await setup();
    const before = await f.launched();
    expect(isPidAlive(before.pid ?? 0)).toBe(true);
    const result = await f.host.switchHost(before.id, 'hc');

    expect(result).toMatchObject({ from: 'stream-json', to: 'hc', forced: false, readiness: { state: 'free', reasons: [] } });
    expect(result.session).toMatchObject({ id: before.id, hostKind: 'hc', status: 'live', model: 'haiku', permissionMode: 'default', name: 'switch me' });
    expect(result.session.hcAddress).toMatch(/^t\d+$/);
    expect(result.session.pid).toBeUndefined();
    // The X1 process is gone before the target started.
    expect(isPidAlive(before.pid ?? 0)).toBe(false);
    expect(f.world.hcCalls).toEqual([`run --resume ${before.id} --model haiku --permission-mode default`]);
    // One record, same id, in the file and in the list.
    const records = await readOwnedState(ownedStatePath(f.configDir));
    expect(records.map((record) => record.id)).toEqual([before.id]);
    expect(records[0]).toMatchObject({ hostKind: 'hc', hcAddress: result.session.hcAddress });
    expect(records[0]?.switches).toEqual([{ at: expect.any(Number), from: 'stream-json', to: 'hc', forced: false }]);
    expect(f.host.list()).toHaveLength(1);
    expect(f.events().map((event) => event.type)).toContain('session.switched');
  });

  it('writes the audit lines of the stop, the resume and the switch (metadata only)', async () => {
    const f = await setup();
    const before = await f.launched();
    await f.host.switchHost(before.id, 'hc');
    const lines = f.audit().filter((line) => line.sessionId === before.id && line.action !== 'launch');
    expect(lines.map((line) => line.action)).toEqual(['stop', 'resume', 'switch']);
    expect(lines.every((line) => line.outcome === 'ok')).toBe(true);
    expect(lines[0]?.details).toMatchObject({ hostKind: 'stream-json', via: 'switch' });
    expect(lines[1]?.details).toMatchObject({ hostKind: 'hc', via: 'switch' });
    expect(lines[2]?.details).toMatchObject({ from: 'stream-json', to: 'hc', forced: false, readiness: 'free', reasons: 0 });
    expect(JSON.stringify(lines)).not.toContain('hello');
  });

  it('refuses when a tool is running (no force): nothing is stopped, nothing started, the reason names the tool', async () => {
    const f = await setup();
    const before = await f.launched();
    f.world.transcript = [humanPrompt(1, 'go'), assistantLine(2, 'm1', 0, toolUseBlock('t1', 'Bash', { command: 'node wait.mjs' }))];
    writeFileSync(f.world.transcriptFile, jsonl(f.world.transcript));
    const error = await rejection(f.host.switchHost(before.id, 'hc'));
    expect(error.code).toBe('switch-not-ready');
    expect(error.reason).toContain('node wait.mjs');
    expect(error.fix).toMatch(/force/);
    expect(isPidAlive(before.pid ?? 0)).toBe(true);
    expect(f.world.hcCalls).toEqual([]);
    expect(f.host.get(before.id)).toMatchObject({ hostKind: 'stream-json', state: 'idle' });
    // The refusal is audited too.
    expect(f.audit().find((line) => line.action === 'switch')).toMatchObject({ outcome: expect.stringContaining('failed: ') });
  });

  it('with force it goes on, says so, and records the forced flag and the reasons that were acknowledged', async () => {
    const f = await setup();
    const before = await f.launched();
    f.world.transcript = [humanPrompt(1, 'go'), assistantLine(2, 'm1', 0, toolUseBlock('t1', 'Bash', { command: 'node wait.mjs' }))];
    writeFileSync(f.world.transcriptFile, jsonl(f.world.transcript));
    const result = await f.host.switchHost(before.id, 'hc', { force: true });
    expect(result).toMatchObject({ forced: true, readiness: { state: 'busy' } });
    expect(result.readiness.reasons[0]).toContain('node wait.mjs');
    expect((await readOwnedState(ownedStatePath(f.configDir)))[0]?.switches?.[0]).toMatchObject({ forced: true });
    expect(f.audit().find((line) => line.action === 'switch')?.details).toMatchObject({ forced: true, readiness: 'busy', reasons: 1 });
  });

  it('an unreadable transcript is unknown, and unknown is refused like busy (never free)', async () => {
    const f = await setup();
    const before = await f.launched();
    f.world.transcriptFile = join(dirs[0] ?? '', 'does-not-exist.jsonl');
    const error = await rejection(f.host.switchHost(before.id, 'hc'));
    expect(error.code).toBe('switch-not-ready');
    expect(error.reason).toMatch(/Cannot tell/);
  });

  it('a session with no transcript cannot be resumed on another host: refused first, nothing stopped', async () => {
    const f = await setup();
    const before = await f.launched();
    f.world.located = false;
    const error = await rejection(f.host.switchHost(before.id, 'hc'));
    expect(error.code).toBe('switch-no-conversation');
    expect(error.fix).toContain('send a message first');
    expect(isPidAlive(before.pid ?? 0)).toBe(true);
  });

  it('refuses a folder Claude Code does not trust BEFORE stopping anything (the trust dialog would block the terminal)', async () => {
    const f = await setup();
    const before = await f.launched();
    f.world.trusted = false;
    const error = await rejection(f.host.switchHost(before.id, 'hc'));
    expect(error.code).toBe('switch-untrusted-folder');
    expect(error.reason).toContain('not trusted');
    expect(isPidAlive(before.pid ?? 0)).toBe(true);
    expect(f.world.hcCalls).toEqual([]);
  });

  it('refuses when another live process holds the id (registry), before stopping anything', async () => {
    const f = await setup();
    const before = await f.launched();
    // The registry entry of the Web session itself, plus another live claude on the same id.
    f.world.registry.push(regSession(before.pid ?? 1, before.id), regSession(7777, before.id));
    const error = await rejection(f.host.switchHost(before.id, 'hc'));
    expect(error.code).toBe('session-held');
    expect(error.reason).toContain('7777');
    expect(isPidAlive(before.pid ?? 0)).toBe(true);
  });

  it('refuses when the supervisor lists a background session of the id', async () => {
    const f = await setup();
    const before = await f.launched();
    f.world.bgAgents.push({ id: 'abc123', sessionId: before.id, state: 'working' });
    const error = await rejection(f.host.switchHost(before.id, 'hc'));
    expect(error.code).toBe('session-held');
    expect(error.reason).toContain('abc123');
  });

  it('a stale registry file of a dead pid (the residue of a kill) is ignored, and the note says it stays', async () => {
    const f = await setup();
    const before = await f.launched();
    f.world.registry.push(regSession(4242, before.id, { alive: false, status: 'busy', statusGroup: 'busy' }));
    const result = await f.host.switchHost(before.id, 'hc');
    expect(result.notes.join(' ')).toMatch(/4242/);
    expect(result.notes.join(' ')).toMatch(/stale|not removed|left/i);
    expect(f.world.registry.some((session) => session.pid === 4242)).toBe(true);
  });

  it('when the target cannot start after the stop, the error says which step failed, that the source is stopped, and the command to resume by hand', async () => {
    const f = await setup();
    const before = await f.launched();
    f.world.launchError = new LaunchError('hc-run-failed', 'hc run refused (busy)', 'check herdr-core');
    const error = await rejection(f.host.switchHost(before.id, 'hc'));
    expect(error.code).toBe('switch-target-failed');
    expect(error.reason).toContain(before.id);
    expect(error.reason).toMatch(/stopped/);
    expect(error.reason).toContain('hc run refused (busy)');
    expect(error.fix).toContain(`claude --resume ${before.id}`);
    // Never a silent fallback to the old host: the session is exited, resumable on its own host by the user's choice.
    expect(f.host.get(before.id)).toMatchObject({ hostKind: 'stream-json', status: 'exited', resumable: true });
    const failed = f.audit().find((line) => line.action === 'switch');
    expect(failed?.outcome).toMatch(/^failed: /);
    expect(failed?.details).toMatchObject({ steps: expect.stringContaining('stopped') });
  });

  it('a terminal that registered ANOTHER session id is refused and reported, never adopted', async () => {
    const f = await setup();
    const before = await f.launched();
    f.world.launchRegistersId = '99999999-9999-4999-8999-999999999999';
    const error = await rejection(f.host.switchHost(before.id, 'hc'));
    expect(error.code).toBe('switch-id-mismatch');
    expect(error.reason).toContain('99999999-9999-4999-8999-999999999999');
    expect(error.fix).toMatch(/hc kill t\d+/);
    expect(f.host.get(before.id)).toMatchObject({ hostKind: 'stream-json', status: 'exited' });
  });

  it('a second request for the same session while one runs fails with switch-in-progress', async () => {
    const f = await setup();
    const before = await f.launched();
    let open: () => void = () => undefined;
    f.world.launchGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const first = f.host.switchHost(before.id, 'hc');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const second = await rejection(f.host.switchHost(before.id, 'hc'));
    expect(second.code).toBe('switch-in-progress');
    // stop, resume and forget are refused as well while it runs.
    expect((await rejection(f.host.resume(before.id))).code).toBe('switch-in-progress');
    expect((await rejection(f.host.forget(before.id))).code).toBe('switch-in-progress');
    open();
    await first;
  });
});

describe('switch hc -> X1', () => {
  it('idle terminal: types ctrl+c ctrl+c, waits for the exit, removes the finished terminal, and resumes the same id as X1 with model and mode', async () => {
    const f = await setup();
    const { view, address } = await hcSession(f);
    const result = await f.host.switchHost(view.id, 'stream-json');
    expect(result).toMatchObject({ from: 'hc', to: 'stream-json', readiness: { state: 'free' } });
    expect(result.session).toMatchObject({ id: view.id, hostKind: 'stream-json', status: 'live', state: 'idle', model: 'haiku', permissionMode: 'default' });
    expect(result.session.hcAddress).toBeUndefined();
    expect(result.session.pid).toBeGreaterThan(0);
    const calls = f.world.hcCalls.filter((call) => !call.startsWith('get '));
    // The screen is read first (a draft would be lost), then the keys.
    expect(calls).toEqual([expect.stringMatching(/^run /), `read ${address}`, `keys ${address} ctrl+c ctrl+c`, `rm ${address}`]);
    expect(f.world.hcCalls.some((call) => call.startsWith('kill'))).toBe(false);
    const argv = (await claudeArgvs(f.claudeLog)).at(-1) ?? [];
    expect(argv).toEqual(expect.arrayContaining(['--resume', view.id, '--model', 'haiku', '--permission-mode', 'default']));
    expect((await readOwnedState(ownedStatePath(f.configDir))).map((record) => record.id)).toEqual([view.id]);
  });

  it('a busy terminal is refused without force, with the keys never typed', async () => {
    const f = await setup();
    const { view, address } = await hcSession(f);
    f.world.terminals.set(address, { ...(f.world.terminals.get(address) as HcTerminalInfo), state: 'working' });
    const error = await rejection(f.host.switchHost(view.id, 'stream-json'));
    expect(error.code).toBe('switch-not-ready');
    expect(f.world.hcCalls.some((call) => call.startsWith('keys') || call.startsWith('kill'))).toBe(false);
  });

  it('a busy terminal with force is killed (no keys), the stale registry file it leaves is reported and NOT deleted, then the finished terminal is removed', async () => {
    const f = await setup();
    const { view, address, pid } = await hcSession(f);
    f.world.terminals.set(address, { ...(f.world.terminals.get(address) as HcTerminalInfo), state: 'working' });
    const result = await f.host.switchHost(view.id, 'stream-json', { force: true });
    expect(result).toMatchObject({ forced: true, to: 'stream-json' });
    const calls = f.world.hcCalls.filter((call) => !call.startsWith('get ') && !call.startsWith('run '));
    expect(calls).toEqual([`kill ${address}`, `rm ${address}`]);
    expect(result.notes.join(' ')).toContain(String(pid));
    expect(f.world.registry.find((session) => session.pid === pid)).toMatchObject({ alive: false, status: 'busy' });
  });

  it('an idle terminal that does not exit after the keys is NOT killed without force: the error names the command', async () => {
    const f = await setup();
    const { view, address } = await hcSession(f);
    f.world.onKeys = 'ignore';
    const error = await rejection(f.host.switchHost(view.id, 'stream-json'));
    expect(error.code).toBe('switch-stop-timeout');
    expect(error.fix).toContain(`hc kill ${address}`);
    expect(f.world.hcCalls.some((call) => call.startsWith('kill'))).toBe(false);
    expect(f.host.get(view.id)).toMatchObject({ hostKind: 'hc', status: 'live' });
  });

  it('with force that same terminal is escalated to hc kill', async () => {
    const f = await setup();
    const { view, address } = await hcSession(f);
    f.world.onKeys = 'ignore';
    await f.host.switchHost(view.id, 'stream-json', { force: true });
    expect(f.world.hcCalls).toContain(`kill ${address}`);
  });

  it('a terminal that is already gone needs no stop: the session is resumed on the target and the note says so', async () => {
    const f = await setup();
    const { view, address } = await hcSession(f);
    f.world.terminals.delete(address);
    f.world.registry = [];
    const result = await f.host.switchHost(view.id, 'stream-json');
    expect(result.notes.join(' ')).toMatch(/already gone|no process to stop/i);
    expect(f.world.hcCalls.some((call) => call.startsWith('keys') || call.startsWith('kill'))).toBe(false);
    expect(result.session).toMatchObject({ id: view.id, hostKind: 'stream-json', status: 'live' });
  });

  it('refuses before touching the terminal when the live limit is reached', async () => {
    const f = await setup({}, 1);
    const { view } = await hcSession(f);
    const other = await f.host.launch({ hostKind: 'stream-json', cwd: f.cwd });
    expect(other.state).toBe('idle');
    const error = await rejection(f.host.switchHost(view.id, 'stream-json'));
    expect(error.code).toBe('too-many-sessions');
    expect(f.world.hcCalls.some((call) => call.startsWith('keys') || call.startsWith('kill'))).toBe(false);
  });
});

describe('X1 -> hc -> X1 -> hc: the same session through every hop', () => {
  it('keeps one id, one record, and a history entry per hop, with no process left on the old host', async () => {
    const f = await setup();
    const start = await f.launched();
    const toHc = await f.host.switchHost(start.id, 'hc');
    f.world.now += 60_000;
    const toX1 = await f.host.switchHost(start.id, 'stream-json');
    f.world.now += 60_000;
    const backToHc = await f.host.switchHost(start.id, 'hc');
    for (const view of [toHc.session, toX1.session, backToHc.session]) {
      expect(view.id).toBe(start.id);
    }
    expect(backToHc.session.hostKind).toBe('hc');
    expect((await readOwnedState(ownedStatePath(f.configDir))).map((record) => record.id)).toEqual([start.id]);
    expect(backToHc.session.switches?.map((entry) => `${entry.from}>${entry.to}`)).toEqual(['stream-json>hc', 'hc>stream-json', 'stream-json>hc']);
    expect(isPidAlive(start.pid ?? 0)).toBe(false);
    expect(isPidAlive(toX1.session.pid ?? 0)).toBe(false);
    // Every terminal that was left was removed except the live one.
    expect([...f.world.terminals.values()].filter((terminal) => terminal.finished)).toEqual([]);
  });
});

describe('refusals before anything runs', () => {
  it('the same host, a bg record and an unknown id', async () => {
    const f = await setup();
    const view = await f.launched();
    expect((await rejection(f.host.switchHost(view.id, 'stream-json'))).code).toBe('switch-same-host');
    expect((await rejection(f.host.switchHost('11111111-1111-4111-8111-111111111111', 'hc'))).code).toBe('unknown-session');
    expect((await rejection(f.host.switchHost(view.id, 'bg' as never))).code).toBe('switch-host-unsupported');
  });

  it('a host without hc control (no way to stop a terminal) refuses a switch FROM hc with the fix', async () => {
    const f = await setup({ hcControl: undefined });
    const { view } = await hcSession(f);
    const error = await rejection(f.host.switchHost(view.id, 'stream-json'));
    expect(error.code).toBe('hc-control-unavailable');
    expect(error.fix).toMatch(/hc kill/);
  });
});

describe('review fixes (#71): recovery after a failed switch', () => {
  it('a failed target start records WHY and WHERE TO in the record (switchFailure), in the list and in the file', async () => {
    const f = await setup();
    const before = await f.launched();
    f.world.launchError = new LaunchError('hc-run-failed', 'hc run refused (busy)', 'check herdr-core');
    await rejection(f.host.switchHost(before.id, 'hc'));
    const view = f.host.get(before.id);
    expect(view).toMatchObject({ hostKind: 'stream-json', status: 'exited', switchFailure: { target: 'hc', at: expect.any(Number) } });
    expect(view.switchFailure?.reason).toContain('hc run refused (busy)');
    expect((await readOwnedState(ownedStatePath(f.configDir)))[0]?.switchFailure).toMatchObject({ target: 'hc' });
  });

  it('the stopped record can be started on the target with the same route (source not running: nothing to stop, the holder check still runs), and the failure is cleared', async () => {
    const f = await setup();
    const before = await f.launched();
    f.world.launchError = new LaunchError('hc-run-failed', 'hc run refused (busy)', 'check herdr-core');
    await rejection(f.host.switchHost(before.id, 'hc'));
    f.world.launchError = undefined;
    const result = await f.host.switchHost(before.id, 'hc');
    expect(result.session).toMatchObject({ id: before.id, hostKind: 'hc', status: 'live' });
    expect(result.session.switchFailure).toBeUndefined();
    expect(result.notes.join(' ')).toMatch(/not running/);
    expect(f.world.hcCalls.filter((call) => call.startsWith('keys') || call.startsWith('kill'))).toEqual([]);
  });

  it('recovery refuses when another live process holds the id (nothing runs on our side, so any registry entry is a holder)', async () => {
    const f = await setup();
    const before = await f.launched();
    f.world.launchError = new LaunchError('hc-run-failed', 'hc run refused (busy)', 'check herdr-core');
    await rejection(f.host.switchHost(before.id, 'hc'));
    f.world.launchError = undefined;
    f.world.registry.push(regSession(7777, before.id));
    expect((await rejection(f.host.switchHost(before.id, 'hc'))).code).toBe('session-held');
  });

  it('an hc record whose X1 start failed is stopped, recorded, and can be switched again (not hidden behind same-host or not-live)', async () => {
    const f = await setup({ readVersion: () => Promise.resolve('9.9.9'), claude: { command: 'agent-manager-no-such-claude-binary' } });
    const { view } = await hcSession(f);
    const first = await rejection(f.host.switchHost(view.id, 'stream-json'));
    expect(first.code).toBe('switch-target-failed');
    expect(f.host.get(view.id)).toMatchObject({ hostKind: 'hc', status: 'exited', switchFailure: { target: 'stream-json' } });
    const again = await rejection(f.host.switchHost(view.id, 'stream-json'));
    expect(again.code).toBe('switch-target-failed');
    expect(f.world.hcCalls.filter((call) => call.startsWith('keys') || call.startsWith('kill'))).toHaveLength(1);
  });
});

describe('review fixes (#71): the other actions wait for a switch', () => {
  it('send, interrupt, permission mode and decision are refused with switch-in-progress and a hint while the id is being switched', async () => {
    const f = await setup();
    const before = await f.launched();
    let open: () => void = () => undefined;
    f.world.launchGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const first = f.host.switchHost(before.id, 'hc');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const refused = [
      await rejection(f.host.send(before.id, { text: 'hi', images: [] })),
      await rejection(f.host.interrupt(before.id)),
      await rejection(f.host.setPermissionMode(before.id, 'plan')),
      await rejection(f.host.decide(before.id, 'req-1', { decision: 'allow' })),
    ];
    expect(refused.map((error) => error.code)).toEqual(['switch-in-progress', 'switch-in-progress', 'switch-in-progress', 'switch-in-progress']);
    expect(refused.every((error) => error.fix !== '')).toBe(true);
    open();
    await first;
  });
});

describe('review fixes (#71): a shutdown during a switch', () => {
  it('does not start the target after the source was stopped, says so, and the shutdown waits for the switch', async () => {
    const f = await setup();
    const { view } = await hcSession(f);
    let shutdown: Promise<unknown> | undefined;
    f.world.onKeysHook = () => {
      shutdown = f.host.shutdown();
    };
    const error = await rejection(f.host.switchHost(view.id, 'stream-json'));
    expect(error.code).toBe('switch-host-stopping');
    expect(error.reason).toContain(view.id);
    expect(error.fix).toMatch(/agent-manager start/);
    await shutdown;
    expect(existsSync(f.claudeLog)).toBe(false);
    expect(f.host.get(view.id)).toMatchObject({ hostKind: 'hc', status: 'exited' });
  });

  it('a shutdown while the hc target is being launched: the shutdown waits for the switch, which ends (the terminal is the only effect and is reported)', async () => {
    const f = await setup();
    const before = await f.launched();
    let release: () => void = () => undefined;
    f.world.launchGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const settled = f.host.switchHost(before.id, 'hc').then(
      () => 'switched',
      (error: unknown) => (error instanceof LaunchError ? error.code : 'other'),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    let shutdownDone = false;
    const shutdown = f.host.shutdown().then(() => {
      shutdownDone = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(shutdownDone).toBe(false);
    release();
    await shutdown;
    expect(await settled).toBeDefined();
  });
});

describe('review fixes (#71): a thread record keeps its cap when it moves back to Web', () => {
  it('hc -> Web of a thread is refused with too-many-threads BEFORE anything is stopped', async () => {
    const f = await setup({ maxThreadsPerSession: 1 });
    const source = '33333333-3333-4333-8333-333333333333';
    const anchor = String(f.world.transcript[0]?.['uuid']);
    const threadA = await f.host.launch({ hostKind: 'stream-json', cwd: f.cwd, name: 'thread a', forkOf: source, resumeSessionAt: anchor });
    f.world.now += 60_000;
    await f.host.switchHost(threadA.id, 'hc');
    f.world.now += 60_000;
    await f.host.launch({ hostKind: 'stream-json', cwd: f.cwd, name: 'thread b', forkOf: source, resumeSessionAt: anchor });
    const error = await rejection(f.host.switchHost(threadA.id, 'stream-json'));
    expect(error.code).toBe('too-many-threads');
    expect(f.world.hcCalls.some((call) => call.startsWith('keys') || call.startsWith('kill'))).toBe(false);
    expect(f.host.get(threadA.id)).toMatchObject({ hostKind: 'hc', status: 'live' });
  });
});

describe('review fixes (#71): a folder trusted only through a parent is not verified', () => {
  it('is refused for an hc target BEFORE the stop, with the fix to open claude once in the folder', async () => {
    const f = await setup();
    const before = await f.launched();
    f.world.trusted = false;
    f.world.trustedViaParent = '/work';
    const error = await rejection(f.host.switchHost(before.id, 'hc'));
    expect(error.code).toBe('switch-untrusted-folder');
    expect(error.fix).toContain('open claude once in the folder to trust it');
    expect(isPidAlive(before.pid ?? 0)).toBe(true);
    expect(f.world.hcCalls).toEqual([]);
  });

  it('with force it goes on and the note says the trust came from the parent and was not verified', async () => {
    const f = await setup();
    const before = await f.launched();
    f.world.trusted = false;
    f.world.trustedViaParent = '/work';
    const result = await f.host.switchHost(before.id, 'hc', { force: true });
    expect(result.session.hostKind).toBe('hc');
    expect(result.notes.join(' ')).toMatch(/parent \/work.*not verified|not verified.*parent \/work/);
  });

  it('a folder with no trust at all is refused even with force (the terminal would block on the dialog)', async () => {
    const f = await setup();
    const before = await f.launched();
    f.world.trusted = false;
    const error = await rejection(f.host.switchHost(before.id, 'hc', { force: true }));
    expect(error.code).toBe('switch-untrusted-folder');
    expect(isPidAlive(before.pid ?? 0)).toBe(true);
  });
});

describe('review fixes (#71): the supervisor check is a warning, once, before the stop', () => {
  it('claude agents failing does not hard-fail: it needs force, with the reason visible, and nothing is stopped without it', async () => {
    const f = await setup();
    const before = await f.launched();
    f.world.bgError = new Error('claude agents exited 1');
    const error = await rejection(f.host.switchHost(before.id, 'hc'));
    expect(error.code).toBe('switch-not-ready');
    expect(error.reason).toMatch(/supervisor/);
    expect(error.reason).toContain('claude agents exited 1');
    expect(isPidAlive(before.pid ?? 0)).toBe(true);
  });

  it('with force the switch goes on, and the supervisor is asked ONCE (the check after the stop reads the registry only)', async () => {
    const f = await setup();
    const before = await f.launched();
    f.world.bgError = new Error('claude agents exited 1');
    const result = await f.host.switchHost(before.id, 'hc', { force: true });
    expect(result.session.hostKind).toBe('hc');
    expect(f.world.bgListCalls).toBe(1);
  });

  it('when the supervisor answers, a normal switch asks it once, not twice', async () => {
    const f = await setup();
    const before = await f.launched();
    await f.host.switchHost(before.id, 'hc');
    expect(f.world.bgListCalls).toBe(1);
  });
});

describe('review fixes (#71): a draft typed in an idle terminal is not erased silently', () => {
  it('refuses with switch-draft and the hint, and types no keys', async () => {
    const f = await setup();
    const { view, address } = await hcSession(f);
    f.world.screen = () => screenWith('half typed thought');
    const error = await rejection(f.host.switchHost(view.id, 'stream-json'));
    expect(error.code).toBe('switch-draft');
    expect(error.fix).toContain('clear the draft or force: the draft will be lost');
    expect(f.world.hcCalls.some((call) => call.startsWith('keys') || call.startsWith('kill'))).toBe(false);
    expect(f.world.hcCalls).toContain(`read ${address}`);
    expect(f.host.get(view.id)).toMatchObject({ hostKind: 'hc', status: 'live' });
  });

  it('an empty prompt box goes on with the keys', async () => {
    const f = await setup();
    const { view, address } = await hcSession(f);
    await f.host.switchHost(view.id, 'stream-json');
    expect(f.world.hcCalls).toContain(`keys ${address} ctrl+c ctrl+c`);
  });

  it('a screen without a prompt box (a dialog) is refused the same way, never read as empty', async () => {
    const f = await setup();
    const { view } = await hcSession(f);
    f.world.screen = () => 'Do you trust the files in this folder?';
    const error = await rejection(f.host.switchHost(view.id, 'stream-json'));
    expect(error.code).toBe('switch-draft');
    expect(error.reason).toMatch(/prompt/);
  });

  it('with force the draft is not an obstacle (the keys are typed, escalated to a kill when the terminal stays)', async () => {
    const f = await setup();
    const { view, address } = await hcSession(f);
    f.world.screen = () => screenWith('half typed thought');
    await f.host.switchHost(view.id, 'stream-json', { force: true });
    expect(f.world.hcCalls).toContain(`keys ${address} ctrl+c ctrl+c`);
  });
});

describe('review fixes (#71): the source own registry entry is not "another holder"', () => {
  it('an hc terminal whose foreground pid is unknown: the entry of the id cannot be matched, so it is unknown (needs force), not session-held', async () => {
    const f = await setup();
    const { view, address } = await hcSession(f);
    const info = f.world.terminals.get(address) as HcTerminalInfo;
    const { foregroundPid: _unused, ...withoutPid } = info;
    f.world.terminals.set(address, withoutPid);
    const error = await rejection(f.host.switchHost(view.id, 'stream-json'));
    expect(error.code).toBe('switch-not-ready');
    expect(error.reason).toMatch(/cannot be matched/);
    expect(f.world.hcCalls.some((call) => call.startsWith('keys') || call.startsWith('kill'))).toBe(false);
  });

  it('a Web session whose registry entry has another pid (a wrapper process): unknown and needs force, not session-held', async () => {
    const f = await setup();
    const before = await f.launched();
    f.world.registry.push(regSession(8888, before.id));
    const error = await rejection(f.host.switchHost(before.id, 'hc'));
    expect(error.code).toBe('switch-not-ready');
    expect(error.reason).toMatch(/8888/);
    expect(error.reason).toMatch(/cannot be matched/);
    expect(isPidAlive(before.pid ?? 0)).toBe(true);
  });

  it('with force the unmatched entry is still proved gone after the stop: if it stays alive nothing is started', async () => {
    const f = await setup();
    const before = await f.launched();
    f.world.registry.push(regSession(8888, before.id));
    const error = await rejection(f.host.switchHost(before.id, 'hc', { force: true }));
    expect(error.code).toBe('switch-stop-incomplete');
    expect(f.world.hcCalls.some((call) => call.startsWith('run '))).toBe(false);
  });

  it('a registry entry that matches the source pid plus another live entry for the id is still a real holder (session-held)', async () => {
    const f = await setup();
    const before = await f.launched();
    f.world.registry.push(regSession(before.pid ?? 1, before.id), regSession(7777, before.id));
    expect((await rejection(f.host.switchHost(before.id, 'hc'))).code).toBe('session-held');
  });
});
