import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDir } from '../testFixtures.js';
import { BgLauncher, buildBgArgs, parseAgentsJson, parseAgentsReport, parseBackgroundedId } from './BgLauncher.js';
import type { BgLauncherOptions } from './BgLauncher.js';
import { LaunchError } from './errors.js';

const FAKE = fileURLToPath(new URL('./testSupport/fakeBgClaude.mjs', import.meta.url));
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    removeDir(dir);
  }
});

interface Fixture {
  launcher: BgLauncher;
  cwd: string;
  statePath: string;
  logPath: string;
}

function setup(env: Record<string, string> = {}, options: BgLauncherOptions = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'agent-manager-bg-'));
  dirs.push(root);
  const cwd = join(root, 'project');
  mkdirSync(cwd, { recursive: true });
  const statePath = join(root, 'state.json');
  const logPath = join(root, 'log.ndjson');
  const launcher = new BgLauncher({
    command: process.execPath,
    commandArgs: [FAKE],
    env: { ...process.env, FAKE_BG_STATE: statePath, FAKE_BG_LOG: logPath, ...env },
    pollIntervalMs: 20,
    linkTimeoutMs: 600,
    launchTimeoutMs: 3000,
    commandTimeoutMs: 1500,
    listTimeoutMs: 3000,
    ...options,
  });
  return { launcher, cwd, statePath, logPath };
}

const argvLog = (path: string): string[][] =>
  readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .map((line) => (JSON.parse(line) as { argv: string[] }).argv);

async function failure(work: Promise<unknown>): Promise<LaunchError> {
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

describe('buildBgArgs', () => {
  it('builds an argument array with the validated values and no prompt', () => {
    expect(buildBgArgs({ model: 'haiku', permissionMode: 'plan', name: 'my session' })).toEqual(['--bg', '--model', 'haiku', '--permission-mode', 'plan', '--name', 'my session']);
    expect(buildBgArgs({})).toEqual(['--bg']);
  });

  it.each([['-x'], [''], ['a\nb'], ['x'.repeat(65)]])('refuses the name %j', (name) => {
    expect(() => buildBgArgs({ name })).toThrow(/invalid-name|not valid/);
  });

  it('refuses a model or a mode that could be read as a flag', () => {
    expect(() => buildBgArgs({ model: '--dangerously-skip-permissions' })).toThrow(LaunchError);
    expect(() => buildBgArgs({ permissionMode: 'a b' })).toThrow(LaunchError);
  });
});

describe('parsers', () => {
  it('reads the id of the backgrounded line whatever the separator encoding', () => {
    expect(parseBackgroundedId('Starting background service...\nbackgrounded \u00b7 7c5dcf5d \u00b7 flaky\n  claude agents')).toBe('7c5dcf5d');
    expect(parseBackgroundedId('backgrounded \u00c2\u00b7 7C5DCF5D')).toBe('7c5dcf5d');
    expect(parseBackgroundedId('backgrounded - 284b31e9 - am (idle)')).toBe('284b31e9');
    expect(parseBackgroundedId('started something')).toBeUndefined();
  });

  it('keeps background entries and leaves interactive ones out', () => {
    const agents = parseAgentsJson(
      JSON.stringify([
        { pid: 1, cwd: 'folder-a', kind: 'interactive', startedAt: 1, sessionId: 's' },
        { pid: 2, id: '284b31e9', cwd: 'folder-b', kind: 'background', startedAt: 2, sessionId: 'u', name: 'n', status: 'waiting', state: 'blocked', waitingFor: 'permission prompt' },
        { id: 'abcdef12', cwd: 'folder-c', kind: 'background', state: 'stopped' },
      ]),
    );
    expect(agents).toEqual([
      { id: '284b31e9', cwd: 'folder-b', kind: 'background', sessionId: 'u', name: 'n', state: 'blocked', status: 'waiting', waitingFor: 'permission prompt', pid: 2, startedAt: 2 },
      { id: 'abcdef12', cwd: 'folder-c', kind: 'background', state: 'stopped' },
    ]);
  });

  it('refuses output that is not a JSON array at all, never guessing', () => {
    expect(() => parseAgentsJson('nope')).toThrow(/did not print JSON/);
    expect(() => parseAgentsJson('{}')).toThrow(/not an array/);
  });

  it('keeps the valid entries and reports each unreadable one instead of throwing', () => {
    const report = parseAgentsReport('[1,{"id":"abcdef12","kind":"background"},{"id":"--force","cwd":"x","kind":"background"},{"id":"deadbeef","cwd":"x","kind":"background"}]');
    expect(report.agents.map((agent) => agent.id)).toEqual(['deadbeef']);
    expect(report.skipped).toHaveLength(3);
    expect(report.skipped[0]).toBe('entry 0 is not an object');
    expect(report.skipped[1]).toMatch(/entry 1 has no usable id, cwd and kind/);
  });
});

describe('BgLauncher against the fake claude', () => {
  it('starts a session with an argument array and links it to its session id', async () => {
    const { launcher, cwd, logPath } = setup();
    const result = await launcher.launch({ cwd, model: 'haiku', permissionMode: 'default', name: 'am-test' });
    expect(result.jobId).toMatch(/^[0-9a-f]{8}$/);
    expect(result.agent.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.agent).toMatchObject({ id: result.jobId, kind: 'background', name: 'am-test', state: 'blocked', status: 'idle' });
    const calls = argvLog(logPath);
    expect(calls[0]).toEqual(['--bg', '--model', 'haiku', '--permission-mode', 'default', '--name', 'am-test']);
    expect(calls[1]).toEqual(['agents', '--json', '--all']);
  });

  it('does not wait for a supervisor that keeps the pipes open', async () => {
    const { launcher, cwd } = setup({ FAKE_BG_HOLD_PIPES: '1' });
    const started = Date.now();
    await launcher.launch({ cwd });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('says how to trust the folder', async () => {
    const { launcher, cwd } = setup({ FAKE_BG_UNTRUSTED: '1' });
    const error = await failure(launcher.launch({ cwd }));
    expect(error.code).toBe('workspace-not-trusted');
    expect(error.fix).toMatch(/run `claude` once in .*accept the trust dialog/);
  });

  it('fails visibly when claude --bg prints nothing it can read, naming the possible leftover', async () => {
    const { launcher, cwd } = setup({ FAKE_BG_NO_OUTPUT: '1' });
    const error = await failure(launcher.launch({ cwd }));
    expect(error.code).toBe('bg-bad-answer');
    expect(error.fix).toMatch(/claude stop <id>/);
  });

  it('times out with the id and the stop command when the session is never listed', async () => {
    const { launcher, cwd } = setup({ FAKE_BG_NEVER_LISTED: '1' });
    const error = await failure(launcher.launch({ cwd }));
    expect(error.code).toBe('bg-session-not-listed');
    expect(error.reason).toMatch(/did not list it with a session id within 600 ms/);
    expect(error.fix).toMatch(/claude stop [0-9a-f]{8}/);
  });

  it('times out when the entry has no session id', async () => {
    const { launcher, cwd } = setup({ FAKE_BG_NO_SESSION_ID: '1' });
    expect((await failure(launcher.launch({ cwd }))).code).toBe('bg-session-not-listed');
  });

  it('reports a list that stays unreadable at the end of the wait, with the cause', async () => {
    const { launcher, cwd } = setup({ FAKE_BG_GARBAGE_LIST: '1' });
    const error = await failure(launcher.launch({ cwd }));
    expect(error.code).toBe('bg-bad-answer');
    expect(error.reason).toMatch(/still failing at the end of the 600 ms wait/);
    expect(error.fix).toMatch(/claude stop/);
  });

  it('bounds a claude --bg that never ends', async () => {
    const { launcher, cwd } = setup({ FAKE_BG_HANG: '--bg' }, { launchTimeoutMs: 300 });
    const error = await failure(launcher.launch({ cwd }));
    expect(error.code).toBe('bg-launch-timeout');
    expect(error.fix).toMatch(/claude agents/);
  });

  it('refuses a folder that is missing or relative before running anything', async () => {
    const { launcher, cwd, logPath } = setup();
    expect((await failure(launcher.launch({ cwd: join(cwd, 'nope') }))).code).toBe('cwd-missing');
    expect((await failure(launcher.launch({ cwd: 'relative' }))).code).toBe('cwd-not-absolute');
    expect(() => readFileSync(logPath, 'utf8')).toThrow();
  });

  it('lists, stops, respawns and removes', async () => {
    const { launcher, cwd, logPath } = setup();
    const { jobId } = await launcher.launch({ cwd });
    await launcher.stop(jobId);
    expect((await launcher.list()).find((agent) => agent.id === jobId)?.state).toBe('stopped');
    await launcher.respawn(jobId);
    expect((await launcher.list()).find((agent) => agent.id === jobId)?.state).toBe('blocked');
    await launcher.stop(jobId);
    await launcher.remove(jobId);
    expect((await launcher.list()).find((agent) => agent.id === jobId)).toBeUndefined();
    const verbs = argvLog(logPath).map((argv) => argv.slice(0, 2).join(' '));
    expect(verbs).toContain(`stop ${jobId}`);
    expect(verbs).toContain(`respawn ${jobId}`);
    expect(verbs).toContain(`rm ${jobId}`);
  });

  it('refuses an id that is not hexadecimal without running anything', async () => {
    const { launcher, logPath } = setup();
    expect((await failure(launcher.stop('--all'))).code).toBe('invalid-job-id');
    expect(() => readFileSync(logPath, 'utf8')).toThrow();
  });

  it('reports the message of a failing command and the one of an unknown session', async () => {
    const { launcher, cwd } = setup({ FAKE_BG_FAIL: 'rm' });
    const { jobId } = await launcher.launch({ cwd });
    const error = await failure(launcher.remove(jobId));
    expect(error.code).toBe('bg-command-failed');
    expect(error.reason).toMatch(/fake failure of rm/);
    const unknown = await failure(launcher.stop('deadbeef'));
    expect(unknown.reason).toMatch(/no background session deadbeef/);
  });

  it('bounds a command that hangs', async () => {
    const { launcher, cwd } = setup({ FAKE_BG_HANG: 'stop' }, { commandTimeoutMs: 300 });
    const { jobId } = await launcher.launch({ cwd });
    expect((await failure(launcher.stop(jobId))).code).toBe('bg-command-timeout');
  });

  it('says claude is missing, with the fix', async () => {
    const launcher = new BgLauncher({ command: join(tmpdir(), 'no-such-claude-program') });
    const error = await failure(launcher.list());
    expect(error.code).toBe('claude-missing');
  });

  it('lists the readable entries and warns about the others (an unreadable entry never blanks the list)', async () => {
    const warnings: string[] = [];
    const { launcher, cwd } = setup({ FAKE_BG_BAD_ENTRY: '1' }, { onWarning: (text) => warnings.push(text) });
    const { jobId } = await launcher.launch({ cwd });
    expect((await launcher.list()).map((agent) => agent.id)).toContain(jobId);
    expect(warnings[0]).toMatch(/3 entries were skipped, the others are used \(first: entry 0 has no usable id/);
  });

  it('fails with an explicit message when the list is larger than it reads, never a cut JSON', async () => {
    const { launcher } = setup({ FAKE_BG_HUGE: '1' }, { listTimeoutMs: 20_000 });
    const error = await failure(launcher.list());
    expect(error.code).toBe('bg-output-too-large');
    expect(error.reason).toMatch(/printed \d+ bytes, more than the 16777216/);
  });

  it('reads agents written by a test into the state file', async () => {
    const { launcher, statePath } = setup();
    writeFileSync(statePath, JSON.stringify({ agents: [{ id: 'abcdef12', cwd: 'folder-x', kind: 'background', sessionId: 'u1', state: 'blocked', status: 'waiting', waitingFor: 'permission prompt' }] }));
    expect(await launcher.list()).toMatchObject([{ id: 'abcdef12', waitingFor: 'permission prompt' }]);
  });
});
