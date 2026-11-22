// Regression tests of the review of Phase 2: starts that overlap, a stop that races a start, a stop that fails, the read-only check, the events' content.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { deadPid, removeDir } from '../../testFixtures.js';
import { LaunchError } from '../errors.js';
import { StreamJsonSession } from '../StreamJsonSession.js';
import type { StreamJsonSessionOptions } from '../StreamJsonSession.js';
import { SessionHost } from './SessionHost.js';
import type { SessionHostOptions } from './SessionHost.js';
import { ownedStatePath } from './stateFile.js';
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

interface Fixture {
  host: SessionHost;
  cwd: string;
  configDir: string;
  started: StreamJsonSession[];
}

/** A host on the fake claude; `claude --version` takes `versionDelayMs`, which is the window the reviewed races needed. */
async function setup(options: Partial<SessionHostOptions> & { versionDelayMs?: number; configDir?: string } = {}): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'agent-manager-review-'));
  dirs.push(root);
  const configDir = options.configDir ?? join(root, 'config');
  const cwd = join(root, 'project');
  mkdirSync(cwd, { recursive: true });
  const started: StreamJsonSession[] = [];
  const { versionDelayMs, configDir: ignored, ...rest } = options;
  void ignored;
  const host = new SessionHost({
    configDir,
    claude: { command: process.execPath, commandArgs: [FAKE_CLAUDE] },
    closeTimeoutMs: 3000,
    readVersion: async () => {
      await new Promise((resolve) => setTimeout(resolve, versionDelayMs ?? 0));
      return '9.9.9 (Claude Code fake)';
    },
    startSession: async (sessionOptions: StreamJsonSessionOptions) => {
      const session = await StreamJsonSession.start(sessionOptions);
      started.push(session);
      return session;
    },
    ...rest,
  });
  hosts.push(host);
  await host.init();
  return { host, cwd, configDir, started };
}

function until(host: SessionHost, predicate: (event: HostEvent) => boolean, what: string): Promise<HostEvent> {
  const already = host.events.replay(undefined).events.find(predicate);
  if (already !== undefined) {
    return Promise.resolve(already);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`timed out waiting for ${what}`));
    }, 20_000);
    const unsubscribe = host.events.subscribe((event) => {
      if (predicate(event)) {
        clearTimeout(timer);
        unsubscribe();
        resolve(event);
      }
    });
  });
}

function errorOf(result: PromiseSettledResult<unknown>): LaunchError {
  if (result.status === 'fulfilled' || !(result.reason instanceof LaunchError)) {
    throw new Error(`expected a LaunchError rejection, got ${JSON.stringify(result)}`);
  }
  return result.reason;
}

describe('starts that overlap (review 1, 2)', () => {
  it('two launches together cannot exceed the live limit: one child, one refusal', async () => {
    const { host, cwd, started } = await setup({ maxLiveSessions: 1, versionDelayMs: 150 });
    const results = await Promise.allSettled([host.launch({ hostKind: 'stream-json', cwd }), host.launch({ hostKind: 'stream-json', cwd })]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(errorOf(results.find((result) => result.status === 'rejected') as PromiseSettledResult<unknown>).code).toBe('too-many-sessions');
    expect(started).toHaveLength(1);
    expect(host.list()).toHaveLength(1);
  });

  it('two launches together cannot exceed the size of the list either', async () => {
    const { host, cwd } = await setup({ maxRecords: 1, versionDelayMs: 150 });
    const results = await Promise.allSettled([host.launch({ hostKind: 'stream-json', cwd }), host.launch({ hostKind: 'stream-json', cwd })]);
    expect(results.filter((result) => result.status === 'rejected').map((result) => errorOf(result).code)).toEqual(['session-list-full']);
  });

  it('a slot of a failed start is given back', async () => {
    const { host, cwd } = await setup({ maxLiveSessions: 1, readVersion: () => Promise.reject(new LaunchError('claude-missing', 'no claude', 'install it')) });
    for (let attempt = 0; attempt < 3; attempt++) {
      const failure = await host.launch({ hostKind: 'stream-json', cwd }).catch((error: unknown) => error);
      expect((failure as LaunchError).code).toBe('claude-missing');
    }
  });

  it('two resumes of the same session together start one child on the conversation', async () => {
    const { host, cwd, started } = await setup({ versionDelayMs: 150 });
    const { id } = await host.launch({ hostKind: 'stream-json', cwd });
    await host.stop(id);
    const before = started.length;
    const results = await Promise.allSettled([host.resume(id), host.resume(id)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(errorOf(results.find((result) => result.status === 'rejected') as PromiseSettledResult<unknown>).code).toBe('already-live');
    expect(started.length - before).toBe(1);
  });

  it('a shutdown that begins during `claude --version` lets no child start afterwards', async () => {
    const { host, cwd, started } = await setup({ versionDelayMs: 300 });
    const launching = host.launch({ hostKind: 'stream-json', cwd }).catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await host.shutdown();
    expect(((await launching) as LaunchError).code).toBe('host-stopping');
    expect(started).toHaveLength(0);
    expect(host.list()).toEqual([]);
  });

  it('the same for a resume', async () => {
    let slowVersion = false;
    const { host, cwd, started } = await setup({
      readVersion: async () => {
        if (slowVersion) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
        return '9.9.9 (Claude Code fake)';
      },
    });
    const { id } = await host.launch({ hostKind: 'stream-json', cwd });
    await host.stop(id);
    slowVersion = true;
    const resuming = host.resume(id).catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await host.shutdown();
    expect(((await resuming) as LaunchError).code).toBe('host-stopping');
    expect(started).toHaveLength(1);
  });
});

describe('a stop that fails (review 7)', () => {
  it('forgets that the user asked for it: a later exit is the process own', async () => {
    const { host, cwd, started } = await setup();
    const { id } = await host.launch({ hostKind: 'stream-json', cwd });
    const session = started[0] as StreamJsonSession;
    const realClose = session.close.bind(session);
    // The process "does not end": close() fails like a kill that did not work.
    session.close = () => Promise.reject(new LaunchError('kill-failed', 'the process did not end', 'end it by hand'));
    await expect(host.stop(id)).rejects.toMatchObject({ code: 'kill-failed' });
    expect(host.get(id).state).toBe('idle');
    // It ends on its own later (here: the real close, called around the failing one).
    session.close = realClose;
    await realClose();
    const exit = await until(host, (event) => event.type === 'session.exit', 'exit');
    expect(exit.data['by']).toBe('self');
  });
});

describe('check() (review 3)', () => {
  it('validates the file and changes nothing: a live record stays live until init', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-manager-check-'));
    dirs.push(root);
    const record: OwnedSessionRecord = { id: 'aaaaaaaa-0000-4000-8000-000000000002', hostKind: 'stream-json', cwd: root, claudeVersion: '9', startedAt: 1, status: 'live', pid: deadPid(), daemonPid: 1 };
    const path = ownedStatePath(root);
    const content = JSON.stringify({ version: 1, sessions: [record] });
    writeFileSync(path, content);
    const host = new SessionHost({ configDir: root });
    hosts.push(host);
    await host.check();
    expect(readFileSync(path, 'utf8')).toBe(content);
    expect(host.list()).toEqual([]);
    await host.init();
    expect(host.get(record.id).state).toBe('interrupted');
  });

  it('a shutdown of a host that never read the file does not write the empty list over it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-manager-check-'));
    dirs.push(root);
    const record: OwnedSessionRecord = { id: 'aaaaaaaa-0000-4000-8000-000000000004', hostKind: 'stream-json', cwd: root, claudeVersion: '9', startedAt: 1, status: 'live', pid: deadPid(), daemonPid: 1 };
    const path = ownedStatePath(root);
    const content = JSON.stringify({ version: 1, sessions: [record] });
    writeFileSync(path, content);
    const host = new SessionHost({ configDir: root });
    hosts.push(host);
    await host.shutdown();
    expect(readFileSync(path, 'utf8')).toBe(content);
  });

  it('fails on a corrupt file like init does, without touching it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-manager-check-'));
    dirs.push(root);
    writeFileSync(ownedStatePath(root), '{bad');
    const host = new SessionHost({ configDir: root });
    hosts.push(host);
    await expect(host.check()).rejects.toMatchObject({ code: 'state-file-unreadable' });
    expect(readFileSync(ownedStatePath(root), 'utf8')).toBe('{bad');
  });
});

describe('what the events carry (review 10)', () => {
  it('exit and protocol errors name the cause only: no stderr, no excerpt of the output of claude', async () => {
    const { host, cwd } = await setup();
    const { id } = await host.launch({ hostKind: 'stream-json', cwd });
    await host.send(id, { text: 'GARBAGE', images: [] });
    const warning = await until(host, (event) => event.type === 'session.warning' && event.data['code'] === 'bad-json', 'a protocol warning');
    expect(warning.data).toEqual({ code: 'bad-json' });
    await host.send(id, { text: 'CRASH', images: [] });
    const exit = await until(host, (event) => event.type === 'session.exit', 'exit');
    expect(Object.keys(exit.data).sort()).toEqual(['by', 'cause', 'code', 'signal']);
    const everything = JSON.stringify(host.events.replay(undefined).events);
    expect(everything).not.toContain('this is not json');
    expect(everything).not.toContain('boom');
    // The report stays available for the consumer that refetches the session.
    expect(host.get(id).exit?.stderrTail).toContain('boom');
  });
});
