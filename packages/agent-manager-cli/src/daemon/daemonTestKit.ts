// Test-only helpers (excluded from the build): a daemon runtime on port 0 with the fake claude, in its own config folder, and a small HTTP/SSE client.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeTempDir } from '../testHelpers.js';
import { startDaemon } from './runtime.js';
import type { DaemonRuntime, DaemonRuntimeOptions } from './runtime.js';

export const FAKE_CLAUDE = fileURLToPath(new URL('../../../agent-manager-core/src/launch/testSupport/fakeClaude.mjs', import.meta.url));

export interface TestDaemon {
  runtime: DaemonRuntime;
  configDir: string;
  /** An existing folder for `cwd`. */
  project: string;
  token: string;
  logs: string[];
  call: (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: any }>;
}

const roots: string[] = [];
const runtimes: DaemonRuntime[] = [];

export function tempRoot(): string {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-manager-daemon-')));
  roots.push(root);
  return root;
}

/** Stops every daemon and removes every folder made by this file: call it in afterEach. */
export async function cleanupDaemons(): Promise<void> {
  for (const runtime of runtimes.splice(0)) {
    await runtime.stop('command').catch(() => undefined);
  }
  for (const root of roots.splice(0)) {
    removeTempDir(root);
  }
}

/** The fake claude, never the real one: the daemon of a test is told so explicitly, production code has no such default. */
export function fakeClaude(env: NodeJS.ProcessEnv = {}): NonNullable<DaemonRuntimeOptions['claude']> {
  return { command: process.execPath, commandArgs: [FAKE_CLAUDE], env: { ...process.env, ...env } };
}

export async function startTestDaemon(options: Partial<DaemonRuntimeOptions> & { configDir?: string } = {}): Promise<TestDaemon> {
  const root = options.configDir === undefined ? tempRoot() : '';
  const configDir = options.configDir ?? join(root, 'config');
  const project = join(options.configDir === undefined ? root : tempRoot(), 'project');
  mkdirSync(project, { recursive: true });
  const logs: string[] = [];
  const runtime = await startDaemon({ configDir, port: 0, version: '0.0.0-test', claude: fakeClaude(), closeTimeoutMs: 3000, log: (text) => logs.push(text), ...options });
  runtimes.push(runtime);
  const token = readFileSync(join(configDir, 'health_token'), 'utf8').trim();
  const call: TestDaemon['call'] = async (method, path, body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${runtime.apiPort}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text === '' ? undefined : JSON.parse(text) };
  };
  return { runtime, configDir, project, token, logs, call };
}

export interface ParsedSse {
  id?: string;
  event: string;
  data: any;
}

export interface SseConnection {
  events: ParsedSse[];
  status: number;
  /** Resolves with the first event (already received or future) that matches. */
  waitFor: (predicate: (event: ParsedSse) => boolean, what: string, timeoutMs?: number) => Promise<ParsedSse>;
  closed: Promise<void>;
  close: () => void;
}

/** GET /events with node:http (so that Host and Origin can be chosen). */
export function openEvents(daemon: Pick<TestDaemon, 'runtime' | 'token'>, headers: Record<string, string> = {}, path = '/events'): Promise<SseConnection> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: daemon.runtime.apiPort, path, method: 'GET', headers: { authorization: `Bearer ${daemon.token}`, ...headers } }, (res) => {
      const events: ParsedSse[] = [];
      const waiters: { predicate: (event: ParsedSse) => boolean; resolve: (event: ParsedSse) => void }[] = [];
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let index: number;
        while ((index = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const lines = block.split('\n').filter((line) => !line.startsWith(':') && !line.startsWith('retry:'));
          const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
          const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
          if (event === undefined || data === undefined) {
            continue;
          }
          const id = lines.find((line) => line.startsWith('id: '))?.slice(4);
          const parsed: ParsedSse = { ...(id === undefined ? {} : { id }), event, data: JSON.parse(data) };
          events.push(parsed);
          for (const waiter of [...waiters]) {
            if (waiter.predicate(parsed)) {
              waiters.splice(waiters.indexOf(waiter), 1);
              waiter.resolve(parsed);
            }
          }
        }
      });
      const closed = new Promise<void>((done) => {
        res.on('close', () => done());
      });
      resolve({
        events,
        status: res.statusCode ?? 0,
        closed,
        close: () => req.destroy(),
        waitFor: (predicate, what, timeoutMs = 20_000) => {
          const already = events.find(predicate);
          if (already !== undefined) {
            return Promise.resolve(already);
          }
          return new Promise((found, fail) => {
            const timer = setTimeout(() => fail(new Error(`timed out waiting for ${what}; received: ${events.map((event) => event.event).join(', ')}`)), timeoutMs);
            waiters.push({
              predicate,
              resolve: (event) => {
                clearTimeout(timer);
                found(event);
              },
            });
          });
        },
      });
    });
    req.on('error', reject);
    req.end();
  });
}
