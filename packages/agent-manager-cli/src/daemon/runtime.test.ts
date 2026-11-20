import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { HcLauncher } from '@wadeck-app/agent-manager-core/launch';
import { afterEach, describe, expect, it } from 'vitest';
import { createControlClient } from './daemonClient.js';
import { cleanupDaemons, fakeClaude, openEvents, startTestDaemon, tempRoot } from './daemonTestKit.js';
import type { TestDaemon } from './daemonTestKit.js';
import { startDaemon } from './runtime.js';

afterEach(cleanupDaemons);

const LAUNCH = { hostKind: 'stream-json' } as const;

async function launch(daemon: TestDaemon, extra: Record<string, unknown> = {}): Promise<string> {
  const { status, body } = await daemon.call('POST', '/sessions/launch', { ...LAUNCH, cwd: daemon.project, model: 'haiku', ...extra });
  expect(status).toBe(201);
  return body.session.id as string;
}

/** A raw request, so that the Host header and the body can be chosen. */
function raw(daemon: TestDaemon, options: { method?: string; path: string; headers?: Record<string, string>; body?: string; token?: string | null }): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...(options.token === null ? {} : { authorization: `Bearer ${options.token ?? daemon.token}` }), ...options.headers };
    const req = request({ host: '127.0.0.1', port: daemon.runtime.apiPort, path: options.path, method: options.method ?? 'GET', headers }, (res) => {
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

describe('control server (singleton-daemon-kit)', () => {
  it('answers /version without a token with the pid and the API port, and `status` with the owned sessions', async () => {
    const daemon = await startTestDaemon();
    const version = await fetch(`http://127.0.0.1:${daemon.runtime.port}/version`).then((response) => response.json() as Promise<Record<string, unknown>>);
    expect(version).toMatchObject({ version: '0.0.0-test', pid: process.pid, apiPort: daemon.runtime.apiPort });
    expect(JSON.stringify(version)).not.toContain(daemon.token);
    const client = createControlClient(daemon.configDir);
    expect(await client.isRunning()).toBe(true);
    const status = await client.send('status');
    expect(status).toMatchObject({ pid: process.pid, port: daemon.runtime.port, apiPort: daemon.runtime.apiPort, version: '0.0.0-test', owned: { total: 0, live: 0 } });
    expect(JSON.stringify(status)).not.toContain(daemon.token);
  });

  it('refuses a command without the token', async () => {
    const daemon = await startTestDaemon();
    const response = await fetch(`http://127.0.0.1:${daemon.runtime.port}/status`, { method: 'POST' });
    expect(response.status).toBe(401);
  });
});

describe('security of the API', () => {
  it('requires the bearer token on every route, and never prints it', async () => {
    const daemon = await startTestDaemon();
    const routes: [string, string][] = [['GET', '/sessions'], ['GET', '/status'], ['GET', '/events'], ['POST', '/sessions/launch'], ['GET', '/sessions/x'], ['POST', '/sessions/x/send'], ['GET', '/nope']];
    for (const [method, path] of routes) {
      for (const token of [null, 'wrong-token', daemon.token.slice(0, -1)]) {
        const response = await raw(daemon, { method, path, token });
        expect(response.status, `${method} ${path} with ${String(token)}`).toBe(401);
        expect(response.text).not.toContain(daemon.token);
        expect(JSON.parse(response.text).error.fix).toContain('health_token');
      }
    }
    // A token in the URL is not a credential (it would end up in logs).
    expect((await raw(daemon, { path: `/sessions?token=${daemon.token}`, token: null })).status).toBe(401);
    expect((await daemon.call('GET', '/sessions')).status).toBe(200);
  });

  it('refuses a Host header that is not the loopback of this port (DNS rebinding)', async () => {
    const daemon = await startTestDaemon();
    for (const host of ['evil.example.com', `evil.example.com:${daemon.runtime.apiPort}`, `127.0.0.1.evil.example.com:${daemon.runtime.apiPort}`, '127.0.0.1:1', '127.0.0.1']) {
      const response = await raw(daemon, { path: '/sessions', headers: { host } });
      expect(response.status, host).toBe(403);
      expect(JSON.parse(response.text).error.code).toBe('bad-host');
    }
    expect((await raw(daemon, { path: '/sessions', headers: { host: `localhost:${daemon.runtime.apiPort}` } })).status).toBe(200);
  });

  it('refuses ANY request that carries an Origin (it comes from a browser), even a loopback page, with a valid token', async () => {
    const daemon = await startTestDaemon();
    for (const origin of ['https://evil.example.com', 'null', 'http://127.0.0.1:4850', 'http://localhost:4850', `http://127.0.0.1:${daemon.runtime.apiPort}`]) {
      const response = await raw(daemon, { path: '/sessions', headers: { origin } });
      expect(response.status, origin).toBe(403);
      const error = JSON.parse(response.text).error;
      expect(error.code).toBe('bad-origin');
      expect(error.fix).toContain('not for browsers');
      expect(error.fix).toContain('module of app-core');
    }
    expect((await raw(daemon, { path: '/sessions', headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    // A server-side caller (Node fetch, the CLI) sends no Origin and is served.
    expect((await raw(daemon, { path: '/sessions' })).status).toBe(200);
  });

  it('limits the body, the content type and the JSON', async () => {
    const daemon = await startTestDaemon({ maxBodyBytes: 2048 });
    const json = { 'content-type': 'application/json' };
    const big = await raw(daemon, { method: 'POST', path: '/sessions/launch', headers: json, body: JSON.stringify({ hostKind: 'hc', cwd: 'x'.repeat(5000) }) });
    expect(big.status).toBe(413);
    expect(JSON.parse(big.text).error.fix).toContain('send less');
    expect((await raw(daemon, { method: 'POST', path: '/sessions/launch', headers: { 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415);
    expect((await raw(daemon, { method: 'POST', path: '/sessions/launch', headers: json, body: '{nope' })).status).toBe(400);
    expect((await raw(daemon, { method: 'POST', path: '/sessions/launch', headers: json })).status).toBe(400);
  });

  it('answers 404 for an unknown route and 405 with the allowed method', async () => {
    const daemon = await startTestDaemon();
    expect((await daemon.call('GET', '/nope')).status).toBe(404);
    const wrong = await daemon.call('GET', '/sessions/launch');
    expect(wrong.status).toBe(405);
    expect(wrong.body.error.fix).toContain('POST');
    expect((await daemon.call('POST', '/sessions')).status).toBe(405);
    expect((await daemon.call('GET', '/sessions/bad%20id')).status).toBe(400);
  });
});

describe('launch validation', () => {
  it.each([
    ['a relative cwd', { hostKind: 'stream-json', cwd: 'relative/path' }, 'cwd-not-absolute'],
    ['a missing cwd', { hostKind: 'stream-json' }, 'cwd-missing-field'],
    ['an unknown host kind', { hostKind: 'docker', cwd: '/work/x' }, 'invalid-host-kind'],
    ['an unknown field', { hostKind: 'stream-json', cwd: '/work/x', bypass: true }, 'unknown-field'],
  ])('refuses %s with a 400 that says what to fix', async (_name, body, code) => {
    const daemon = await startTestDaemon();
    const response = await daemon.call('POST', '/sessions/launch', body);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe(code);
    expect(response.body.error.fix.length).toBeGreaterThan(10);
  });

  it('refuses a cwd that does not exist and a model that looks like a flag', async () => {
    const daemon = await startTestDaemon();
    const missing = await daemon.call('POST', '/sessions/launch', { ...LAUNCH, cwd: join(daemon.project, 'nope') });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('cwd-missing');
    const model = await daemon.call('POST', '/sessions/launch', { ...LAUNCH, cwd: daemon.project, model: '--dangerously-skip-permissions' });
    expect(model.status).toBe(400);
    expect(model.body.error.code).toBe('invalid-model');
    expect((await daemon.call('GET', '/sessions')).body.sessions).toEqual([]);
  });
});

describe('sessions API (X1, fake claude)', () => {
  it('launches, sends, streams events, lists, changes the mode, stops, resumes and forgets', async () => {
    const daemon = await startTestDaemon();
    const events = await openEvents(daemon);
    expect(events.status).toBe(200);
    const id = await launch(daemon, { name: 'api test', permissionMode: 'default' });
    const listed = await daemon.call('GET', '/sessions');
    expect(listed.body.sessions).toEqual([expect.objectContaining({ id, hostKind: 'stream-json', state: 'idle', model: 'haiku', claudeVersion: '9.9.9 (Claude Code fake)' })]);

    const sent = await daemon.call('POST', `/sessions/${id}/send`, { text: 'hello from the API' });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ state: 'queued' });
    const completed = await events.waitFor((event) => event.event === 'session.lifecycle' && event.data.data.uuid === sent.body.uuid && event.data.data.state === 'completed', 'completed lifecycle');
    expect(completed.id).toMatch(/^[0-9a-f]{8}:\d+$/);
    await events.waitFor((event) => event.event === 'session.result', 'result');
    const one = await daemon.call('GET', `/sessions/${id}`);
    expect(one.body.session.messages).toEqual([expect.objectContaining({ uuid: sent.body.uuid, state: 'completed' })]);
    expect(one.body.session.lastResult).toMatchObject({ text: 'done', isError: false });
    // The stream carries notifications, not the text of the message.
    expect(JSON.stringify(events.events)).not.toContain('hello from the API');

    expect((await daemon.call('POST', `/sessions/${id}/permission-mode`, { mode: 'acceptEdits' })).body).toEqual({ mode: 'acceptEdits' });
    expect((await daemon.call('POST', `/sessions/${id}/permission-mode`, { mode: 'refuse' })).status).toBe(422);
    expect((await daemon.call('POST', `/sessions/${id}/permission-mode`, { mode: '--x' })).status).toBe(400);

    const stopped = await daemon.call('POST', `/sessions/${id}/stop`);
    expect(stopped.body.session).toMatchObject({ state: 'exited', resumable: true });
    await events.waitFor((event) => event.event === 'session.exit' && event.data.data.by === 'user', 'exit by the user');
    const refused = await daemon.call('POST', `/sessions/${id}/send`, { text: 'again' });
    expect(refused.status).toBe(409);
    expect(refused.body.error.fix).toContain(`/sessions/${id}/resume`);
    const resumed = await daemon.call('POST', `/sessions/${id}/resume`);
    expect(resumed.status).toBe(200);
    expect(resumed.body.session).toMatchObject({ id, state: 'idle', resumable: false });
    expect((await daemon.call('POST', `/sessions/${id}/forget`)).status).toBe(409);
    await daemon.call('POST', `/sessions/${id}/stop`);
    expect((await daemon.call('POST', `/sessions/${id}/forget`)).status).toBe(200);
    expect((await daemon.call('GET', `/sessions/${id}`)).status).toBe(404);
    events.close();
  });

  it('interrupts a running turn', async () => {
    const daemon = await startTestDaemon();
    const events = await openEvents(daemon);
    const id = await launch(daemon);
    const sent = await daemon.call('POST', `/sessions/${id}/send`, { text: 'SLOW' });
    await events.waitFor((event) => event.event === 'session.lifecycle' && event.data.data.state === 'started', 'started');
    const interrupted = await daemon.call('POST', `/sessions/${id}/interrupt`);
    expect(interrupted.status).toBe(200);
    expect(interrupted.body).toMatchObject({ stillQueued: [] });
    await events.waitFor((event) => event.event === 'session.lifecycle' && event.data.data.uuid === sent.body.uuid && event.data.data.state === 'cancelled', 'cancelled');
    events.close();
  });

  it('lists and answers permission requests', async () => {
    const daemon = await startTestDaemon();
    const events = await openEvents(daemon);
    const id = await launch(daemon);
    await daemon.call('POST', `/sessions/${id}/send`, { text: 'PERMIT' });
    const request = await events.waitFor((event) => event.event === 'session.permission_request', 'permission request');
    expect(request.data.data).toMatchObject({ toolName: 'Bash' });
    const pending = await daemon.call('GET', `/sessions/${id}/permissions`);
    expect(pending.body.permissions).toEqual([expect.objectContaining({ requestId: request.data.data.requestId, toolName: 'Bash', input: { command: 'touch fake.txt', description: 'Create fake.txt' } })]);
    expect((await daemon.call('POST', `/sessions/${id}/permissions/${request.data.data.requestId}`, { decision: 'maybe' })).status).toBe(400);
    const decided = await daemon.call('POST', `/sessions/${id}/permissions/${request.data.data.requestId}`, { decision: 'deny', message: 'not now' });
    expect(decided.body).toEqual({ requestId: request.data.data.requestId, decision: 'deny' });
    await events.waitFor((event) => event.event === 'session.permission_resolved' && event.data.data.behavior === 'deny', 'resolved');
    const again = await daemon.call('POST', `/sessions/${id}/permissions/${request.data.data.requestId}`, { decision: 'allow' });
    expect(again.status).toBe(404);
    expect((await daemon.call('GET', `/sessions/${id}/permissions`)).body.permissions).toEqual([]);
    events.close();
  });

  it('refuses the text and image limits with a fix, and sends an image block', async () => {
    const daemon = await startTestDaemon();
    const id = await launch(daemon);
    expect((await daemon.call('POST', `/sessions/${id}/send`, {})).body.error.code).toBe('empty-message');
    expect((await daemon.call('POST', `/sessions/${id}/send`, { text: 'x'.repeat(20_001) })).body.error.code).toBe('text-too-long');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');
    expect((await daemon.call('POST', `/sessions/${id}/send`, { text: 'x', images: [{ mediaType: 'image/jpeg', dataBase64: png }] })).body.error.code).toBe('mime-mismatch');
    expect((await daemon.call('POST', `/sessions/${id}/send`, { text: 'look', images: [{ mediaType: 'image/png', dataBase64: png }] })).status).toBe(200);
  });

  it('keeps the audit free of message text and writes the actions', async () => {
    const daemon = await startTestDaemon();
    const id = await launch(daemon);
    await daemon.call('POST', `/sessions/${id}/send`, { text: 'TOP-SECRET-TEXT' });
    await daemon.call('POST', `/sessions/${id}/interrupt`);
    const audit = readdirAudit(daemon.configDir);
    expect(audit).toContain('"action":"launch"');
    expect(audit).toContain('"action":"send"');
    expect(audit).toContain('"action":"interrupt"');
    expect(audit).not.toContain('TOP-SECRET-TEXT');
    expect(audit).not.toContain(daemon.token);
  });

  it('bounds the number of event streams', async () => {
    const daemon = await startTestDaemon({ maxSseClients: 1 });
    const first = await openEvents(daemon);
    expect(first.status).toBe(200);
    const second = await openEvents(daemon);
    expect(second.status).toBe(503);
    first.close();
  });
});

function readdirAudit(configDir: string): string {
  const dir = join(configDir, 'audit');
  const files = existsSync(dir) ? readdirSyncSafe(dir) : [];
  return files.map((file) => readFileSync(join(dir, file), 'utf8')).join('\n');
}

function readdirSyncSafe(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.startsWith('owned-'));
}

describe('events: replay and gaps', () => {
  it('replays the events after Last-Event-ID and reports a gap for an id of an earlier run', async () => {
    const daemon = await startTestDaemon();
    const id = await launch(daemon);
    const buffered = daemon.runtime.host.events.replay(undefined).events;
    expect(buffered.length).toBeGreaterThan(0);
    const first = await openEvents(daemon);
    await first.waitFor((event) => event.event === 'session.launched', 'replayed launch');
    first.close();
    const lastSeen = buffered[0]?.id ?? '';
    const resumed = await openEvents(daemon, { 'last-event-id': lastSeen });
    // Nothing between the first event and the end is missing, and the first one is not repeated.
    expect(resumed.events.map((event) => event.id)).not.toContain(lastSeen);
    resumed.close();
    const stale = await openEvents(daemon, { 'last-event-id': 'deadbeef:5' });
    const gap = await stale.waitFor((event) => event.event === 'replay.gap', 'gap');
    expect(gap.data).toMatchObject({ reason: 'daemon-restarted' });
    expect(gap.data.fix).toContain('GET /sessions');
    stale.close();
    expect(id).toBeTruthy();
  });

  it('is bounded: a daemon keeps only the last events', async () => {
    const daemon = await startTestDaemon();
    for (let i = 0; i < 1100; i++) {
      daemon.runtime.host.events.append('host.warning', undefined, { i });
    }
    expect(daemon.runtime.host.events.size).toBe(1000);
  });
});

describe('review fixes', () => {
  it('a stream dropped in the middle of its replay does not crash the daemon (the limit is passed at the first write)', async () => {
    const daemon = await startTestDaemon({ maxSseBufferedBytes: 0 });
    for (let i = 0; i < 20; i++) {
      daemon.runtime.host.events.append('host.warning', undefined, { text: 'x'.repeat(200) });
    }
    const stream = await openEvents(daemon);
    expect(stream.status).toBe(200);
    await stream.closed;
    expect(daemon.logs.filter((line) => line.startsWith('error'))).toEqual([]);
    // The daemon still serves.
    expect((await daemon.call('GET', '/sessions')).status).toBe(200);
  });

  it('a start that fails after the servers are up is undone: no port file, nothing listening, the folder can be used again', async () => {
    const configDir = join(tempRoot(), 'config');
    await expect(startDaemon({ configDir, port: 0, version: 'x', claude: fakeClaude(), readToken: () => Promise.reject(new Error('token unreadable')) })).rejects.toThrow('token unreadable');
    expect(existsSync(join(configDir, 'config.port'))).toBe(false);
    const again = await startTestDaemon({ configDir });
    expect((await again.call('GET', '/sessions')).status).toBe(200);
  });

  it('a start that fails before it holds the singleton does not rewrite the state file', async () => {
    const configDir = join(tempRoot(), 'config');
    mkdirSync(configDir, { recursive: true });
    const record = { id: 'aaaaaaaa-0000-4000-8000-000000000003', hostKind: 'stream-json', cwd: configDir, claudeVersion: '9', startedAt: 1, status: 'live', pid: 999999, daemonPid: 1 };
    const content = JSON.stringify({ version: 1, sessions: [record] });
    writeFileSync(join(configDir, 'owned-sessions.json'), content);
    // An impossible control port: createDaemon rejects before it holds anything (and the closing of the half-started daemon must not write the list either).
    await expect(startDaemon({ configDir, port: 70000, version: 'x', claude: fakeClaude() })).rejects.toThrow();
    expect(readFileSync(join(configDir, 'owned-sessions.json'), 'utf8')).toBe(content);
    expect(existsSync(join(configDir, 'config.port'))).toBe(false);
  });

  it('puts neither stderr nor tool input in the events, and keeps them in the session and permissions routes', async () => {
    const daemon = await startTestDaemon();
    const events = await openEvents(daemon);
    const id = await launch(daemon);
    await daemon.call('POST', `/sessions/${id}/send`, { text: 'CRASH' });
    const exit = await events.waitFor((event) => event.event === 'session.exit', 'exit');
    expect(Object.keys(exit.data.data).sort()).toEqual(['by', 'cause', 'code', 'signal']);
    expect(JSON.stringify(events.events)).not.toContain('boom');
    expect((await daemon.call('GET', `/sessions/${id}`)).body.session.exit.stderrTail).toContain('boom');
    events.close();
  });
});

describe('hc (X3) through the API', () => {
  it('launches with a stub launcher and refuses the owned actions with a 409', async () => {
    const calls: unknown[] = [];
    const daemon = await startTestDaemon({
      hcLauncher: {
        launch: (req) => {
          calls.push(req);
          return Promise.resolve({ address: 't3', name: req.name, cwd: req.cwd, session: { sessionId: '99999999-0000-4000-8000-000000000009' } as never, linkedAfterMs: 1 });
        },
      },
    });
    const launched = await daemon.call('POST', '/sessions/launch', { hostKind: 'hc', cwd: daemon.project, model: 'haiku' });
    expect(launched.status).toBe(201);
    expect(launched.body.session).toMatchObject({ hostKind: 'hc', hcAddress: 't3', state: 'unobserved' });
    expect(calls).toHaveLength(1);
    const send = await daemon.call('POST', `/sessions/${launched.body.session.id}/send`, { text: 'x' });
    expect(send.status).toBe(409);
    expect(send.body.error).toMatchObject({ code: 'not-owned' });
    expect(send.body.error.fix).toContain('hc reply transport');
  });

  it('an unavailable hc is a visible error with the fix', async () => {
    const daemon = await startTestDaemon({ hcLauncher: new HcLauncher({ command: 'agent-manager-no-such-hc' }) });
    const response = await daemon.call('POST', '/sessions/launch', { hostKind: 'hc', cwd: daemon.project });
    expect(response.status).toBe(422);
    expect(response.body.error.fix).toContain('herdr-core');
    expect((await daemon.call('GET', '/sessions')).body.sessions).toEqual([]);
  });
});

describe('restart recovery', () => {
  it('lists a session that the file says was live as interrupted, with a resume action; the turn is not replayed', async () => {
    const first = await startTestDaemon();
    const id = await launch(first);
    // What a crash of the daemon leaves: the file written by the launch (live).
    const crashed = readFileSync(join(first.configDir, 'owned-sessions.json'), 'utf8');
    await first.runtime.stop();
    const configDir = join(tempRoot(), 'config');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'owned-sessions.json'), crashed);
    const second = await startTestDaemon({ configDir });
    expect(second.runtime.init.interrupted).toEqual([id]);
    const status = await createControlClient(configDir).send('status');
    expect(status.owned).toMatchObject({ total: 1, live: 0, interrupted: 1 });
    const view = (await second.call('GET', `/sessions/${id}`)).body.session;
    expect(view).toMatchObject({ state: 'interrupted', resumable: true });
    expect(view.note).toContain('NOT replayed');
    const send = await second.call('POST', `/sessions/${id}/send`, { text: 'hi' });
    expect(send.status).toBe(409);
    const resumed = await second.call('POST', `/sessions/${id}/resume`, {});
    expect(resumed.status).toBe(200);
    expect(resumed.body.session).toMatchObject({ id, state: 'idle' });
    expect((await second.call('POST', `/sessions/${id}/resume`)).status).toBe(409);
  });

  it('does not start on a corrupt state file: a loud error with the path, nothing listens, the file is untouched', async () => {
    const configDir = join(tempRoot(), 'config');
    mkdirSync(configDir, { recursive: true });
    const path = join(configDir, 'owned-sessions.json');
    writeFileSync(path, 'not json at all');
    await expect(startDaemon({ configDir, port: 0, version: 'x', claude: fakeClaude() })).rejects.toThrow(new RegExp(`${path.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}.*never empties it by itself`, 's'));
    expect(readFileSync(path, 'utf8')).toBe('not json at all');
    expect(existsSync(join(configDir, 'config.port'))).toBe(false);
    expect(existsSync(join(configDir, 'health_token'))).toBe(false);
  });
});

describe('stop', () => {
  it('closes the children, writes the state, removes the port file and ends (runtime.stop)', async () => {
    const daemon = await startTestDaemon();
    const a = await launch(daemon);
    const b = await launch(daemon);
    const pids = (await daemon.call('GET', '/sessions')).body.sessions.map((session: { pid: number }) => session.pid) as number[];
    await daemon.runtime.stop();
    await expect(daemon.runtime.done).resolves.toBe('command');
    expect(existsSync(join(daemon.configDir, 'config.port'))).toBe(false);
    await expect(fetch(`http://127.0.0.1:${daemon.runtime.apiPort}/sessions`)).rejects.toThrow();
    const file = JSON.parse(readFileSync(join(daemon.configDir, 'owned-sessions.json'), 'utf8')) as { sessions: { id: string; status: string; exit: { by: string; cause: string } }[] };
    expect(file.sessions.map((session) => session.id).sort()).toEqual([a, b].sort());
    for (const session of file.sessions) {
      expect(session).toMatchObject({ status: 'exited', exit: { by: 'daemon-shutdown', cause: 'closed' } });
    }
    for (const pid of pids) {
      expect(() => process.kill(pid, 0)).toThrow();
    }
  });

  it('stops through the control command `shutdown`, answering first', async () => {
    const daemon = await startTestDaemon();
    await launch(daemon);
    const answer = await createControlClient(daemon.configDir).send('shutdown');
    expect(answer).toEqual({ stopping: true, live: 1 });
    await expect(daemon.runtime.done).resolves.toBe('command');
    expect(await createControlClient(daemon.configDir).isRunning()).toBe(false);
  });

  it('kills a claude that ignores the end of stdin, so a stop never hangs', async () => {
    const daemon = await startTestDaemon({ claude: fakeClaude({ FAKE_CLAUDE_HANG_ON_CLOSE: '1' }), closeTimeoutMs: 300 });
    await launch(daemon);
    const pid = (await daemon.call('GET', '/sessions')).body.sessions[0].pid as number;
    await daemon.runtime.stop();
    expect(() => process.kill(pid, 0)).toThrow();
    expect(daemon.logs.filter((line) => line.startsWith('error'))).toEqual([]);
  });

  it('refuses a launch while it stops', async () => {
    const daemon = await startTestDaemon();
    void daemon.runtime.host.shutdown();
    const response = await daemon.call('POST', '/sessions/launch', { ...LAUNCH, cwd: daemon.project });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('host-stopping');
  });
});
