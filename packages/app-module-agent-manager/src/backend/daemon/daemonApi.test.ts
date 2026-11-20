import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DaemonError, createDaemonApi } from './daemonApi.js';
import { ownedView, startFakeDaemon } from './fakeDaemon.js';
import type { FakeDaemon } from './fakeDaemon.js';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

function configFolder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-manager-daemon-api-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function fake(dir: string): Promise<FakeDaemon> {
  const started = await startFakeDaemon(dir);
  cleanups.push(() => started.stop());
  return started;
}

async function listening(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; port: number }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => {
    server.closeAllConnections();
    server.close();
  });
  return { server, port: (server.address() as { port: number }).port };
}

const failure = async (run: () => Promise<unknown>): Promise<DaemonError> => {
  const error = await run().then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DaemonError);
  return error as DaemonError;
};

describe('createDaemonApi', () => {
  it('asks the daemon once per cache window, again after it, and again after a write', async () => {
    const dir = configFolder();
    const daemon = await fake(dir);
    daemon.sessions.push(ownedView({ id: '00000000-0000-4000-8000-000000000001' }));
    let now = 1000;
    const api = createDaemonApi({ configDir: () => dir, cacheMs: 1500, clock: () => now });
    const lists = (): number => daemon.requests.filter((request) => request.method === 'GET' && request.path === '/sessions').length;
    await Promise.all([api.list(), api.list(), api.list()]);
    expect(lists()).toBe(1);
    now += 1499;
    await api.list();
    expect(lists()).toBe(1);
    now += 2;
    await api.list();
    expect(lists()).toBe(2);
    await api.interrupt('00000000-0000-4000-8000-000000000001');
    await api.list();
    expect(lists()).toBe(3);
  });

  it('a failed list is cached for the same window too (a daemon that does not answer must not stall every poll)', async () => {
    const dir = configFolder();
    let now = 0;
    const api = createDaemonApi({ configDir: () => dir, cacheMs: 1500, clock: () => now });
    expect((await failure(() => api.list())).code).toBe('daemon-not-running');
    const first = api.list();
    expect(api.list()).toBe(first);
    first.catch(() => undefined);
    now += 2000;
    expect(api.list()).not.toBe(first);
    await failure(() => api.list());
  });

  it('a /version without apiPort is a bad answer that says the daemon is too old, not a crash', async () => {
    const dir = configFolder();
    const { port } = await listening((_req, res) => res.end(JSON.stringify({ version: 'old', pid: 1 })));
    writeFileSync(join(dir, 'config.port'), JSON.stringify({ port, pid: 1 }));
    writeFileSync(join(dir, 'health_token'), 'token');
    const error = await failure(() => createDaemonApi({ configDir: () => dir }).status());
    expect(error).toMatchObject({ kind: 'bad-answer', code: 'daemon-bad-answer' });
    expect(error.reason).toContain('apiPort');
    expect(error.fix).toContain('agent-manager stop');
  });

  it('does not send the token to a responder that is not the daemon of the port file (pid mismatch, another program on the port)', async () => {
    const dir = configFolder();
    const seen: (string | undefined)[] = [];
    const api = await listening((req, res) => {
      seen.push(req.headers.authorization);
      res.end('{}');
    });
    // The control port answers with the apiPort of a listener that is "the API", but its pid is not the one of the port file.
    const control = await listening((_req, res) => res.end(JSON.stringify({ apiPort: api.port, pid: 999_999 })));
    writeFileSync(join(dir, 'config.port'), JSON.stringify({ port: control.port, pid: 1 }));
    writeFileSync(join(dir, 'health_token'), 'secret-token');
    const error = await failure(() => createDaemonApi({ configDir: () => dir }).status());
    expect(error).toMatchObject({ kind: 'unreachable', code: 'daemon-mismatch' });
    expect(error.reason).toContain('not the daemon');
    expect(error.fix).toContain('agent-manager start --detach');
    expect(seen).toEqual([]);
    expect(`${error.reason} ${error.fix}`).not.toContain('secret-token');
  });

  it('a port file without a pid is refused before anything is sent', async () => {
    const dir = configFolder();
    writeFileSync(join(dir, 'config.port'), JSON.stringify({ port: 5 }));
    const error = await failure(() => createDaemonApi({ configDir: () => dir }).status());
    expect(error.reason).toContain('has no "pid"');
  });

  it('an API answer that is not JSON is a bad answer', async () => {
    const dir = configFolder();
    const api = await listening((req, res) => {
      res.end(req.url === '/version' ? '{}' : 'oops');
    });
    const control = await listening((_req, res) => res.end(JSON.stringify({ apiPort: api.port, pid: 1 })));
    writeFileSync(join(dir, 'config.port'), JSON.stringify({ port: control.port, pid: 1 }));
    writeFileSync(join(dir, 'health_token'), 'token');
    const error = await failure(() => createDaemonApi({ configDir: () => dir }).status());
    expect(error).toMatchObject({ kind: 'bad-answer', code: 'daemon-bad-answer' });
  });

  it('a missing or empty token file is its own error with the file name', async () => {
    const dir = configFolder();
    const daemon = await fake(dir);
    rmSync(join(dir, 'health_token'));
    const missing = await failure(() => createDaemonApi({ configDir: () => dir }).status());
    expect(missing).toMatchObject({ kind: 'unauthorized', code: 'daemon-unauthorized' });
    expect(missing.reason).toContain('health_token');
    writeFileSync(join(dir, 'health_token'), '  \n');
    const empty = await failure(() => createDaemonApi({ configDir: () => dir }).status());
    expect(empty.reason).toContain('is empty');
    expect(daemon.requests).toEqual([]);
  });

  it('the token is never part of an error message', async () => {
    const dir = configFolder();
    const daemon = await fake(dir);
    writeFileSync(join(dir, 'health_token'), 'a-secret-that-the-daemon-refuses');
    const error = await failure(() => createDaemonApi({ configDir: () => dir }).status());
    expect(error.kind).toBe('unauthorized');
    expect(`${error.reason} ${error.fix}`).not.toContain('a-secret-that-the-daemon-refuses');
    expect(`${error.reason} ${error.fix}`).not.toContain(daemon.token);
  });
});
