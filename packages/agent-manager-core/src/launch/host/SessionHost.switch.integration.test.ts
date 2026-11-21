import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SESSIONS_DIR_ENV, resolveSessionsDir } from '../../sessionsDir.js';
import { projectSlug, resolveProjectsDir } from '../../transcript/transcriptPath.js';
import { LaunchError } from '../errors.js';
import { HcControl } from '../HcControl.js';
import { HcLauncher } from '../HcLauncher.js';
import { SessionHost } from './SessionHost.js';

/*
 * INTEGRATION test of the host switch (#71): the ONE test that runs the real `claude` (Haiku) and the real herdr-core `hc`. Every other switch test uses the fakes
 * (SessionHost.switch.test.ts); this one proves what a mock cannot: the same session id, ONE transcript and no duplicated entry over Web (X1) -> terminal (hc) -> Web.
 *
 * Gate: AGENT_MANAGER_INTEGRATION=1. Absent: REPORTED as skipped, with the reason in its title. Present: a missing `claude` or `hc`, or an untrusted folder, FAILS with what to do.
 * Cost: 1 Haiku prompt (one on each X1 run; the hc run is only resumed and left idle), one claude process at a time, no loop. Run it on demand.
 * Folder: %TEMP%/am-adopt/proj, which Claude Code must already trust (a terminal would wait on the trust dialog): see poc/scripts/adopt-test.mjs, research/adopt-host-switch.md.
 */

const GATE = 'AGENT_MANAGER_INTEGRATION';
const enabled = process.env[GATE] === '1';
const TITLE = enabled
  ? 'one session moves Web -> herdr-core -> Web with the same id, one transcript and no duplicated entry (real claude and hc, 1 Haiku prompt)'
  : `SKIPPED, set ${GATE}=1 to run (real claude and hc, 1 Haiku prompt): one session moves Web -> herdr-core -> Web with the same id and one transcript`;

/** The environment of a real run: the test isolation redirects HOME and friends, but a real claude needs the real ones (credentials, settings, trust). */
function realEnvironment(): NodeJS.ProcessEnv {
  const saved = process.env['AGENT_MANAGER_TEST_REAL_ENV'];
  if (saved === undefined) {
    throw new Error(`${GATE}=1 needs the real environment saved by test-support/guardRealConfig.ts (AGENT_MANAGER_TEST_REAL_ENV): run this test through the vitest config of the package (npm test --workspace=packages/agent-manager-core), not by another runner`);
  }
  const real = JSON.parse(saved) as Record<string, string>;
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME']) {
    const value = real[name];
    if (value === undefined) {
      delete env[name];
    } else {
      env[name] = value;
    }
  }
  return env;
}

function requireTool(command: string, env: NodeJS.ProcessEnv, what: string): void {
  const run = spawnSync(command, ['--version'], { env, encoding: 'utf8', windowsHide: true });
  if (run.error !== undefined || run.status !== 0) {
    throw new Error(`${GATE}=1 but \`${command} --version\` failed (${run.error?.message ?? `exit ${String(run.status)}: ${run.stderr}`}): ${what}, or unset ${GATE}`);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const cleanups: (() => Promise<void> | void)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

describe('host switch against the real claude and hc', () => {
  it.skipIf(!enabled)(TITLE, async () => {
    const env = realEnvironment();
    // violations-suppress: shared/no-out-of-repo-path os.homedir() is the fallback of the real home (the test profile is redirected, the real one comes from AGENT_MANAGER_TEST_REAL_ENV)
    // os.homedir() reads the redirected profile of the test run: the real registry folder is given explicitly.
    env[SESSIONS_DIR_ENV] = resolveSessionsDir(env, env['HOME'] ?? env['USERPROFILE'] ?? homedir());
    requireTool('claude', env, 'install Claude Code and log in');
    requireTool('hc', env, 'install herdr-core (hc must be on the PATH)');

    // The throwaway trusted folder of the measurements (realpath: the trust and the transcript slug use it).
    const cwd = join(tmpdir(), 'am-adopt', 'proj');
    mkdirSync(cwd, { recursive: true });
    const real = realpathSync(cwd);
    const home = env['HOME'] ?? env['USERPROFILE'] ?? homedir();
    const projectDir = join(resolveProjectsDir(env, home), projectSlug(real));
    const filesBefore = new Set(existsSync(projectDir) ? readdirSync(projectDir) : []);

    const configDir = mkdtempSync(join(tmpdir(), 'agent-manager-switch-it-'));
    cleanups.push(() => rmSync(configDir, { recursive: true, force: true }));
    const host = new SessionHost({
      configDir,
      claude: { command: 'claude', env },
      hcLauncher: new HcLauncher({ sessionsDir: resolveSessionsDir(env, home) }),
      hcControl: new HcControl(),
    });
    cleanups.push(() => host.shutdown());
    await host.init();

    const answered = async (id: string, uuid: string): Promise<void> => {
      const deadline = Date.now() + 180_000;
      for (;;) {
        const view = host.list().find((item) => item.id === id);
        const state = view?.messages.find((message) => message.uuid === uuid)?.state;
        if (state === 'completed') {
          return;
        }
        if (view?.state === 'exited' || state === 'cancelled' || state === 'lost' || Date.now() > deadline) {
          throw new Error(`the session did not answer (message ${String(state)}, session ${String(view?.state)}): claude stderr tail: ${view?.exit?.stderrTail ?? '(none)'}`);
        }
        await sleep(500);
      }
    };
    /** A just-finished turn is not free for a few seconds (the idle age): wait for it, never force. */
    const moveWhenFree = async (id: string, target: 'hc' | 'stream-json') => {
      const deadline = Date.now() + 60_000;
      for (;;) {
        try {
          return await host.switchHost(id, target);
        } catch (error) {
          if (!(error instanceof LaunchError) || error.code !== 'switch-not-ready' || Date.now() > deadline) {
            throw error;
          }
          await sleep(2000);
        }
      }
    };
    /** Own terminals only: every address a switch reported, removed even when an assertion failed. */
    const terminals = new Set<string>();
    cleanups.push(() => {
      for (const address of terminals) {
        spawnSync('hc', ['kill', address], { env, windowsHide: true });
        spawnSync('hc', ['rm', address], { env, windowsHide: true });
      }
    });

    // Prompt 1: Web.
    const created = await host.launch({ hostKind: 'stream-json', cwd: real, model: 'haiku', permissionMode: 'default', name: 'switch: integration' });
    const id = created.id;
    await answered(id, (await host.send(id, { text: 'The secret word is ALPHA. Reply exactly OK1. No tools.', images: [] })).uuid);

    // Web -> herdr-core: resumed idle (no prompt).
    const toHc = await moveWhenFree(id, 'hc');
    if (toHc.session.hcAddress !== undefined) {
      terminals.add(toHc.session.hcAddress);
    }
    expect(toHc.session).toMatchObject({ id, hostKind: 'hc' });
    // The terminal needs a moment to be idle again after its start (the registry entry exists, the first screen may still draw).
    await sleep(4000);

    // herdr-core -> Web: ctrl+c ctrl+c, resumed in the daemon (no prompt: the answer of a resumed X1 is proved by SessionHost.switch.test.ts and the measurements).
    const toWeb = await moveWhenFree(id, 'stream-json');
    expect(toWeb.session).toMatchObject({ id, hostKind: 'stream-json' });

    // The same record, two moves.
    const record = host.list().find((item) => item.id === id);
    expect(record?.id).toBe(id);
    expect(record?.switches?.map((item) => `${item.from}>${item.to}`)).toEqual(['stream-json>hc', 'hc>stream-json']);

    // One transcript for the id, no other new transcript, no entry written twice.
    const files = readdirSync(projectDir);
    expect(files.filter((name) => name === `${id}.jsonl`), 'the transcript of the session is missing or duplicated').toHaveLength(1);
    expect(files.filter((name) => !filesBefore.has(name)), 'a switch created another transcript').toEqual([`${id}.jsonl`]);
    const uuids = readFileSync(join(projectDir, `${id}.jsonl`), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => (JSON.parse(line) as { uuid?: unknown }).uuid)
      .filter((uuid): uuid is string => typeof uuid === 'string');
    expect(uuids.length, 'the transcript holds no entry with a uuid').toBeGreaterThan(0);
    expect(uuids.length - new Set(uuids).size, 'duplicated uuids in the transcript').toBe(0);
  }, 600_000);
});
