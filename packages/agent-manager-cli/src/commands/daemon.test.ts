import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Options } from '../args.js';
import type { Context } from '../command.js';
import { cleanupDaemons, fakeClaude, startTestDaemon } from '../daemon/daemonTestKit.js';
import { createControlClient } from '../daemon/daemonClient.js';
import { startDaemon } from '../daemon/runtime.js';
import { writePortFile } from '@wadeck-app/singleton-daemon-kit';
import { COMMAND_EXIT_CODES, EXIT, exitCodesOf } from '../exitCodes.js';
import { type Harness, makeHarness } from '../testHelpers.js';
import { DEFAULT_DAEMON_DEPS, createDaemonCommands, formatUptime, spawnDetachedProcess } from './daemon.js';
import type { SpawnSystem } from './daemon.js';
import type { DaemonCommandDeps } from './daemon.js';

/** A port on which nothing listens. */
function unusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

/** `AGENT_MANAGER_DAEMON_PORT=0`: the OS picks the ports, so a test never takes 47930 (nor finds a real daemon there). */
const ANY_PORT = { AGENT_MANAGER_DAEMON_PORT: '0' };

describe('agent-manager start | stop | status', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(async () => {
    await cleanupDaemons();
    h.cleanup();
  });

  describe('exit codes table', () => {
    it.each(['start', 'stop', 'status'])('%s: --help prints its exit codes, the same as the table', async (name) => {
      const result = await h.cli([name, '--help']);
      expect(result.code).toBe(0);
      expect(result.out).toContain('Exit codes:');
      for (const entry of COMMAND_EXIT_CODES[name] ?? []) {
        expect(result.out).toContain(`  ${entry.code}  ${entry.meaning}`);
      }
    });

    it('the table names exactly the commands that have codes, each with 0 and usage', () => {
      expect(Object.keys(COMMAND_EXIT_CODES).sort()).toEqual(['start', 'status', 'stop']);
      for (const entries of Object.values(COMMAND_EXIT_CODES)) {
        expect(entries.map((entry) => entry.code)).toEqual(expect.arrayContaining([EXIT.ok, EXIT.usage]));
      }
      expect(COMMAND_EXIT_CODES['status']?.map((entry) => entry.code)).toContain(EXIT.daemonUnreachable);
      expect(COMMAND_EXIT_CODES['start']?.map((entry) => entry.code)).toContain(EXIT.daemonUnreachable);
      expect(COMMAND_EXIT_CODES['stop']?.map((entry) => entry.code)).not.toContain(EXIT.daemonUnreachable);
      expect(EXIT).toEqual({ ok: 0, failure: 1, usage: 2, daemonUnreachable: 3, unexpected: 70 });
    });

    it('an unknown command key is an error, never an empty table', () => {
      expect(() => exitCodesOf('nope')).toThrow(/no exit codes are documented for the command 'nope'/);
      expect(() => exitCodesOf('constructor')).toThrow(/no exit codes are documented/);
      expect(exitCodesOf('start').length).toBeGreaterThan(0);
    });

    it('start exits 3 when a daemon seems to run (port file, live pid) but does not answer', async () => {
      // A port file of this very process on a port where nothing listens, and no token file: the daemon cannot be told from a stuck one.
      await writePortFile(h.configDir, await unusedPort(), process.pid);
      const result = await h.cli(['start'], { env: ANY_PORT });
      expect(result.code).toBe(EXIT.daemonUnreachable);
      expect(COMMAND_EXIT_CODES['start']?.map((entry) => entry.code)).toContain(result.code);
      expect(result.err).toContain('Fix:');
      expect(result.out).toBe('');
    });

    it('a wrong option is a usage error (2) for the three commands', async () => {
      for (const name of ['start', 'stop', 'status']) {
        expect((await h.cli([name, '--nope'])).code).toBe(EXIT.usage);
        expect((await h.cli([name, 'extra'])).code).toBe(EXIT.usage);
      }
    });
  });

  describe('when the daemon is not running', () => {
    it('status exits 3 with the fix, never a success, and prints nothing on stdout (also with --json)', async () => {
      for (const argv of [['status'], ['status', '--json']]) {
        const result = await h.cli(argv);
        expect(result.code).toBe(EXIT.daemonUnreachable);
        expect(result.out).toBe('');
        expect(result.err).toContain('the agent-manager daemon is not running');
        expect(result.err).toContain('Fix: start it with');
        expect(result.err).toContain(h.configDir);
      }
    });

    it('stop says there is nothing to stop and exits 0', async () => {
      const result = await h.cli(['stop']);
      expect(result.code).toBe(0);
      expect(result.out).toContain('The daemon is not running: nothing to stop');
      const json = await h.cli(['stop', '--json']);
      expect(JSON.parse(json.out)).toEqual({ ok: true, wasRunning: false });
    });

    it('start refuses an invalid AGENT_MANAGER_DAEMON_PORT (no silent default) with exit 1', async () => {
      for (const port of ['abc', '70000', '-1', '12.5']) {
        const result = await h.cli(['start'], { env: { AGENT_MANAGER_DAEMON_PORT: port } });
        expect(result.code).toBe(EXIT.failure);
        expect(result.err).toContain('AGENT_MANAGER_DAEMON_PORT');
        expect(result.err).toContain('Fix:');
      }
    });

    it('start does not start on an unreadable owned-sessions.json: exit 1, the path and the fix, the file untouched', async () => {
      const path = join(h.configDir, 'owned-sessions.json');
      writeFileSync(path, '{broken');
      const result = await h.cli(['start'], { env: ANY_PORT });
      expect(result.code).toBe(EXIT.failure);
      expect(result.err).toContain(path);
      expect(result.err).toContain('never empties it by itself');
      expect(readFileSync(path, 'utf8')).toBe('{broken');
      expect((await h.cli(['status'])).code).toBe(EXIT.daemonUnreachable);
    });
  });

  describe('with a running daemon', () => {
    it('start (foreground) runs the daemon, status and stop work, and start returns when it stops', async () => {
      const started = h.cli(['start'], { env: ANY_PORT });
      const client = createControlClient(h.configDir);
      for (let attempt = 0; attempt < 200 && !(await client.isRunning()); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const status = await h.cli(['status']);
      expect(status.code).toBe(0);
      expect(status.out).toContain('agent-manager daemon is running');
      expect(status.out).toContain(`pid:             ${process.pid}`);
      expect(status.out).toMatch(/port: +\d+ \(control\), \d+ \(sessions API and events\)/);
      expect(status.out).toMatch(/uptime: +\d+s/);
      expect(status.out).toContain('owned sessions:  0 (live 0');
      const json: unknown = JSON.parse((await h.cli(['status', '--json'])).out);
      expect(json).toMatchObject({ pid: process.pid, owned: { total: 0, live: 0 }, configDir: h.configDir });
      expect(JSON.stringify(json)).not.toContain(readFileSync(join(h.configDir, 'health_token'), 'utf8').trim());

      const again = await h.cli(['start'], { env: ANY_PORT });
      expect(again.code).toBe(0);
      expect(again.out).toContain('already running; nothing was started');

      const stopped = await h.cli(['stop']);
      expect(stopped.code).toBe(0);
      expect(stopped.out).toContain(`The daemon stopped (pid ${process.pid})`);
      const result = await started;
      expect(result.code).toBe(0);
      expect(result.out).toContain('agent-manager daemon started: pid');
      expect(result.out).toContain('agent-manager daemon stopped (command)');
      expect((await h.cli(['status'])).code).toBe(EXIT.daemonUnreachable);
    });

    it('status counts the owned sessions and stop reports the live ones it closed', async () => {
      const daemon = await startTestDaemon({ configDir: h.configDir });
      const launched = await daemon.call('POST', '/sessions/launch', { hostKind: 'stream-json', cwd: daemon.project });
      expect(launched.status).toBe(201);
      const status = await h.cli(['status']);
      expect(status.out).toContain('owned sessions:  1 (live 1: idle 1');
      const stopped = await h.cli(['stop']);
      expect(stopped.out).toContain('1 live session(s) were closed and can be resumed after the next start');
      await daemon.runtime.done;
    });

    it('stop that is not finished in time exits 1 and names what to do', async () => {
      const daemon = await startTestDaemon({ configDir: h.configDir, claude: fakeClaude({ FAKE_CLAUDE_HANG_ON_CLOSE: '1' }), closeTimeoutMs: 4000 });
      await daemon.call('POST', '/sessions/launch', { hostKind: 'stream-json', cwd: daemon.project });
      const commands = createDaemonCommands({ ...DEFAULT_DAEMON_DEPS, stopWaitMs: 300, pollMs: 50 });
      const err: string[] = [];
      await expect(commands.stop.run(context(h, err, {}), [])).rejects.toThrow(/still running 0\.3 s after the stop request.*end the pid/s);
      await daemon.runtime.done;
    });
  });

  describe('--detach', () => {
    function deps(overrides: Partial<DaemonCommandDeps>): DaemonCommandDeps {
      return { ...DEFAULT_DAEMON_DEPS, detachWaitMs: 5000, pollMs: 20, ...overrides };
    }

    it('waits until the daemon answers, then prints its status and the log path', async () => {
      const spawned: { logFile: string }[] = [];
      const commands = createDaemonCommands(
        deps({
          spawnDetached: (options) => {
            spawned.push({ logFile: options.logFile });
            // The "child": the daemon started in this process, as `agent-manager start` would in its own.
            void startDaemon({ configDir: h.configDir, port: 0, version: 'x', claude: fakeClaude() });
            return { pid: 4242, exited: new Promise(() => undefined) };
          },
        }),
      );
      const result = await commands.start.run(context(h, [], { detach: true }), []);
      expect(spawned).toHaveLength(1);
      expect(spawned[0]?.logFile).toBe(join(h.configDir, 'logs', `daemon-${new Date().toISOString().slice(0, 10)}.log`));
      expect(result.lines[0]).toContain(`The daemon started in the background (pid ${process.pid}); its output goes to ${spawned[0]?.logFile}`);
      expect(result.json).toMatchObject({ ok: true, background: true, alreadyRunning: false });
      await createControlClient(h.configDir).send('shutdown');
    });

    it('reports a daemon that exits while starting, with the log to read and what to try', async () => {
      const commands = createDaemonCommands(deps({ spawnDetached: () => ({ pid: 7, exited: Promise.resolve({ code: 1, signal: null }) }) }));
      await expect(commands.start.run(context(h, [], { detach: true }), [])).rejects.toThrow(/exited while starting \(exit code 1\)\. Read .*daemon-.*\.log, or run 'agent-manager start' in a terminal/s);
    });

    it('reports a daemon that never answers', async () => {
      const commands = createDaemonCommands(deps({ detachWaitMs: 200, spawnDetached: () => ({ pid: 8, exited: new Promise(() => undefined) }) }));
      await expect(commands.start.run(context(h, [], { detach: true }), [])).rejects.toThrow(/did not answer 0\.2 s after it was started \(pid 8\)/);
    });

    it('does nothing when the daemon already runs', async () => {
      await startTestDaemon({ configDir: h.configDir });
      const commands = createDaemonCommands(deps({ spawnDetached: () => { throw new Error('must not be spawned'); } }));
      const result = await commands.start.run(context(h, [], { detach: true }), []);
      expect(result.lines[0]).toContain('already running');
    });
  });

  describe('spawnDetachedProcess', () => {
    function fakeSystem(spawnImpl: () => unknown): { system: SpawnSystem; calls: string[]; spawned: { command: string; args: string[]; options: Record<string, unknown> }[] } {
      const calls: string[] = [];
      const spawned: { command: string; args: string[]; options: Record<string, unknown> }[] = [];
      const system: SpawnSystem = {
        openLog: () => {
          calls.push('open');
          return 77;
        },
        closeLog: (fd) => {
          calls.push(`close ${fd}`);
        },
        spawn: ((command: string, args: string[], options: Record<string, unknown>) => {
          calls.push('spawn');
          spawned.push({ command, args, options });
          return spawnImpl();
        }) as never,
        script: () => '/bundle/agent-manager.cjs',
      };
      return { system, calls, spawned };
    }
    const child = (): unknown => ({ pid: 5, unref: () => undefined, once: () => undefined });

    it('closes its copy of the log descriptor right after the spawn, hidden and detached', () => {
      const { system, calls, spawned } = fakeSystem(child);
      const started = spawnDetachedProcess({ env: {}, cwd: h.configDir, logFile: join(h.configDir, 'logs', 'daemon.log') }, system);
      expect(calls).toEqual(['open', 'spawn', 'close 77']);
      expect(started.pid).toBe(5);
      expect(spawned[0]?.args).toEqual(['/bundle/agent-manager.cjs', 'start']);
      expect(spawned[0]?.options).toMatchObject({ detached: true, windowsHide: true, shell: false, stdio: ['ignore', 77, 77] });
    });

    it('closes it when the spawn throws too', () => {
      const { system, calls } = fakeSystem(() => {
        throw new Error('spawn refused');
      });
      expect(() => spawnDetachedProcess({ env: {}, cwd: h.configDir, logFile: join(h.configDir, 'logs', 'daemon.log') }, system)).toThrow('spawn refused');
      expect(calls).toEqual(['open', 'spawn', 'close 77']);
    });
  });

  describe('formatUptime', () => {
    it.each([
      [0, '0s'],
      [65_000, '1m 5s'],
      [3_725_000, '1h 2m'],
      [90_000_000, '1d 1h'],
    ])('%d ms is %s', (ms, text) => {
      expect(formatUptime(ms)).toBe(text);
    });
  });
});

/** A context for a command run without the CLI wrapper (to inject the dependencies). */
function context(h: Harness, err: string[], options: Record<string, boolean>): Context {
  return {
    io: { out: () => undefined, err: (line) => err.push(line) },
    env: { ...h.env, ...ANY_PORT },
    cwd: h.configDir,
    configDir: h.configDir,
    options: new Options(new Map(Object.entries(options))),
    log: { outcome: () => undefined },
  };
}
