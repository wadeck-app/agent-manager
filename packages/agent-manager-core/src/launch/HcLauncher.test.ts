import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDir, registryEntry } from '../testFixtures.js';
import { LaunchError } from './errors.js';
import { HcLauncher, buildRunArgs } from './HcLauncher.js';
import type { HcLauncherOptions } from './HcLauncher.js';

const FAKE_HC = fileURLToPath(new URL('./testSupport/fakeHcRun.mjs', import.meta.url));

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    removeDir(dir);
  }
});

interface Fixture {
  launcher: HcLauncher;
  cwd: string;
  sessionsDir: string;
  calls: () => { argv: string[]; hasCallerId: boolean }[];
  writeRegistry: (entry: Record<string, unknown>) => void;
}

function setup(scenario: Record<string, unknown>, options: HcLauncherOptions = {}, env: NodeJS.ProcessEnv = {}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'agent-manager-hclaunch-'));
  dirs.push(dir);
  const cwd = join(dir, 'proj');
  const sessionsDir = join(dir, 'sessions');
  mkdirSync(cwd);
  mkdirSync(sessionsDir);
  const scenarioFile = join(dir, 'scenario.json');
  const logFile = join(dir, 'hc.ndjson');
  writeFileSync(scenarioFile, JSON.stringify(scenario));
  const launcher = new HcLauncher({
    command: process.execPath,
    commandArgs: [FAKE_HC],
    env: () => ({ ...process.env, FAKE_HC_SCENARIO: scenarioFile, FAKE_HC_LOG: logFile, ...env }),
    sessionsDir,
    pollIntervalMs: 5,
    registryTimeoutMs: 400,
    ...options,
  });
  return {
    launcher,
    cwd,
    sessionsDir,
    calls: () =>
      readFileSync(logFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { argv: string[]; hasCallerId: boolean }),
    writeRegistry: (entry) => writeFileSync(join(sessionsDir, `${String(entry['pid'])}.json`), JSON.stringify(entry)),
  };
}

const RUN_OK = { stdout: { address: 't1z', agent: 'claude', cwd: 'x', name: 'am-test', state: 'live', turn: 0 } };

async function rejection(promise: Promise<unknown>): Promise<LaunchError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LaunchError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a LaunchError, the promise resolved');
}

describe('buildRunArgs', () => {
  it('puts every hc option before the program and never passes --force', () => {
    const args = buildRunArgs({ cwd: '/work/shop', name: 'am-shop', args: ['--model', 'haiku', '--permission-mode', 'default'] });
    expect(args).toEqual(['run', '--json', '--bg', '--no-parent', '--no-notify', '--name', 'am-shop', '--cwd', '/work/shop', 'claude', '--model', 'haiku', '--permission-mode', 'default']);
    expect(args.join(' ')).not.toContain('force');
  });

  it('refuses arguments that mention force', () => {
    expect(() => buildRunArgs({ cwd: '/w', name: 'a', args: ['--force'] })).toThrow(/force/);
  });
});

describe('HcLauncher', () => {
  it('runs hc, then links the terminal to the registry entry whose pid is the foreground pid', async () => {
    // The first poll finds no entry; the registry entry appears while the launcher waits before the second poll.
    let write = (): void => undefined;
    const fixture = setup({ run: RUN_OK, get: { t1z: [{ address: 't1z', foreground: { pid: process.pid } }] } }, { sleep: () => Promise.resolve(write()) });
    write = () => fixture.writeRegistry(registryEntry(process.pid, { sessionId: 'sess-linked', cwd: fixture.cwd }));
    const result = await fixture.launcher.launch({ cwd: fixture.cwd, name: 'am-test', args: ['--model', 'haiku'] });
    expect(result).toMatchObject({ address: 't1z', name: 'am-test', cwd: fixture.cwd });
    expect(result.session.pid).toBe(process.pid);
    expect(result.session.sessionId).toBe('sess-linked');
    const calls = fixture.calls();
    expect(calls[0]?.argv).toEqual(['run', '--json', '--bg', '--no-parent', '--no-notify', '--name', 'am-test', '--cwd', fixture.cwd, 'claude', '--model', 'haiku']);
    expect(calls.filter((call) => call.argv[0] === 'get').length).toBeGreaterThan(1);
    for (const call of calls) {
      expect(call.argv.join(' ')).not.toContain('force');
    }
  });

  it('removes HC_TERMINAL_ID from the environment of hc', async () => {
    const fixture = setup({ run: RUN_OK, get: { t1z: [{ foreground: { pid: process.pid } }] } }, {}, { HC_TERMINAL_ID: 't1c' });
    fixture.writeRegistry(registryEntry(process.pid, { cwd: fixture.cwd }));
    await fixture.launcher.launch({ cwd: fixture.cwd, name: 'am-test', args: [] });
    expect(fixture.calls().every((call) => !call.hasCallerId)).toBe(true);
  });

  it('times out with the terminal, what to read and how to close it when nothing registers', async () => {
    const fixture = setup({ run: RUN_OK, get: { t1z: [{ foreground: { pid: process.pid } }] } }, { registryTimeoutMs: 100 });
    const error = await rejection(fixture.launcher.launch({ cwd: fixture.cwd, name: 'am-test', args: [] }));
    expect(error.code).toBe('session-not-registered');
    expect(error.reason).toContain('t1z');
    expect(error.fix).toContain('hc read t1z');
    expect(error.fix).toContain('trust');
    expect(error.fix).toContain('hc kill t1z');
    // The launcher never closes the terminal itself.
    expect(fixture.calls().some((call) => ['kill', 'rm'].includes(call.argv[0] ?? ''))).toBe(false);
  });

  it('does not match a registry entry of another pid', async () => {
    const fixture = setup({ run: RUN_OK, get: { t1z: [{ foreground: { pid: process.pid } }] } }, { registryTimeoutMs: 100 });
    fixture.writeRegistry(registryEntry(process.pid + 1, { cwd: fixture.cwd }));
    expect((await rejection(fixture.launcher.launch({ cwd: fixture.cwd, name: 'am-test', args: [] }))).code).toBe('session-not-registered');
  });

  it('says the terminal ended when hc no longer knows it', async () => {
    const fixture = setup({ run: RUN_OK, get: {} });
    const error = await rejection(fixture.launcher.launch({ cwd: fixture.cwd, name: 'am-test', args: [] }));
    expect(error.code).toBe('terminal-gone');
    expect(error.fix).toContain('claude');
  });

  it('shows hc refusals with their hint', async () => {
    const fixture = setup({ run: { exit: 3, stdout: { error: { kind: 'conflict', message: 'name "am-test" is in use', hint: 'pick another name or hc rm the old terminal' } } } });
    const error = await rejection(fixture.launcher.launch({ cwd: fixture.cwd, name: 'am-test', args: [] }));
    expect(error.code).toBe('hc-run-failed');
    expect(error.reason).toContain('is in use');
    expect(error.fix).toBe('pick another name or hc rm the old terminal');
  });

  it('reports an answer without a terminal address', async () => {
    const fixture = setup({ run: { stdout: { ok: true } } });
    expect((await rejection(fixture.launcher.launch({ cwd: fixture.cwd, name: 'am-test', args: [] }))).code).toBe('hc-bad-answer');
  });

  it('reports an unreadable registry folder instead of waiting', async () => {
    const fixture = setup({ run: RUN_OK, get: { t1z: [{ foreground: { pid: process.pid } }] } }, { sessionsDir: join(tmpdir(), 'agent-manager-no-such-registry-dir') });
    const error = await rejection(fixture.launcher.launch({ cwd: fixture.cwd, name: 'am-test', args: [] }));
    expect(error.code).toBe('registry-unreadable');
    expect(error.fix).not.toBe('');
  });

  it('reports a missing hc with the install fix', async () => {
    const fixture = setup({ run: RUN_OK }, { command: 'hc-does-not-exist-agent-manager', commandArgs: [] });
    const error = await rejection(fixture.launcher.launch({ cwd: fixture.cwd, name: 'am-test', args: [] }));
    expect(error.code).toBe('hc-missing');
    expect(error.fix).toContain('hc --version');
  });

  it('validates the name, the folder and the arguments before running hc', async () => {
    const fixture = setup({ run: RUN_OK });
    expect((await rejection(fixture.launcher.launch({ cwd: fixture.cwd, name: 'Bad Name', args: [] }))).code).toBe('invalid-terminal-name');
    expect((await rejection(fixture.launcher.launch({ cwd: 'relative/dir', name: 'ok', args: [] }))).code).toBe('cwd-not-absolute');
    expect((await rejection(fixture.launcher.launch({ cwd: join(fixture.cwd, 'missing'), name: 'ok', args: [] }))).code).toBe('cwd-missing');
    expect((await rejection(fixture.launcher.launch({ cwd: fixture.cwd, name: 'ok', args: ['a\0b'] }))).code).toBe('invalid-argument');
    // Nothing was started.
    expect(() => fixture.calls()).toThrow();
  });
});

describe('HcLauncher arguments and failures (review fixes)', () => {
  it('accepts names and folders that merely contain the letters "force"', () => {
    expect(() => buildRunArgs({ cwd: '/work/reinforcement-learning', name: 'am-enforcer', args: ['--model', 'haiku'] })).not.toThrow();
  });

  it('refuses an exact --force or -f in the claude arguments', () => {
    expect(() => buildRunArgs({ cwd: '/w', name: 'a', args: ['-f'] })).toThrow(/force/);
    expect(() => buildRunArgs({ cwd: '/w', name: 'a', args: ['--force'] })).toThrow(/force/);
  });

  it('checks the values of the known flags like the stream-json launcher does', () => {
    expect(() => buildRunArgs({ cwd: '/w', name: 'a', args: ['--model', '--dangerously-skip-permissions'] })).toThrow(/model/);
    expect(() => buildRunArgs({ cwd: '/w', name: 'a', args: ['--model'] })).toThrow(/no value/);
    expect(() => buildRunArgs({ cwd: '/w', name: 'a', args: ['--permission-mode=bad word'] })).toThrow(/permission mode/);
    expect(() => buildRunArgs({ cwd: '/w', name: 'a', args: ['--resume', '../x'] })).toThrow(LaunchError);
    expect(() => buildRunArgs({ cwd: '/w', name: 'a', args: ['line\nbreak'] })).toThrow(/single-line/);
    expect(buildRunArgs({ cwd: '/w', name: 'a', args: ['--model=haiku', '--permission-mode', 'default'] }).slice(-3)).toEqual(['--model=haiku', '--permission-mode', 'default']);
  });

  it('names the terminal and how to find and close it when hc run does not answer', async () => {
    const fixture = setup({ run: { ...RUN_OK, delayMs: 5000 } }, { runTimeoutMs: 300 });
    const error = await rejection(fixture.launcher.launch({ cwd: fixture.cwd, name: 'am-test', args: [] }));
    expect(error.code).toBe('hc-timeout');
    expect(error.fix).toContain('am-test');
    expect(error.fix).toContain('hc ls');
    expect(error.fix).toContain('hc kill am-test');
  });

  it('keeps waiting through a failed poll and succeeds when the next one works', async () => {
    // The first hc get fails (exit 1, no JSON), the second one answers.
    const fixture = setup({ run: RUN_OK, get: { t1z: [{ exit: 1, error: undefined, plain: 'busy' }, { foreground: { pid: process.pid } }] } });
    fixture.writeRegistry(registryEntry(process.pid, { cwd: fixture.cwd }));
    const result = await fixture.launcher.launch({ cwd: fixture.cwd, name: 'am-test', args: [] });
    expect(result.session.pid).toBe(process.pid);
    expect(fixture.calls().filter((call) => call.argv[0] === 'get')).toHaveLength(2);
  });

  it('reports the last failure with the terminal address at the deadline', async () => {
    const fixture = setup({ run: RUN_OK, get: { t1z: [{ exit: 1, error: undefined, plain: 'busy' }] } }, { registryTimeoutMs: 150 });
    const error = await rejection(fixture.launcher.launch({ cwd: fixture.cwd, name: 'am-test', args: [] }));
    expect(error.code).toBe('hc-query-failed');
    expect(error.reason).toContain('t1z');
    expect(error.fix).toContain('hc kill t1z');
  });
});
