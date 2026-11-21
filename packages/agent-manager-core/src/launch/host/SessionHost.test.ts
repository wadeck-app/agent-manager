import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { getErrorMessage } from '../../errors.js';
import { isPidAlive } from '../../pidAlive.js';
import { removeDir } from '../../testFixtures.js';
import { LaunchError } from '../errors.js';
import { HcLauncher } from '../HcLauncher.js';
import { StreamJsonSession } from '../StreamJsonSession.js';
import type { StreamJsonSessionOptions } from '../StreamJsonSession.js';
import { hostAuditFile } from './hostAudit.js';
import { SessionHost } from './SessionHost.js';
import type { HcLauncherLike, SessionHostOptions } from './SessionHost.js';
import { ownedStatePath, readOwnedState } from './stateFile.js';
import type { HostEvent, OwnedSessionRecord } from './types.js';

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

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-manager-host-'));
  dirs.push(dir);
  return dir;
}

interface Fixture {
  host: SessionHost;
  configDir: string;
  cwd: string;
  started: StreamJsonSession[];
}

/** A host on the fake claude, in its own config folder (never the real one). */
async function setup(options: Partial<SessionHostOptions> & { configDir?: string; init?: boolean } = {}): Promise<Fixture> {
  const root = tempDir();
  const configDir = options.configDir ?? join(root, 'config');
  const cwd = join(root, 'project');
  mkdirSync(cwd, { recursive: true });
  const started: StreamJsonSession[] = [];
  const { init, configDir: ignored, ...rest } = options;
  void ignored;
  const host = new SessionHost({
    configDir,
    claude: { command: process.execPath, commandArgs: [FAKE_CLAUDE] },
    closeTimeoutMs: 3000,
    startSession: async (sessionOptions: StreamJsonSessionOptions) => {
      const session = await StreamJsonSession.start(sessionOptions);
      started.push(session);
      return session;
    },
    ...rest,
  });
  hosts.push(host);
  if (init !== false) {
    await host.init();
  }
  return { host, configDir, cwd, started };
}

function until(host: SessionHost, predicate: (event: HostEvent) => boolean, what: string, timeoutMs = 20_000): Promise<HostEvent> {
  const already = host.events.replay(undefined).events.find(predicate);
  if (already !== undefined) {
    return Promise.resolve(already);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`timed out waiting for ${what}; events: ${host.events.replay(undefined).events.map((event) => event.type).join(', ')}`));
    }, timeoutMs);
    const unsubscribe = host.events.subscribe((event) => {
      if (predicate(event)) {
        clearTimeout(timer);
        unsubscribe();
        resolve(event);
      }
    });
  });
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

interface AuditLine {
  action: string;
  outcome: string;
  sessionId?: string;
  details: Record<string, string | number | boolean | null>;
}

function auditLines(configDir: string): AuditLine[] {
  const file = hostAuditFile(configDir, Date.now());
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line): AuditLine => JSON.parse(line));
}

describe('launch (stream-json)', () => {
  it('starts a session, records claude version and writes the state file and an audit line', async () => {
    const { host, configDir, cwd } = await setup();
    const view = await host.launch({ hostKind: 'stream-json', cwd, model: 'haiku', permissionMode: 'default', name: 'first' });
    expect(view).toMatchObject({ hostKind: 'stream-json', cwd, model: 'haiku', permissionMode: 'default', name: 'first', claudeVersion: '9.9.9 (Claude Code fake)', status: 'live', state: 'idle', resumable: false });
    expect(view.pid).toBeGreaterThan(0);
    expect(isPidAlive(view.pid ?? 0)).toBe(true);
    const records = await readOwnedState(ownedStatePath(configDir));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ id: view.id, status: 'live', pid: view.pid });
    expect(host.events.replay(undefined).events.map((event) => event.type)).toContain('session.launched');
    expect(auditLines(configDir)).toEqual([expect.objectContaining({ action: 'launch', sessionId: view.id, outcome: 'ok', details: expect.objectContaining({ hostKind: 'stream-json', model: 'haiku' }) })]);
  });

  it('refuses a launch whose claude does not answer --version, with a fix, and records nothing', async () => {
    const { host, cwd, configDir } = await setup({ claude: { command: process.execPath, commandArgs: [FAKE_CLAUDE], env: { ...process.env, FAKE_CLAUDE_VERSION_FAILS: '1' } } });
    const error = await rejection(host.launch({ hostKind: 'stream-json', cwd }));
    expect(error.code).toBe('claude-version-failed');
    expect(error.fix).toContain('claude --version');
    expect(host.list()).toEqual([]);
    expect(await readOwnedState(ownedStatePath(configDir))).toEqual([]);
    // The failed launch is audited too, so that a refused attempt leaves a trace.
    expect(auditLines(configDir)[0]).toMatchObject({ action: 'launch', outcome: expect.stringContaining('failed: ') });
  });

  it('reports a missing claude program as claude-missing', async () => {
    const { host, cwd } = await setup({ claude: { command: 'agent-manager-no-such-claude' } });
    const error = await rejection(host.launch({ hostKind: 'stream-json', cwd }));
    expect(error.code).toBe('claude-missing');
  });

  it('limits the live sessions and the list size, with a fix', async () => {
    const { host, cwd } = await setup({ maxLiveSessions: 1, maxRecords: 2 });
    const first = await host.launch({ hostKind: 'stream-json', cwd });
    expect((await rejection(host.launch({ hostKind: 'stream-json', cwd }))).code).toBe('too-many-sessions');
    await host.stop(first.id);
    const second = await host.launch({ hostKind: 'stream-json', cwd });
    await host.stop(second.id);
    const full = await rejection(host.launch({ hostKind: 'stream-json', cwd }));
    expect(full.code).toBe('session-list-full');
    expect(full.fix).toContain('forget');
  });

  it('kills the child and fails loudly when the state file cannot be written, so that no unrecorded process survives', async () => {
    const { host, cwd, configDir, started } = await setup();
    // A folder where the file should be: the rename of the temp file onto it fails.
    mkdirSync(ownedStatePath(configDir), { recursive: true });
    const error = await rejection(host.launch({ hostKind: 'stream-json', cwd }));
    expect(error.code).toBe('state-file-write-failed');
    expect(error.fix).toContain(configDir);
    expect(started).toHaveLength(1);
    expect(started[0]?.exitInfo).toBeDefined();
    expect(host.list()).toEqual([]);
  });
});

describe('fork (stream-json)', () => {
  const SOURCE = '11111111-2222-4333-8444-555555555555';
  const found = async (_cwd: string, id: string) => ({ ok: true as const, path: `/projects/p/${id}.jsonl`, projectDir: '/projects/p', via: 'slug' as const });

  function loggedArgv(logFile: string): string[][] {
    return readFileSync(logFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as { argv?: string[] }).argv)
      .filter((argv): argv is string[] => argv !== undefined && argv.includes('-p'));
  }

  it('launches a fork under a new id, records forkedFrom in the view and the state file, and audits it', async () => {
    const logFile = join(tempDir(), 'fake.ndjson');
    const { host, configDir, cwd } = await setup({ locateTranscript: found, claude: { command: process.execPath, commandArgs: [FAKE_CLAUDE], env: { ...process.env, FAKE_CLAUDE_LOG: logFile } } });
    const view = await host.launch({ hostKind: 'stream-json', cwd, name: 'fork of x', forkOf: SOURCE });
    expect(view.id).not.toBe(SOURCE);
    expect(view).toMatchObject({ forkedFrom: SOURCE, name: 'fork of x', status: 'live' });
    // The fake logs its argv when node has booted, a moment after the spawn.
    const deadline = Date.now() + 10_000;
    while (!existsSync(logFile) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const [argv] = loggedArgv(logFile);
    expect(argv).toEqual(expect.arrayContaining(['--resume', SOURCE, '--fork-session', '--session-id', view.id]));
    const records = await readOwnedState(ownedStatePath(configDir));
    expect(records[0]).toMatchObject({ id: view.id, forkedFrom: SOURCE });
    expect(host.events.replay(undefined).events.find((event) => event.type === 'session.launched')?.data).toMatchObject({ forkedFrom: SOURCE });
    expect(auditLines(configDir)[0]).toMatchObject({ action: 'launch', outcome: 'ok', details: expect.objectContaining({ forkOf: SOURCE }) });
    // A plain session has no forkedFrom.
    const plain = await host.launch({ hostKind: 'stream-json', cwd });
    expect(plain.forkedFrom).toBeUndefined();
  });

  it('refuses a source without transcript before starting anything, with the fix, and audits the refusal', async () => {
    const { host, configDir, cwd, started } = await setup({
      locateTranscript: async () => ({ ok: false as const, error: { code: 'not-found' as const, message: 'No transcript for session x', fix: 'The session may not have written a transcript yet.', tried: [] } }),
    });
    const failure = await rejection(host.launch({ hostKind: 'stream-json', cwd, forkOf: SOURCE }));
    expect(failure.code).toBe('fork-source-not-found');
    expect(failure.reason).toContain('No transcript for session x');
    expect(failure.fix).toContain('cannot be forked');
    expect(started).toHaveLength(0);
    expect(host.list()).toEqual([]);
    expect(auditLines(configDir)[0]).toMatchObject({ action: 'launch', outcome: expect.stringContaining('failed: ') });
  });

  it('looks for the transcript where the child will: the projects folder of the environment given to the child, and names that folder in the refusal', async () => {
    const seen: string[] = [];
    const { host, cwd } = await setup({
      claude: { command: process.execPath, commandArgs: [FAKE_CLAUDE], env: { ...process.env, AGENT_MANAGER_PROJECTS_DIR: '', CLAUDE_CONFIG_DIR: join(tempDir(), 'claude-config'), HOME: '/h' } },
      locateTranscript: async (_cwd, _id, projectsDir) => {
        seen.push(projectsDir);
        return { ok: false as const, error: { code: 'not-found' as const, message: 'nothing there', fix: 'look elsewhere', tried: [] } };
      },
    });
    const failure = await rejection(host.launch({ hostKind: 'stream-json', cwd, forkOf: SOURCE }));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/claude-config[\\/]projects$/);
    expect(failure.reason).toContain(seen[0]);
  });

  it('checks the source BEFORE taking a slot or running claude --version: a refused fork costs nothing', async () => {
    let versionReads = 0;
    const { host, cwd } = await setup({
      maxLiveSessions: 0,
      readVersion: async () => {
        versionReads += 1;
        return '9.9.9';
      },
      locateTranscript: async () => ({ ok: false as const, error: { code: 'not-found' as const, message: 'none', fix: 'f', tried: [] } }),
    });
    // The limit would say too-many-sessions: the missing source is reported first, and claude --version never ran.
    expect((await rejection(host.launch({ hostKind: 'stream-json', cwd, forkOf: SOURCE }))).code).toBe('fork-source-not-found');
    expect(versionReads).toBe(0);
  });

  it('refuses forkOf for another host kind even when the request did not come through parseLaunchBody', async () => {
    const { host, cwd } = await setup({ locateTranscript: found });
    expect((await rejection(host.launch({ hostKind: 'hc', cwd, forkOf: SOURCE }))).code).toBe('fork-host-unsupported');
    expect((await rejection(host.launch({ hostKind: 'bg', cwd, forkOf: SOURCE }))).code).toBe('fork-host-unsupported');
  });

  it('a claude that refuses the fork (exits at once) shows its stderr in the exit report, never a silent success', async () => {
    const { host, cwd } = await setup({ locateTranscript: found, claude: { command: process.execPath, commandArgs: [FAKE_CLAUDE], env: { ...process.env, FAKE_CLAUDE_MISSING_SOURCE: '1' } } });
    const view = await host.launch({ hostKind: 'stream-json', cwd, forkOf: SOURCE });
    await until(host, (event) => event.type === 'session.exit' && event.sessionId === view.id, 'the exit of the refused fork');
    const after = host.list().find((item) => item.id === view.id);
    expect(after?.state).toBe('exited');
    expect(after?.exit?.stderrTail).toContain('No conversation found');
  });
});

describe('send, interrupt, permission mode, permissions', () => {
  it('sends a message, follows its lifecycle to completed and keeps the last result; the audit has no text', async () => {
    const { host, cwd, configDir } = await setup();
    const { id } = await host.launch({ hostKind: 'stream-json', cwd });
    const sent = await host.send(id, { text: 'hello SECRET-WORD', images: [] });
    expect(sent.state).toBe('queued');
    await until(host, (event) => event.type === 'session.lifecycle' && event.data['uuid'] === sent.uuid && event.data['state'] === 'completed', 'completed lifecycle');
    await until(host, (event) => event.type === 'session.result', 'result');
    const view = host.get(id);
    expect(view.messages).toEqual([expect.objectContaining({ uuid: sent.uuid, state: 'completed' })]);
    expect(view.lastResult).toMatchObject({ isError: false, subtype: 'success', text: 'done' });
    const audit = readFileSync(hostAuditFile(configDir, Date.now()), 'utf8');
    expect(audit).toContain('"action":"send"');
    expect(audit).toContain('"textChars":17');
    expect(audit).not.toContain('SECRET-WORD');
    // The events carry notifications only, never the message text.
    expect(JSON.stringify(host.events.replay(undefined).events)).not.toContain('SECRET-WORD');
  });

  it('interrupts a running turn', async () => {
    const { host, cwd } = await setup();
    const { id } = await host.launch({ hostKind: 'stream-json', cwd });
    const sent = await host.send(id, { text: 'SLOW', images: [] });
    await until(host, (event) => event.type === 'session.state' && event.data['state'] === 'running', 'running');
    await until(host, (event) => event.type === 'session.lifecycle' && event.data['state'] === 'started', 'started');
    const receipt = await host.interrupt(id);
    expect(receipt.stillQueued).toEqual([]);
    await until(host, (event) => event.type === 'session.lifecycle' && event.data['uuid'] === sent.uuid && event.data['state'] === 'cancelled', 'cancelled');
    expect(host.events.replay(undefined).events.map((event) => event.type)).toContain('session.interrupt');
    expect(host.get(id).messages[0]?.state).toBe('cancelled');
  });

  it('changes the permission mode and stores it for a resume; a refused mode is an error with a fix', async () => {
    const { host, cwd, configDir } = await setup();
    const { id } = await host.launch({ hostKind: 'stream-json', cwd, permissionMode: 'default' });
    expect(await host.setPermissionMode(id, 'acceptEdits')).toEqual({ mode: 'acceptEdits' });
    expect((await readOwnedState(ownedStatePath(configDir)))[0]?.permissionMode).toBe('acceptEdits');
    const refused = await rejection(host.setPermissionMode(id, 'refuse'));
    expect(refused.code).toBe('control-refused');
    expect(host.get(id).permissionMode).toBe('acceptEdits');
  });

  it('queues a permission request, lists it in full, and applies allow and deny', async () => {
    const { host, cwd, configDir } = await setup();
    const { id } = await host.launch({ hostKind: 'stream-json', cwd });
    await host.send(id, { text: 'PERMIT one', images: [] });
    const request = await until(host, (event) => event.type === 'session.permission_request', 'permission request');
    expect(request.data).toMatchObject({ toolName: 'Bash', blockedPath: 'fake.txt' });
    // The event has no tool input; the list has it in full.
    expect(JSON.stringify(request.data)).not.toContain('touch fake.txt');
    const pending = host.permissions(id);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.input).toEqual({ command: 'touch fake.txt', description: 'Create fake.txt' });
    expect(host.get(id)).toMatchObject({ state: 'requires_action', pendingPermissions: 1 });
    const requestId = pending[0]?.requestId ?? '';
    expect(await host.decide(id, requestId, { decision: 'allow', message: '' })).toEqual({ requestId, decision: 'allow' });
    await until(host, (event) => event.type === 'session.permission_resolved' && event.data['behavior'] === 'allow', 'resolved allow');
    await until(host, (event) => event.type === 'session.result', 'result after allow');
    const unknown = await rejection(host.decide(id, requestId, { decision: 'allow', message: '' }));
    expect(unknown.code).toBe('unknown-permission-request');
    const audit = auditLines(configDir).filter((line) => line.action === 'permission-decision');
    expect(audit[0]).toMatchObject({ outcome: 'ok', details: { requestId, toolName: 'Bash', decision: 'allow' } });
    expect(JSON.stringify(audit)).not.toContain('touch fake.txt');
    // Deny with the default message.
    await host.send(id, { text: 'PERMIT two', images: [] });
    await until(host, (event) => event.type === 'session.permission_request' && event.data['requestId'] !== requestId, 'second request');
    const second = host.permissions(id)[0]?.requestId ?? '';
    await host.decide(id, second, { decision: 'deny', message: 'no thanks' });
    await until(host, (event) => event.type === 'session.permission_resolved' && event.data['behavior'] === 'deny', 'resolved deny');
  });

  it('turns a crash into an exit with the cause and stderr, a persisted exited record, and a resumable session', async () => {
    const { host, cwd, configDir } = await setup();
    const { id } = await host.launch({ hostKind: 'stream-json', cwd });
    const sent = await host.send(id, { text: 'CRASH', images: [] });
    const exit = await until(host, (event) => event.type === 'session.exit', 'exit');
    expect(exit.data).toMatchObject({ cause: 'crashed', code: 3, by: 'self' });
    // The event has no stderr; the session view (GET /sessions/:id) has it.
    expect(JSON.stringify(exit.data)).not.toContain('boom');
    expect(host.get(id).exit?.stderrTail).toContain('fake claude crashed: boom');
    const view = host.get(id);
    expect(view).toMatchObject({ state: 'exited', status: 'exited', resumable: true });
    expect(view.pid).toBeUndefined();
    await host.flush();
    await expect(readOwnedState(ownedStatePath(configDir))).resolves.toEqual([expect.objectContaining({ id, status: 'exited', exit: expect.objectContaining({ cause: 'crashed', by: 'self' }) })]);
    const notLive = await rejection(host.send(id, { text: 'again', images: [] }));
    expect(notLive.code).toBe('session-not-live');
    expect(notLive.fix).toContain(`/sessions/${id}/resume`);
    expect(sent.uuid).toBeTruthy();
  });
});

describe('stop, resume, forget', () => {
  it('stops a session (by user), then resumes it with --resume under the same id and keeps the stored mode', async () => {
    const { host, cwd } = await setup({ claude: { command: process.execPath, commandArgs: [FAKE_CLAUDE], env: { ...process.env, FAKE_CLAUDE_LOG: join(tempDir(), 'claude.ndjson') } } });
    const { id } = await host.launch({ hostKind: 'stream-json', cwd, model: 'haiku', permissionMode: 'default' });
    await host.setPermissionMode(id, 'acceptEdits');
    const stopped = await host.stop(id);
    expect(stopped).toMatchObject({ state: 'exited', resumable: true, exit: expect.objectContaining({ by: 'user', cause: 'closed' }) });
    const resumed = await host.resume(id);
    expect(resumed).toMatchObject({ id, state: 'idle', status: 'live', resumable: false });
    expect(resumed.exit).toBeUndefined();
    expect(resumed.resumedAt).toBeGreaterThan(0);
    const sent = await host.send(id, { text: 'after resume', images: [] });
    await until(host, (event) => event.type === 'session.lifecycle' && event.data['uuid'] === sent.uuid && event.data['state'] === 'completed', 'completed after resume');
    expect(host.get(id).lastResult?.text).toBe('done');
    expect((await rejection(host.resume(id))).code).toBe('already-live');
  });

  it('passes --resume, the stored model and the stored permission mode to the new child', async () => {
    const log = join(tempDir(), 'claude.ndjson');
    const { host, cwd } = await setup({ claude: { command: process.execPath, commandArgs: [FAKE_CLAUDE], env: { ...process.env, FAKE_CLAUDE_LOG: log } } });
    const { id } = await host.launch({ hostKind: 'stream-json', cwd, model: 'haiku' });
    await host.setPermissionMode(id, 'plan');
    await host.stop(id);
    await host.resume(id);
    // The new process writes its argv when its script starts, a moment after the spawn: a completed message proves it ran.
    const sent = await host.send(id, { text: 'ping', images: [] });
    await until(host, (event) => event.type === 'session.lifecycle' && event.data['uuid'] === sent.uuid && event.data['state'] === 'completed', 'completed after resume');
    const argvs = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { argv?: string[] }).filter((entry) => entry.argv !== undefined);
    expect(argvs).toHaveLength(2);
    expect(argvs[0]?.argv).toEqual(expect.arrayContaining(['--session-id', id, '--model', 'haiku']));
    expect(argvs[1]?.argv).toEqual(expect.arrayContaining(['--resume', id, '--model', 'haiku', '--permission-mode', 'plan']));
    expect(argvs[1]?.argv).not.toContain('--session-id');
  });

  it('forgets an ended session but never a live one', async () => {
    const { host, cwd, configDir } = await setup();
    const { id } = await host.launch({ hostKind: 'stream-json', cwd });
    const live = await rejection(host.forget(id));
    expect(live.code).toBe('session-live');
    await host.stop(id);
    await host.forget(id);
    expect(host.list()).toEqual([]);
    expect(await readOwnedState(ownedStatePath(configDir))).toEqual([]);
    expect(() => host.get(id)).toThrow(/no owned session/);
  });

  it('says unknown-session with a hint for an id it does not own', async () => {
    const { host } = await setup();
    const error = await rejection(host.send('not-there', { text: 'x', images: [] }));
    expect(error.code).toBe('unknown-session');
    expect(error.fix).toContain('GET /sessions');
  });
});

describe('shutdown and restart', () => {
  it('closes every child at shutdown, records them as closed by the daemon, and a new host lists them as exited (not interrupted)', async () => {
    const first = await setup();
    const a = await first.host.launch({ hostKind: 'stream-json', cwd: first.cwd });
    const b = await first.host.launch({ hostKind: 'stream-json', cwd: first.cwd });
    const result = await first.host.shutdown();
    expect(result.closed.sort()).toEqual([a.id, b.id].sort());
    expect(result.failed).toEqual([]);
    for (const session of first.started) {
      expect(session.exitInfo?.cause).toBe('closed');
    }
    expect((await rejection(first.host.launch({ hostKind: 'stream-json', cwd: first.cwd }))).code).toBe('host-stopping');
    const second = await setup({ configDir: first.configDir });
    const views = second.host.list();
    expect(views).toHaveLength(2);
    for (const view of views) {
      expect(view).toMatchObject({ state: 'exited', resumable: true, exit: expect.objectContaining({ by: 'daemon-shutdown' }) });
      expect(view.note).toContain('closed when the daemon stopped');
    }
  });

  it('kills a child that ignores the end of stdin and reports it, never hanging the shutdown', async () => {
    const { host, cwd, started } = await setup({ closeTimeoutMs: 300, claude: { command: process.execPath, commandArgs: [FAKE_CLAUDE], env: { ...process.env, FAKE_CLAUDE_HANG_ON_CLOSE: '1' } } });
    await host.launch({ hostKind: 'stream-json', cwd });
    const result = await host.shutdown();
    expect(result.failed).toEqual([]);
    expect(started[0]?.exitInfo?.cause).toBe('killed');
  });

  it('lists a session that the file says was live as interrupted, with a note that the turn is not replayed, and resumes it on request', async () => {
    const first = await setup();
    const { id } = await first.host.launch({ hostKind: 'stream-json', cwd: first.cwd, model: 'haiku' });
    // What a crash leaves behind: the file as the launch wrote it (live). The state of the second host is a copy; the first host is then closed.
    const crashedFile = readFileSync(ownedStatePath(first.configDir), 'utf8');
    await first.host.shutdown();
    const root = tempDir();
    const configDir = join(root, 'config');
    mkdirSync(configDir, { recursive: true });
    const written = JSON.parse(crashedFile) as { sessions: OwnedSessionRecord[] };
    // The pid of the old child ended: point the record at a pid that is not alive.
    written.sessions[0]!.pid = first.started[0]?.pid ?? 0;
    writeFileSync(ownedStatePath(configDir), JSON.stringify(written));
    const second = await setup({ configDir });
    const interrupted = second.host.get(id);
    expect(interrupted).toMatchObject({ state: 'interrupted', status: 'interrupted', resumable: true });
    expect(interrupted.interruptedAt).toBeGreaterThan(0);
    expect(interrupted.note).toContain('NOT replayed');
    expect(second.host.events.replay(undefined).events.map((event) => event.type)).toContain('session.interrupted');
    expect((await readOwnedState(ownedStatePath(configDir)))[0]?.status).toBe('interrupted');
    const refused = await rejection(second.host.send(id, { text: 'hi', images: [] }));
    expect(refused.code).toBe('session-not-live');
    expect(refused.reason).toContain('interrupted');
    const resumed = await second.host.resume(id);
    expect(resumed).toMatchObject({ id, state: 'idle', status: 'live' });
    expect(resumed.interruptedAt).toBeUndefined();
  });

  it('refuses to resume while the old child pid is alive, unless the caller acknowledges the leftover', async () => {
    const configDir = join(tempDir(), 'config');
    mkdirSync(configDir, { recursive: true });
    const record: OwnedSessionRecord = { id: 'aaaaaaaa-0000-4000-8000-000000000001', hostKind: 'stream-json', cwd: tempDir(), claudeVersion: '9.9.9', startedAt: 1, status: 'live', pid: process.pid, daemonPid: 1 };
    writeFileSync(ownedStatePath(configDir), JSON.stringify({ version: 1, sessions: [record] }));
    const warnings: string[] = [];
    const { host } = await setup({ configDir, onWarning: (text) => warnings.push(text) });
    expect(host.get(record.id).leftoverPid).toBe(process.pid);
    expect(host.status().leftovers).toBe(1);
    expect(warnings.join('\n')).toContain(`process ${process.pid}`);
    const refused = await rejection(host.resume(record.id));
    expect(refused.code).toBe('leftover-alive');
    expect(refused.fix).toContain('acknowledgeLeftover');
    const resumed = await host.resume(record.id, { acknowledgeLeftover: true });
    expect(resumed.state).toBe('idle');
  });

  it('does not start on a corrupt state file: a loud error with the path and the fix, and the file is left untouched', async () => {
    const configDir = join(tempDir(), 'config');
    mkdirSync(configDir, { recursive: true });
    const path = ownedStatePath(configDir);
    writeFileSync(path, '{"version":1,"sessions":[{"id":');
    const { host } = await setup({ configDir, init: false });
    const error = await rejection(host.init());
    expect(error.code).toBe('state-file-unreadable');
    expect(getErrorMessage(error)).toContain(path);
    expect(error.fix).toContain('never empties');
    expect(readFileSync(path, 'utf8')).toBe('{"version":1,"sessions":[{"id":');
  });
});

describe('hc (X3)', () => {
  function stubLauncher(calls: unknown[]): HcLauncherLike {
    return {
      launch: (request) => {
        calls.push(request);
        return Promise.resolve({
          address: 't7',
          name: request.name,
          cwd: request.cwd,
          session: { sessionId: 'hhhhhhhh-0000-4000-8000-000000000001', pid: 1, alive: true } as never,
          linkedAfterMs: 5,
        });
      },
    };
  }

  it('launches through the hc launcher, records the terminal, and refuses the owned-session actions with a pointer to the hc transport', async () => {
    const calls: unknown[] = [];
    const { host, cwd, configDir } = await setup({ hcLauncher: stubLauncher(calls) });
    const view = await host.launch({ hostKind: 'hc', cwd, model: 'haiku', permissionMode: 'default', name: 'mine' });
    expect(calls).toEqual([{ cwd, name: 'mine', args: ['--model', 'haiku', '--permission-mode', 'default'] }]);
    expect(view).toMatchObject({ id: 'hhhhhhhh-0000-4000-8000-000000000001', hostKind: 'hc', hcAddress: 't7', state: 'unobserved', resumable: false, status: 'live' });
    expect(view.note).toContain('hc reply transport');
    const actions = [() => host.send(view.id, { text: 'x', images: [] }), () => host.interrupt(view.id), () => host.stop(view.id), () => host.resume(view.id), () => host.setPermissionMode(view.id, 'plan')];
    for (const action of actions) {
      const error = await rejection(action());
      expect(error.code).toBe('not-owned');
      expect(error.fix).toContain('hc');
    }
    expect(() => host.permissions(view.id)).toThrow(/hc session/);
    // The file keeps an hc session live across a restart: it is not ours, the daemon cannot say it ended.
    const again = await setup({ configDir });
    expect(again.host.get(view.id)).toMatchObject({ status: 'live', state: 'unobserved' });
  });

  it('generates a terminal name when none is given', async () => {
    const calls: { name: string }[] = [];
    const { host, cwd } = await setup({ hcLauncher: stubLauncher(calls) });
    await host.launch({ hostKind: 'hc', cwd });
    expect(calls[0]?.name).toMatch(/^am-[0-9a-f]{8}$/);
  });

  it('an unavailable hc is a visible error with the fix, and nothing is recorded', async () => {
    const { host, cwd } = await setup({ hcLauncher: new HcLauncher({ command: 'agent-manager-no-such-hc' }) });
    const error = await rejection(host.launch({ hostKind: 'hc', cwd }));
    expect(error.fix).toContain('herdr-core');
    expect(host.list()).toEqual([]);
  });
});
