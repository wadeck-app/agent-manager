import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { removeDir } from '../../testFixtures.js';
import { BgLauncher } from '../BgLauncher.js';
import { LaunchError } from '../errors.js';
import { hostAuditFile } from './hostAudit.js';
import { SessionHost, bgOwnedState } from './SessionHost.js';
import type { SessionHostOptions } from './SessionHost.js';
import { ownedStatePath, readOwnedState } from './stateFile.js';
import type { HostEvent } from './types.js';

const FAKE_BG = fileURLToPath(new URL('../testSupport/fakeBgClaude.mjs', import.meta.url));
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

interface Agent {
  id: string;
  cwd: string;
  kind: string;
  sessionId?: string;
  state?: string;
  status?: string;
  waitingFor?: string;
  pid?: number;
}

interface Fixture {
  host: SessionHost;
  configDir: string;
  cwd: string;
  statePath: string;
  logPath: string;
  /** A second host on the same files (a daemon restart). */
  another: (options?: Partial<SessionHostOptions>) => Promise<SessionHost>;
  agents: () => Agent[];
  edit: (change: (agents: Agent[]) => Agent[]) => void;
}

async function setup(env: Record<string, string> = {}, options: Partial<SessionHostOptions> = {}): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'agent-manager-bghost-'));
  dirs.push(root);
  const configDir = join(root, 'config');
  const cwd = join(root, 'project');
  mkdirSync(cwd, { recursive: true });
  const statePath = join(root, 'agents.json');
  const logPath = join(root, 'calls.ndjson');
  const fakeEnv = { ...process.env, FAKE_BG_STATE: statePath, FAKE_BG_LOG: logPath, ...env };
  const make = async (extra: Partial<SessionHostOptions> = {}): Promise<SessionHost> => {
    const host = new SessionHost({
      configDir,
      claude: { command: process.execPath, commandArgs: [FAKE_CLAUDE] },
      bgLauncher: new BgLauncher({ command: process.execPath, commandArgs: [FAKE_BG], env: fakeEnv, pollIntervalMs: 20, linkTimeoutMs: 1500, commandTimeoutMs: 3000, listTimeoutMs: 3000 }),
      bgObserveIntervalMs: 60_000,
      ...options,
      ...extra,
    });
    hosts.push(host);
    await host.init();
    return host;
  };
  const host = await make();
  const read = (): Agent[] => (JSON.parse(readFileSync(statePath, 'utf8')) as { agents: Agent[] }).agents;
  return {
    host,
    configDir,
    cwd,
    statePath,
    logPath,
    another: make,
    agents: read,
    edit: (change) => writeFileSync(statePath, JSON.stringify({ agents: change(read()) })),
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

const types = (host: SessionHost): string[] => host.events.replay(undefined).events.map((event) => event.type);
const eventsOf = (host: SessionHost, type: string): HostEvent[] => host.events.replay(undefined).events.filter((event) => event.type === type);
const calls = (logPath: string): string[] =>
  readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => (JSON.parse(line) as { argv: string[] }).argv.join(' '));

describe('bgOwnedState', () => {
  it.each([
    [{ state: 'working', status: 'busy' }, 'running'],
    [{ state: 'blocked', status: 'waiting', waitingFor: 'permission prompt' }, 'requires_action'],
    [{ state: 'blocked', status: 'waiting' }, 'requires_action'],
    [{ state: 'blocked', status: 'idle' }, 'idle'],
    // Measured: the supervisor state can stay working long after the process went idle.
    [{ state: 'working', status: 'idle' }, 'idle'],
    [{ state: 'blocked', status: 'busy' }, 'running'],
    [{ state: 'done' }, 'idle'],
    [{ state: 'failed' }, 'exited'],
    [{ state: 'stopped' }, 'exited'],
    [{ state: 'something-new' }, 'unobserved'],
    [{}, 'unobserved'],
  ])('maps %j to %s', (entry, expected) => {
    expect(bgOwnedState({ id: 'abcdef12', cwd: 'x', kind: 'background', ...entry })).toBe(expected);
  });
});

describe('launch (bg)', () => {
  it('starts through claude --bg, records the job and the session id, and observes it', async () => {
    const { host, configDir, cwd, logPath } = await setup();
    const view = await host.launch({ hostKind: 'bg', cwd, model: 'haiku', permissionMode: 'default', name: 'am-first' });
    expect(view).toMatchObject({ hostKind: 'bg', cwd, model: 'haiku', permissionMode: 'default', name: 'am-first', status: 'live', resumable: false, pendingPermissions: 0 });
    expect(view.jobId).toMatch(/^[0-9a-f]{8}$/);
    expect(view.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(view.attachCommand).toBe(`claude attach ${view.jobId}`);
    await host.pollBg();
    expect(host.get(view.id)).toMatchObject({ state: 'idle', bgState: 'blocked' });
    const records = await readOwnedState(ownedStatePath(configDir));
    expect(records[0]).toMatchObject({ id: view.id, hostKind: 'bg', jobId: view.jobId, status: 'live' });
    expect(calls(logPath)[0]).toBe('--bg --model haiku --permission-mode default --name am-first');
    expect(types(host)).toContain('session.launched');
    const audit = readFileSync(hostAuditFile(configDir, Date.now()), 'utf8');
    expect(audit).toContain('"action":"launch"');
    expect(audit).not.toContain('"text"');
  });

  it('gives a name when none is asked, so the session can be found in claude agents', async () => {
    const { host, cwd } = await setup();
    expect((await host.launch({ hostKind: 'bg', cwd })).name).toMatch(/^am-[0-9a-f]{8}$/);
  });

  it('does not count against the live limit of the owned children', async () => {
    const { host, cwd } = await setup({}, { maxLiveSessions: 1 });
    await host.launch({ hostKind: 'bg', cwd });
    await host.launch({ hostKind: 'bg', cwd });
    expect(host.list()).toHaveLength(2);
  });

  it('refuses an untrusted folder with the fix and records nothing', async () => {
    const { host, cwd, configDir } = await setup({ FAKE_BG_UNTRUSTED: '1' });
    const error = await rejection(host.launch({ hostKind: 'bg', cwd }));
    expect(error.code).toBe('workspace-not-trusted');
    expect(host.list()).toEqual([]);
    expect(await readOwnedState(ownedStatePath(configDir))).toEqual([]);
  });

  it('keeps nothing and names the job to stop when the link to the registry times out', async () => {
    const { host, cwd } = await setup({ FAKE_BG_NEVER_LISTED: '1' });
    const error = await rejection(host.launch({ hostKind: 'bg', cwd }));
    expect(error.code).toBe('bg-session-not-listed');
    expect(error.fix).toMatch(/claude stop [0-9a-f]{8}/);
    expect(host.list()).toEqual([]);
  });
});

describe('observing (bg)', () => {
  it('follows working, a permission prompt and the return to idle, with events', async () => {
    const { host, cwd, edit } = await setup();
    const { id, jobId } = await host.launch({ hostKind: 'bg', cwd });
    edit((agents) => agents.map((agent) => (agent.id === jobId ? { ...agent, state: 'working', status: 'busy' } : agent)));
    await host.pollBg();
    expect(host.get(id)).toMatchObject({ state: 'running', bgState: 'working' });
    edit((agents) => agents.map((agent) => (agent.id === jobId ? { ...agent, state: 'blocked', status: 'waiting', waitingFor: 'permission prompt' } : agent)));
    await host.pollBg();
    const waiting = host.get(id);
    expect(waiting).toMatchObject({ state: 'requires_action', waitingFor: 'permission prompt', pendingPermissions: 0, attachCommand: `claude attach ${jobId}` });
    expect(eventsOf(host, 'session.bg_waiting')).toHaveLength(1);
    expect(eventsOf(host, 'session.bg_waiting')[0]?.data).toEqual({ waitingFor: 'permission prompt', attachCommand: `claude attach ${jobId}` });
    // The same state again says nothing more: no event storm.
    const count = eventsOf(host, 'session.state').length;
    await host.pollBg();
    expect(eventsOf(host, 'session.state')).toHaveLength(count);
    edit((agents) => agents.map((agent) => (agent.id === jobId ? { ...agent, state: 'done', status: 'idle', waitingFor: undefined } : agent)));
    await host.pollBg();
    expect(host.get(id)).toMatchObject({ state: 'idle', bgState: 'done' });
    expect(host.get(id).waitingFor).toBeUndefined();
    const stateEvents = eventsOf(host, 'session.state').map((event) => event.data['state']);
    expect(stateEvents).toEqual(['running', 'requires_action', 'idle']);
  });

  it('shows a stop made in a terminal as exited by the session itself, resumable', async () => {
    const { host, cwd, edit } = await setup();
    const { id, jobId } = await host.launch({ hostKind: 'bg', cwd });
    edit((agents) => agents.map((agent) => (agent.id === jobId ? { id: agent.id, cwd: agent.cwd, kind: agent.kind, sessionId: agent.sessionId, state: 'stopped' } : agent)));
    await host.pollBg();
    expect(host.get(id)).toMatchObject({ state: 'exited', status: 'exited', resumable: true, exit: { by: 'self', cause: 'closed' } });
    expect(types(host)).toContain('session.exit');
  });

  it('says so when the supervisor no longer lists the session', async () => {
    const { host, cwd, edit } = await setup();
    const { id } = await host.launch({ hostKind: 'bg', cwd });
    edit(() => []);
    await host.pollBg();
    const view = host.get(id);
    expect(view.state).toBe('exited');
    expect(view.exit?.stderrTail).toMatch(/no longer lists this session/);
  });

  it('keeps the last state, warns once and shows the cause while claude agents fails, then recovers', async () => {
    const { host, cwd, another } = await setup();
    const { id } = await host.launch({ hostKind: 'bg', cwd });
    await host.pollBg();
    const broken = await another({
      bgLauncher: new BgLauncher({ command: process.execPath, commandArgs: [FAKE_BG], env: { ...process.env, FAKE_BG_STATE: join(tmpdir(), 'x.json'), FAKE_BG_FAIL: 'agents' }, commandTimeoutMs: 2000, listTimeoutMs: 2000 }),
    });
    await broken.pollBg();
    await broken.pollBg();
    expect(broken.get(id)).toMatchObject({ state: 'unobserved' });
    expect(broken.get(id).observeError).toMatch(/fake failure of agents/);
    expect(eventsOf(broken, 'host.warning')).toHaveLength(1);
    expect(host.get(id).observeError).toBeUndefined();
  });

  it('polls only while a bg session is live, and never overlaps two polls (injected launcher, fake interval timers)', async () => {
    // Root cause of the earlier flake: the test counted real processes of the fake CLI in a real 400 ms window; one `claude agents` costs at least the 250 ms
    // exit drain plus a node start, so under load the window held one call. Here no process runs and only the timers are faked.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const agent = { id: 'abcd1234', cwd: 'x', kind: 'background', sessionId: '11111111-2222-4333-8444-555555555555', state: 'blocked', status: 'idle' };
      let lists = 0;
      let release: () => void = () => undefined;
      let gate: Promise<void> = Promise.resolve();
      const stub = {
        launch: () => Promise.resolve({ jobId: agent.id, agent, linkedAfterMs: 1 }),
        list: async () => {
          lists++;
          await gate;
          return [agent];
        },
        stop: () => Promise.resolve(),
        respawn: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      };
      const { host, cwd } = await setup({}, { bgLauncher: stub, bgObserveIntervalMs: 40 });
      // The first list (started by the launch) never answers until released: the next ticks must not start another one.
      gate = new Promise((resolve) => {
        release = resolve;
      });
      const { id } = await host.launch({ hostKind: 'bg', cwd });
      expect(lists).toBe(1);
      await vi.advanceTimersByTimeAsync(400);
      expect(lists).toBe(1);
      release();
      gate = Promise.resolve();
      await vi.advanceTimersByTimeAsync(40);
      expect(lists).toBe(2);
      await vi.advanceTimersByTimeAsync(80);
      expect(lists).toBe(4);
      // Stopped: no live bg session, so no timer is left and no list is asked.
      await host.stop(id);
      const afterStop = lists;
      await vi.advanceTimersByTimeAsync(1000);
      expect(lists).toBe(afterStop);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('stop, resume, forget (bg)', () => {
  it('stops with claude stop, records who stopped it and resumes with claude respawn', async () => {
    const { host, cwd, logPath, agents, configDir } = await setup();
    const { id, jobId } = await host.launch({ hostKind: 'bg', cwd });
    const stopped = await host.stop(id);
    expect(stopped).toMatchObject({ state: 'exited', status: 'exited', resumable: true, exit: { by: 'user', cause: 'closed' } });
    expect(agents().find((agent) => agent.id === jobId)?.state).toBe('stopped');
    expect(calls(logPath)).toContain(`stop ${jobId}`);
    expect((await readOwnedState(ownedStatePath(configDir)))[0]).toMatchObject({ status: 'exited' });
    // Stopping twice is a clear refusal.
    expect((await rejection(host.stop(id))).code).toBe('session-not-live');
    const resumed = await host.resume(id);
    expect(resumed).toMatchObject({ status: 'live', resumable: false });
    expect(resumed.exit).toBeUndefined();
    expect(calls(logPath)).toContain(`respawn ${jobId}`);
    await host.pollBg();
    expect(host.get(id).state).toBe('idle');
    expect((await rejection(host.resume(id))).code).toBe('already-live');
  });

  it('refuses to forget a live session, forgets an ended one with claude rm, and skips rm for one the supervisor lost', async () => {
    const { host, cwd, logPath, agents, edit } = await setup();
    const first = await host.launch({ hostKind: 'bg', cwd });
    expect((await rejection(host.forget(first.id))).code).toBe('session-live');
    await host.stop(first.id);
    await host.forget(first.id);
    expect(calls(logPath)).toContain(`rm ${first.jobId}`);
    expect(agents().find((agent) => agent.id === first.jobId)).toBeUndefined();
    expect(host.list()).toEqual([]);
    const second = await host.launch({ hostKind: 'bg', cwd });
    await host.stop(second.id);
    edit(() => []);
    await host.forget(second.id);
    expect(calls(logPath).filter((line) => line.startsWith(`rm ${second.jobId}`))).toEqual([]);
  });

  it('removes the record even when claude rm fails, and says so (supervisorNote)', async () => {
    const { host, cwd } = await setup({ FAKE_BG_FAIL: 'rm' });
    const { id, jobId } = await host.launch({ hostKind: 'bg', cwd });
    await host.stop(id);
    const result = await host.forget(id);
    expect(result.supervisorNote).toMatch(/fake failure of rm.*claude rm /s);
    expect(result.supervisorNote).toContain(jobId);
    expect(host.list()).toEqual([]);
  });

  it('keeps the session live and says why when claude stop fails', async () => {
    const { host, cwd } = await setup({ FAKE_BG_FAIL: 'stop' });
    const { id } = await host.launch({ hostKind: 'bg', cwd });
    expect((await rejection(host.stop(id))).code).toBe('bg-command-failed');
    expect(host.get(id).status).toBe('live');
  });
});

describe('what a bg session does not do', () => {
  it('refuses send, interrupt, permission mode and permission answers with the terminal command', async () => {
    const { host, cwd } = await setup();
    const { id, jobId } = await host.launch({ hostKind: 'bg', cwd });
    const attempts: (() => Promise<unknown>)[] = [
      () => host.send(id, { text: 'hi', images: [] }),
      () => host.interrupt(id),
      () => host.setPermissionMode(id, 'plan'),
      () => host.decide(id, 'req1', { decision: 'allow', message: '' }),
      () => Promise.resolve().then(() => host.permissions(id)),
    ];
    for (const attempt of attempts) {
      const error = await rejection(attempt());
      expect(error.code).toBe('not-owned');
      expect(error.reason).toContain('background session');
      expect(error.fix).toContain(`claude attach ${jobId}`);
    }
  });
});

describe('daemon restart and shutdown (bg)', () => {
  it('leaves bg sessions live across a restart (they are not interrupted) and observes them again', async () => {
    const { host, cwd, another, edit } = await setup();
    const { id, jobId } = await host.launch({ hostKind: 'bg', cwd });
    await host.shutdown();
    const second = await another();
    expect(second.get(id)).toMatchObject({ status: 'live', state: expect.stringMatching(/unobserved|idle/) });
    edit((agents) => agents.map((agent) => (agent.id === jobId ? { ...agent, state: 'working', status: 'busy' } : agent)));
    await second.pollBg();
    expect(second.get(id).state).toBe('running');
    expect(types(second)).not.toContain('session.interrupted');
  });

  it('does not stop the sessions of the supervisor at shutdown', async () => {
    const { host, cwd, logPath, agents } = await setup();
    const { jobId } = await host.launch({ hostKind: 'bg', cwd });
    const result = await host.shutdown();
    expect(result.failed).toEqual([]);
    expect(calls(logPath).some((line) => line.startsWith('stop'))).toBe(false);
    expect(agents().find((agent) => agent.id === jobId)?.state).toBe('blocked');
  });

  it('refuses a state file with a bg record that has no job id, naming the file', async () => {
    const { host, cwd, configDir, another } = await setup();
    await host.launch({ hostKind: 'bg', cwd });
    await host.shutdown();
    const path = ownedStatePath(configDir);
    const file = JSON.parse(readFileSync(path, 'utf8')) as { sessions: Record<string, unknown>[] };
    delete file.sessions[0]?.['jobId'];
    writeFileSync(path, JSON.stringify(file));
    await expect(another()).rejects.toThrow(/jobId is required for a bg session/);
  });
});

/** A launcher without processes: the test decides what `list` answers, and when each call may finish. */
function stubLauncher() {
  const id = 'abcd1234';
  const stub = {
    agents: [{ id, cwd: 'x', kind: 'background', sessionId: '11111111-2222-4333-8444-555555555555', state: 'blocked', status: 'idle' }] as Agent[],
    lists: 0,
    calls: [] as string[],
    listGate: undefined as Promise<void> | undefined,
    respawnGate: undefined as Promise<void> | undefined,
    listError: undefined as Error | undefined,
    removeError: undefined as Error | undefined,
    launch: () => Promise.resolve({ jobId: id, agent: { ...stub.agents[0]!, sessionId: '11111111-2222-4333-8444-555555555555' }, linkedAfterMs: 1 }),
    list: async () => {
      stub.lists++;
      await stub.listGate;
      if (stub.listError !== undefined) {
        throw stub.listError;
      }
      return stub.agents.map((agent) => ({ ...agent }));
    },
    stop: () => {
      stub.calls.push('stop');
      stub.agents = stub.agents.map((agent) => ({ id: agent.id, cwd: agent.cwd, kind: agent.kind, sessionId: agent.sessionId, state: 'stopped' }));
      return Promise.resolve();
    },
    respawn: async () => {
      stub.calls.push('respawn');
      await stub.respawnGate;
    },
    remove: () => {
      stub.calls.push('rm');
      if (stub.removeError !== undefined) {
        return Promise.reject(stub.removeError);
      }
      stub.agents = [];
      return Promise.resolve();
    },
  };
  return stub;
}

function gate(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe('races and failures of the bg host (injected launcher, fake timers, no real sleep)', () => {
  const withFakeTimers = async (work: () => Promise<void>): Promise<void> => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await work();
    } finally {
      vi.useRealTimers();
    }
  };

  it('drops the answer of a poll that began before a stop and a respawn (no grace period: the generation alone protects)', async () => {
    await withFakeTimers(async () => {
      const stub = stubLauncher();
      const { host, cwd } = await setup({}, { bgLauncher: stub, bgObserveIntervalMs: 60_000, bgRespawnGraceMs: 0 });
      // The poll that the launch starts is held: its answer is "stopped", old by the time it arrives.
      const held = gate();
      stub.listGate = held.promise;
      const { id } = await host.launch({ hostKind: 'bg', cwd });
      await host.stop(id);
      stub.listGate = undefined;
      await host.resume(id);
      held.open();
      await vi.advanceTimersByTimeAsync(0);
      expect(stub.lists).toBe(1);
      expect(host.get(id)).toMatchObject({ status: 'live' });
      expect(host.get(id).exit).toBeUndefined();
    });
  });

  it('ignores a stopped snapshot during the grace period after a respawn, then believes it', async () => {
    await withFakeTimers(async () => {
      const stub = stubLauncher();
      let now = 1_000_000;
      const { host, cwd } = await setup({}, { bgLauncher: stub, bgObserveIntervalMs: 60_000, bgRespawnGraceMs: 10_000, clock: () => now });
      const { id } = await host.launch({ hostKind: 'bg', cwd });
      await vi.advanceTimersByTimeAsync(0);
      await host.stop(id);
      // The stub keeps saying "stopped" after the respawn, like a supervisor that has not caught up.
      await host.resume(id);
      await host.pollBg();
      expect(host.get(id)).toMatchObject({ status: 'live' });
      now += 11_000;
      await host.pollBg();
      expect(host.get(id)).toMatchObject({ status: 'exited', exit: { by: 'self' } });
    });
  });

  it('matches job ids without regard to case', async () => {
    await withFakeTimers(async () => {
      const stub = stubLauncher();
      const { host, cwd } = await setup({}, { bgLauncher: stub, bgObserveIntervalMs: 60_000 });
      const { id } = await host.launch({ hostKind: 'bg', cwd });
      await vi.advanceTimersByTimeAsync(0);
      stub.agents = [{ ...stub.agents[0]!, id: 'ABCD1234', state: 'working', status: 'busy' }];
      await host.pollBg();
      expect(host.get(id).state).toBe('running');
      await host.stop(id);
      stub.agents = [{ ...stub.agents[0]!, id: 'ABCD1234' }];
      await host.forget(id);
      expect(stub.calls).toContain('rm');
    });
  });

  it('forgets the record whatever the supervisor does, and says what it could not do', async () => {
    await withFakeTimers(async () => {
      const cases: [string, (stub: ReturnType<typeof stubLauncher>) => void, RegExp][] = [
        ['claude agents fails', (stub) => (stub.listError = new Error('agents is down')), /agents is down.*claude rm abcd1234/s],
        ['claude rm fails', (stub) => (stub.removeError = new Error('worktree refused')), /worktree refused.*claude rm abcd1234/s],
        ['the supervisor lost the job', (stub) => (stub.agents = []), /does not list abcd1234/],
      ];
      for (const [label, arrange, expected] of cases) {
        const stub = stubLauncher();
        const { host, cwd, configDir } = await setup({}, { bgLauncher: stub, bgObserveIntervalMs: 60_000 });
        const { id } = await host.launch({ hostKind: 'bg', cwd });
        await host.stop(id);
        arrange(stub);
        const result = await host.forget(id);
        expect(result.supervisorNote, label).toMatch(expected);
        expect(host.list(), label).toEqual([]);
        expect(await readOwnedState(ownedStatePath(configDir)), label).toEqual([]);
      }
    });
  });

  it('serializes the actions of one record: stop and forget during a resume are refused, and the record stays', async () => {
    await withFakeTimers(async () => {
      const stub = stubLauncher();
      const { host, cwd } = await setup({}, { bgLauncher: stub, bgObserveIntervalMs: 60_000 });
      const { id } = await host.launch({ hostKind: 'bg', cwd });
      await host.stop(id);
      const held = gate();
      stub.respawnGate = held.promise;
      const resuming = host.resume(id);
      await vi.advanceTimersByTimeAsync(0);
      for (const action of [() => host.stop(id), () => host.forget(id), () => host.resume(id)]) {
        const error = await rejection(action());
        expect(error.code).toBe('bg-action-in-progress');
        expect(error.reason).toContain('being resumed');
      }
      held.open();
      expect(await resuming).toMatchObject({ status: 'live' });
      expect(host.list()).toHaveLength(1);
    });
  });

  it('refuses stop and forget while the host stops', async () => {
    await withFakeTimers(async () => {
      const stub = stubLauncher();
      const { host, cwd } = await setup({}, { bgLauncher: stub, bgObserveIntervalMs: 60_000 });
      const { id } = await host.launch({ hostKind: 'bg', cwd });
      await host.shutdown();
      expect((await rejection(host.stop(id))).code).toBe('host-stopping');
      expect((await rejection(host.forget(id))).code).toBe('host-stopping');
    });
  });

  it('backs off after failed polls (10, 20, 40, 60 s), says so in observeError, and goes back to the period after a success', async () => {
    await withFakeTimers(async () => {
      const stub = stubLauncher();
      stub.listError = new Error('claude agents is down');
      const { host, cwd } = await setup({}, { bgLauncher: stub, bgObserveIntervalMs: 5000 });
      const { id } = await host.launch({ hostKind: 'bg', cwd });
      await vi.advanceTimersByTimeAsync(0);
      expect(stub.lists).toBe(1);
      expect(host.get(id).observeError).toBe('claude agents is down (retrying in 10 s)');
      // The warning is said once, not once per poll.
      const waits = [10_000, 20_000, 40_000, 60_000, 60_000];
      let lists = 1;
      for (const [index, wait] of waits.entries()) {
        await vi.advanceTimersByTimeAsync(wait - 1);
        expect(stub.lists, `before the ${wait} ms wait ends`).toBe(lists);
        await vi.advanceTimersByTimeAsync(1);
        lists++;
        expect(stub.lists).toBe(lists);
        const next = waits[index + 1] ?? 60_000;
        expect(host.get(id).observeError).toBe(`claude agents is down (retrying in ${next / 1000} s)`);
      }
      expect(eventsOf(host, 'host.warning')).toHaveLength(1);
      stub.listError = undefined;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(host.get(id).observeError).toBeUndefined();
      lists = stub.lists;
      await vi.advanceTimersByTimeAsync(5000);
      expect(stub.lists).toBe(lists + 1);
    });
  });
});
