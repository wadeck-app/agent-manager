import { request } from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { statusOfLaunchError } from './apiServer.js';
import { cleanupDaemons, startTestDaemon, tempRoot } from './daemonTestKit.js';
import type { TestDaemon } from './daemonTestKit.js';

/*
 * The switch of the host of a session through the daemon API (#71): POST /sessions/:id/switch {target, force?}. The behaviour of the host is tested in
 * agent-manager-core (SessionHost.switch.test.ts); here the HTTP contract: body validation, status codes, token, and the wiring of the runtime.
 */

afterEach(async () => {
  vi.unstubAllEnvs();
  await cleanupDaemons();
});

describe('HTTP status of the switch error codes', () => {
  it.each([
    // The state of the session forbids it now: the caller waits, confirms (force) or ends the other holder.
    ['switch-not-ready', 409],
    ['switch-in-progress', 409],
    ['switch-same-host', 409],
    ['session-held', 409],
    ['switch-stop-incomplete', 409],
    ['switch-draft', 409],
    ['switch-host-stopping', 409],
    ['invalid-switch-target', 400],
    ['switch-host-unsupported', 400],
    ['invalid-terminal-address', 400],
    // Valid request, but the world did not allow it: not trusted folder, no transcript, a stop or a start that failed.
    ['switch-no-conversation', 422],
    ['switch-untrusted-folder', 422],
    ['switch-stop-timeout', 422],
    ['switch-stop-failed', 422],
    ['switch-target-failed', 422],
    ['switch-id-mismatch', 422],
    ['holder-check-failed', 422],
    ['hc-control-failed', 422],
    ['hc-control-unavailable', 500],
  ])('%s answers %i', (code, status) => {
    expect(statusOfLaunchError(code)).toBe(status);
  });
});

const QUIET = [
  JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' }, uuid: '00000000-0000-4000-8000-000000000001', timestamp: '2026-11-21T10:00:00.000Z', origin: { kind: 'human' } }),
  JSON.stringify({ type: 'assistant', message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'hi' }] }, uuid: '00000000-0000-4000-8000-000000000002', timestamp: '2026-11-21T10:00:01.000Z' }),
].join('\n');

const BUSY = `${QUIET}\n${JSON.stringify({ type: 'assistant', message: { id: 'm2', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'node wait.mjs' } }] }, uuid: '00000000-0000-4000-8000-000000000003', timestamp: '2026-11-21T10:00:02.000Z' })}`;

async function launch(daemon: TestDaemon, extra: Record<string, unknown> = {}): Promise<string> {
  const { status, body } = await daemon.call('POST', '/sessions/launch', { hostKind: 'stream-json', cwd: daemon.project, model: 'haiku', ...extra });
  expect(status).toBe(201);
  return body.session.id as string;
}

/** A daemon whose hc is an in-memory fake and whose seams (registry, transcript, trust, supervisor) are fixed. */
async function switchDaemon(overrides: { trusted?: boolean; transcript?: string } = {}) {
  const root = tempRoot();
  const transcript = join(root, 'transcript.jsonl');
  writeFileSync(transcript, `${overrides.transcript ?? QUIET}\n`);
  const calls: string[] = [];
  let launched = 0;
  const terminals = new Map<string, { finished: boolean }>();
  const daemon = await startTestDaemon({
    hcLauncher: {
      launch: (req) => {
        launched += 1;
        const address = `t${launched}`;
        calls.push(`run ${req.args.join(' ')}`);
        terminals.set(address, { finished: false });
        const resumeId = req.args[req.args.indexOf('--resume') + 1] ?? '';
        const session = { pid: 7000 + launched, sessionId: resumeId, alive: true, status: 'idle', file: 'x.json' } as never;
        return Promise.resolve({ address, name: req.name, cwd: req.cwd, session, linkedAfterMs: 1 });
      },
    },
    hostSeams: {
      hcControl: {
        get: (address) => Promise.resolve(terminals.has(address) ? { address, finished: terminals.get(address)?.finished === true, state: 'done' } : undefined),
        keys: (address) => {
          terminals.set(address, { finished: true });
          return Promise.resolve();
        },
        kill: () => Promise.resolve(),
        remove: (address) => {
          terminals.delete(address);
          return Promise.resolve();
        },
      },
      readRegistry: () => Promise.resolve({ ok: true as const, dir: '(test)', sessions: [], unreadable: [] }),
      locateTranscript: () => Promise.resolve({ ok: true as const, path: transcript, projectDir: join(root, 'projects'), via: 'slug' as const }),
      trustCheck: () => Promise.resolve(overrides.trusted === false ? { trusted: false as const, reason: 'the folder is not trusted by Claude Code' } : { trusted: true as const }),
      bgLauncher: { launch: () => Promise.reject(new Error('no bg here')), list: () => Promise.resolve([]), stop: () => Promise.resolve(), respawn: () => Promise.resolve(), remove: () => Promise.resolve() },
      switchPollMs: 5,
    },
  });
  return { daemon, calls };
}

/** The readiness rule waits for a status older than 3 s: the real clock is used by the daemon, so the tests wait it out. */
const SETTLE = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 3200));

function raw(daemon: TestDaemon, options: { method: string; path: string; token?: string | null; body?: string }): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(options.token === null ? {} : { authorization: `Bearer ${options.token ?? daemon.token}` }) };
    const req = request({ host: '127.0.0.1', port: daemon.runtime.apiPort, path: options.path, method: options.method, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        text += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

describe('POST /sessions/:id/switch', () => {
  it('moves an owned Web session to hc: 200 with the same id, the readiness and the new host, and the list shows one session', async () => {
    const { daemon, calls } = await switchDaemon();
    const id = await launch(daemon, { permissionMode: 'default' });
    await SETTLE();
    const response = await daemon.call('POST', `/sessions/${id}/switch`, { target: 'hc' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ from: 'stream-json', to: 'hc', forced: false, readiness: { state: 'free', reasons: [] }, session: { id, hostKind: 'hc', status: 'live' } });
    expect(calls).toEqual([`run --resume ${id} --model haiku --permission-mode default`]);
    const listed = (await daemon.call('GET', '/sessions')).body.sessions as { id: string; hostKind: string }[];
    expect(listed.filter((item) => item.id === id)).toEqual([expect.objectContaining({ hostKind: 'hc' })]);
  }, 20_000);

  it('answers 409 switch-not-ready with the reasons and the fix when something runs, and moves nothing', async () => {
    const { daemon, calls } = await switchDaemon({ transcript: BUSY });
    const id = await launch(daemon);
    await SETTLE();
    const response = await daemon.call('POST', `/sessions/${id}/switch`, { target: 'hc' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('switch-not-ready');
    expect(response.body.error.reason).toContain('node wait.mjs');
    expect(response.body.error.fix).toContain('force');
    expect(calls).toEqual([]);
    expect((await daemon.call('GET', `/sessions/${id}`)).body.session).toMatchObject({ hostKind: 'stream-json', state: 'idle' });
    // The same request with force goes through, and says it was forced.
    const forced = await daemon.call('POST', `/sessions/${id}/switch`, { target: 'hc', force: true });
    expect(forced.status).toBe(200);
    expect(forced.body).toMatchObject({ forced: true, readiness: { state: 'busy' } });
  }, 20_000);

  it('answers 422 switch-untrusted-folder before stopping anything', async () => {
    const { daemon } = await switchDaemon({ trusted: false });
    const id = await launch(daemon);
    await SETTLE();
    const response = await daemon.call('POST', `/sessions/${id}/switch`, { target: 'hc' });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('switch-untrusted-folder');
    expect((await daemon.call('GET', `/sessions/${id}`)).body.session.state).toBe('idle');
  }, 20_000);

  it('validates the body (400 with the fix), the id (404) and the method (405)', async () => {
    const { daemon } = await switchDaemon();
    const id = await launch(daemon);
    for (const [body, code] of [
      [{}, 'invalid-field'],
      [{ target: 'bg' }, 'invalid-switch-target'],
      [{ target: 'hc', force: 'yes' }, 'invalid-field'],
      [{ target: 'hc', frce: true }, 'unknown-field'],
    ] as const) {
      const response = await daemon.call('POST', `/sessions/${id}/switch`, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error.code).toBe(code);
      expect(response.body.error.fix.length).toBeGreaterThan(10);
    }
    expect((await daemon.call('POST', '/sessions/11111111-1111-4111-8111-111111111111/switch', { target: 'hc' })).status).toBe(404);
    expect((await daemon.call('GET', `/sessions/${id}/switch`)).status).toBe(405);
    expect((await daemon.call('POST', `/sessions/${id}/switch`)).status).toBe(400);
  });

  it('is behind the bearer token like every route', async () => {
    const { daemon } = await switchDaemon();
    const id = await launch(daemon);
    expect((await raw(daemon, { method: 'POST', path: `/sessions/${id}/switch`, token: null, body: '{"target":"hc"}' })).status).toBe(401);
    expect((await raw(daemon, { method: 'POST', path: `/sessions/${id}/switch`, token: 'wrong', body: '{"target":"hc"}' })).status).toBe(401);
  });
});
