import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSessionRegistry } from '../readSessionRegistry.js';
import type { Session } from '../session.js';
import { registryEntry } from '../testFixtures.js';
import { tokenFileName } from './socketTransport.js';

/**
 * Test-only (excluded from the build). SAFETY: everything here is fake. The pipe is a server of THIS test process on a unique name in the OS temp
 * folder or the pipe namespace; the registry and the token are files in a temp folder. Nothing here can reach a real Claude Code session.
 */

export const FAKE_TOKEN = '0123456789abcdef0123456789abcdef';

export interface FakePipe {
  path: string;
  /** Every complete line received, in order, over all connections. */
  lines: string[];
  connections: number;
  close(): Promise<void>;
}

export async function startFakePipe(): Promise<FakePipe> {
  const name = `agent-manager-test-${randomUUID()}`;
  // A unix socket path is limited to about 104 bytes on macOS (sun_path) and the macOS temp folder alone is ~50 characters: the unix name is short.
  const path = process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : join(tmpdir(), `am-${name.slice(-8)}.sock`);
  const lines: string[] = [];
  const sockets = new Set<Socket>();
  const pipe: FakePipe = { path, lines, connections: 0, close: () => Promise.resolve() };
  const server: Server = createServer((socket) => {
    pipe.connections++;
    sockets.add(socket);
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        lines.push(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    });
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, resolve);
  });
  pipe.close = () =>
    new Promise<void>((resolve) => {
      for (const socket of sockets) {
        socket.destroy();
      }
      server.close(() => resolve());
    });
  return pipe;
}

export interface Fixture {
  /** Fake registry folder (holds the `<pid>.json` and the token file). */
  dir: string;
  session: Session;
  settingsPath: string;
  sessionId: string;
}

/** A fake registry folder with one session (this test process's pid, so that the pid is alive) pointing at `socketPath`. */
export async function makeFixture(options: { socketPath: string; platform: NodeJS.Platform; token?: string | null; settings?: Record<string, unknown> | string; overrides?: Record<string, unknown> }): Promise<Fixture> {
  const dir = mkdtempSync(join(tmpdir(), 'agent-manager-reply-'));
  const pid = process.pid;
  const sessionId = randomUUID();
  const entry = registryEntry(pid, { sessionId, messagingSocketPath: options.socketPath, ...options.overrides });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${pid}.json`), JSON.stringify(entry));
  if (options.token !== null) {
    writeFileSync(join(dir, tokenFileName(pid, options.socketPath, options.platform)), JSON.stringify({ peerToken: options.token ?? FAKE_TOKEN }));
  }
  const settingsPath = join(dir, 'settings.json');
  if (options.settings !== undefined) {
    writeFileSync(settingsPath, typeof options.settings === 'string' ? options.settings : JSON.stringify(options.settings));
  }
  const registry = await readSessionRegistry(dir, { isAlive: () => true });
  if (!registry.ok) {
    const { message } = registry.error;
    throw new Error(`fixture registry unreadable: ${message}`);
  }
  const session = registry.sessions[0];
  if (session === undefined) {
    throw new Error(`fixture registry holds no session: ${JSON.stringify(registry.unreadable)}`);
  }
  return { dir, session, settingsPath, sessionId };
}

/** A tiny valid PNG header plus padding: enough for the magic-byte check. */
export function fakePng(size = 64): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size - 8, 7)]);
}
