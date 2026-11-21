import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupDaemons, openEvents, startTestDaemon, tempRoot } from './daemonTestKit.js';
import type { TestDaemon } from './daemonTestKit.js';

afterEach(cleanupDaemons);

const FAKE_BG = fileURLToPath(new URL('../../../agent-manager-core/src/launch/testSupport/fakeBgClaude.mjs', import.meta.url));

interface Agent {
  id: string;
  [key: string]: unknown;
}

/** A daemon whose `claude` is the fake background-session CLI (state in a file the test can edit). */
async function startBgDaemon(env: Record<string, string> = {}): Promise<{ daemon: TestDaemon; edit: (change: (agents: Agent[]) => Agent[]) => void; agents: () => Agent[] }> {
  const root = tempRoot();
  const statePath = join(root, 'agents.json');
  mkdirSync(root, { recursive: true });
  const agents = (): Agent[] => (JSON.parse(readFileSync(statePath, 'utf8')) as { agents: Agent[] }).agents;
  const daemon = await startTestDaemon({
    claude: { command: process.execPath, commandArgs: [FAKE_BG], env: { ...process.env, FAKE_BG_STATE: statePath, ...env } },
    bgObserveIntervalMs: 50,
  });
  return { daemon, agents, edit: (change) => writeFileSync(statePath, JSON.stringify({ agents: change(agents()) })) };
}

describe('the session API for bg sessions', () => {
  it('launches, lists, observes a permission wait through SSE, stops, resumes and forgets', async () => {
    const { daemon, edit, agents } = await startBgDaemon();
    const events = await openEvents(daemon);
    const launched = await daemon.call('POST', '/sessions/launch', { hostKind: 'bg', cwd: daemon.project, model: 'haiku', name: 'am-api' });
    expect(launched.status).toBe(201);
    const { id, jobId } = launched.body.session as { id: string; jobId: string };
    expect(launched.body.session).toMatchObject({ hostKind: 'bg', name: 'am-api', status: 'live', attachCommand: `claude attach ${jobId}` });

    edit((all) => all.map((agent) => (agent.id === jobId ? { ...agent, state: 'blocked', status: 'waiting', waitingFor: 'permission prompt' } : agent)));
    const waiting = await events.waitFor((event) => event.event === 'session.bg_waiting', 'session.bg_waiting');
    expect(waiting.data).toMatchObject({ sessionId: id, data: { waitingFor: 'permission prompt', attachCommand: `claude attach ${jobId}` } });
    expect((await daemon.call('GET', `/sessions/${id}`)).body.session).toMatchObject({ state: 'requires_action', waitingFor: 'permission prompt' });

    // The routes that need a pipe to the process say where to go instead.
    for (const [path, body] of [
      [`/sessions/${id}/send`, { text: 'hello' }],
      [`/sessions/${id}/interrupt`, undefined],
      [`/sessions/${id}/permission-mode`, { mode: 'plan' }],
    ] as const) {
      const refused = await daemon.call('POST', path, body);
      expect(refused.status).toBe(409);
      expect(refused.body.error).toMatchObject({ code: 'not-owned' });
      expect(refused.body.error.fix).toContain(`claude attach ${jobId}`);
    }

    expect((await daemon.call('POST', `/sessions/${id}/forget`)).status).toBe(409);
    const stopped = await daemon.call('POST', `/sessions/${id}/stop`);
    expect(stopped.status).toBe(200);
    expect(stopped.body.session).toMatchObject({ state: 'exited', resumable: true });
    expect(agents().find((agent) => agent.id === jobId)?.state).toBe('stopped');

    const resumed = await daemon.call('POST', `/sessions/${id}/resume`);
    expect(resumed.status).toBe(200);
    expect(resumed.body.session).toMatchObject({ status: 'live' });
    await daemon.call('POST', `/sessions/${id}/stop`);
    expect((await daemon.call('POST', `/sessions/${id}/forget`)).status).toBe(200);
    expect(agents().find((agent) => agent.id === jobId)).toBeUndefined();
    expect((await daemon.call('GET', '/sessions')).body.sessions).toEqual([]);
    events.close();
  });

  it('forgets the record even when claude rm fails, and says so in the answer', async () => {
    const { daemon } = await startBgDaemon({ FAKE_BG_FAIL: 'rm' });
    const { id, jobId } = (await daemon.call('POST', '/sessions/launch', { hostKind: 'bg', cwd: daemon.project })).body.session as { id: string; jobId: string };
    await daemon.call('POST', `/sessions/${id}/stop`);
    const forgotten = await daemon.call('POST', `/sessions/${id}/forget`);
    expect(forgotten.status).toBe(200);
    expect(forgotten.body).toMatchObject({ id, supervisorNote: expect.stringContaining(`claude rm ${jobId}`) });
    expect((await daemon.call('GET', '/sessions')).body.sessions).toEqual([]);
  });

  it('answers an untrusted folder with a 422 that says how to trust it', async () => {
    const { daemon } = await startBgDaemon({ FAKE_BG_UNTRUSTED: '1' });
    const refused = await daemon.call('POST', '/sessions/launch', { hostKind: 'bg', cwd: daemon.project });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toMatchObject({ code: 'workspace-not-trusted' });
    expect(refused.body.error.fix).toContain('accept the trust dialog');
  });

  it('keeps the bg session running when the daemon stops, and sees it again after a start', async () => {
    const { daemon, agents } = await startBgDaemon();
    const launched = await daemon.call('POST', '/sessions/launch', { hostKind: 'bg', cwd: daemon.project });
    const { id, jobId } = launched.body.session as { id: string; jobId: string };
    await daemon.runtime.stop('command');
    expect(agents().find((agent) => agent.id === jobId)?.state).toBe('blocked');
    const again = await startTestDaemon({
      configDir: daemon.configDir,
      claude: { command: process.execPath, commandArgs: [FAKE_BG], env: { ...process.env, FAKE_BG_STATE: join(tempRoot(), 'other.json') } },
      bgObserveIntervalMs: 60_000,
    });
    expect((await again.call('GET', `/sessions/${id}`)).body.session).toMatchObject({ hostKind: 'bg', status: 'live' });
  });
});
