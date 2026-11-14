import { afterEach, describe, expect, it } from 'vitest';
import { getErrorMessage } from '../errors.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDir } from '../testFixtures.js';
import { ReplyError } from './errors.js';
import { buildSocketFrame, createSocketTransport, tokenFileName } from './socketTransport.js';
import { FAKE_TOKEN, makeFixture, startFakePipe } from './testSupport.js';
import type { FakePipe } from './testSupport.js';
import type { ReplyMessage } from './types.js';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

async function setup(platform: NodeJS.Platform, extra: { token?: string | null; settings?: Record<string, unknown> | string } = {}) {
  const pipe = await startFakePipe();
  cleanups.push(() => pipe.close());
  const fixture = await makeFixture({ socketPath: pipe.path, platform, ...extra });
  cleanups.push(() => removeDir(fixture.dir));
  const transport = createSocketTransport({ sessionsDir: fixture.dir, settingsPath: fixture.settingsPath, platform, graceMs: 50, connectTimeoutMs: 2000 });
  return { pipe, fixture, transport };
}

const message = (overrides: Partial<ReplyMessage> = {}): ReplyMessage => ({ id: 'msg-1', text: '[web reply via agent-manager #msg-1]\nhello', imagePaths: [], priority: 'next', origin: 'web', ...overrides });

async function waitForLines(pipe: FakePipe, count: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (pipe.lines.length < count) {
    if (Date.now() > deadline) {
      throw new Error(`the fake pipe received ${pipe.lines.length} lines, expected ${count}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('buildSocketFrame', () => {
  it('has the shape the session expects', () => {
    const frame = JSON.parse(buildSocketFrame({ text: 'hi', id: 'abc', priority: 'later', sessionId: 'sid' })) as { type: string };
    expect(frame).toEqual({ type: 'user', message: { role: 'user', content: 'hi' }, msgV: 1, msg_id: 'abc', priority: 'later', session_id: 'sid' });
  });
  it('refuses an empty text, an unknown priority and an unsafe id', () => {
    expect(() => buildSocketFrame({ text: '', id: 'abc', priority: 'next', sessionId: 's' })).toThrow(ReplyError);
    expect(() => buildSocketFrame({ text: 'x', id: 'abc', priority: 'urgent', sessionId: 's' })).toThrow(/priority/);
    expect(() => buildSocketFrame({ text: 'x', id: '../abc', priority: 'next', sessionId: 's' })).toThrow(/identifier/);
  });
});

describe('tokenFileName', () => {
  it('hashes the lower-cased socket path on win32 only', () => {
    expect(tokenFileName(7, '\\\\.\\pipe\\LOCAL\\CC-Msg', 'win32')).toBe(tokenFileName(7, '\\\\.\\pipe\\local\\cc-msg', 'win32'));
    expect(tokenFileName(7, '/tmp/CC', 'linux')).not.toBe(tokenFileName(7, '/tmp/cc', 'linux'));
    expect(tokenFileName(7, 'x', 'win32')).toMatch(/^7\.[0-9a-f]{64}\.key$/);
  });
});

describe('socket send (fake pipe)', () => {
  it('writes the auth line then the frame on win32', async () => {
    const { pipe, fixture, transport } = await setup('win32');
    const result = await transport.send(fixture.session, message({ priority: 'later' }));
    await waitForLines(pipe, 2);
    expect(JSON.parse(pipe.lines[0] as string)).toEqual({ type: 'auth', token: FAKE_TOKEN });
    expect(JSON.parse(pipe.lines[1] as string)).toEqual({
      type: 'user',
      message: { role: 'user', content: message().text },
      msgV: 1,
      msg_id: 'msg-1',
      priority: 'later',
      session_id: fixture.sessionId,
    });
    expect(result.accepted).toBe(true);
    expect(result.detail).toMatch(/not confirmed/);
    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN);
  });

  it('sends the frame alone on another platform when there is no token file', async () => {
    const { pipe, fixture, transport } = await setup('linux', { token: null });
    await transport.send(fixture.session, message());
    await waitForLines(pipe, 1);
    expect(pipe.lines).toHaveLength(1);
    expect((JSON.parse(pipe.lines[0] as string) as { type: string }).type).toBe('user');
  });

  it('refuses on win32 without a token file, with an actionable error and no connection', async () => {
    const { pipe, fixture, transport } = await setup('win32', { token: null });
    const error = await transport.send(fixture.session, message()).catch((e: unknown) => e as ReplyError);
    expect(error).toBeInstanceOf(ReplyError);
    expect((error as ReplyError).code).toBe('no-token-file');
    expect((error as ReplyError).message).toMatch(/Fix:/);
    expect(pipe.connections).toBe(0);
  });

  it('never puts a malformed token file content in the error', async () => {
    const pipe = await startFakePipe();
    cleanups.push(() => pipe.close());
    const fixture = await makeFixture({ socketPath: pipe.path, platform: 'win32', token: 'SECRET-NOT-HEX-SECRET' });
    cleanups.push(() => removeDir(fixture.dir));
    const transport = createSocketTransport({ sessionsDir: fixture.dir, settingsPath: fixture.settingsPath, platform: 'win32', graceMs: 20 });
    const error = (await transport.send(fixture.session, message()).catch((e: unknown) => e)) as ReplyError;
    expect(error.code).toBe('no-token-file');
    expect(getErrorMessage(error)).not.toContain('SECRET');
  });

  it('explains a stale registry entry when the pipe does not exist', async () => {
    const { fixture } = await setup('win32');
    const gone = process.platform === 'win32' ? `\\\\.\\pipe\\agent-manager-test-gone-${randomUUID()}` : join(tmpdir(), `gone-${randomUUID()}.sock`);
    const session = { ...fixture.session, messagingSocketPath: gone };
    const transport = createSocketTransport({ sessionsDir: fixture.dir, platform: 'linux', graceMs: 20, connectTimeoutMs: 2000 });
    const error = (await transport.send(session, message()).catch((e: unknown) => e)) as ReplyError;
    expect(error.code).toBe('pipe-refused');
    expect(getErrorMessage(error)).toMatch(/stale registry entry/);
    expect(error.fix).not.toBe('');
  });

  it('refuses a session without a socket path', async () => {
    const { fixture, transport } = await setup('win32');
    const { messagingSocketPath: _omitted, ...rest } = fixture.session;
    const error = (await transport.send(rest, message()).catch((e: unknown) => e)) as ReplyError;
    expect(error.code).toBe('no-socket-path');
  });
});

describe('socket probe (fake registry, fake pipe)', () => {
  it('is available, connects and closes without writing, and never returns the token', async () => {
    const { pipe, fixture, transport } = await setup('win32', { settings: { crossSessionInbound: 'accept' } });
    const probe = await transport.probe(fixture.session);
    expect(probe.available).toBe(true);
    expect(probe.details['crossSessionInbound']).toBe('accept');
    expect(probe.details['warnings']).toEqual([]);
    expect((probe.details['checks'] as { name: string; ok: boolean }[]).map((check) => check.name)).toEqual(['registry-entry', 'pid-alive', 'socket-path', 'token-file', 'pipe-connect']);
    expect(JSON.stringify(probe)).not.toContain(FAKE_TOKEN);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(pipe.connections).toBe(1);
    expect(pipe.lines).toEqual([]);
  });

  it('reports a stale entry when the registry file is gone', async () => {
    const { fixture, transport } = await setup('win32');
    const probe = await transport.probe({ ...fixture.session, file: '999999.json' });
    expect(probe.available).toBe(false);
    expect(probe.details['code']).toBe('stale-registry-entry');
    expect(probe.fix).not.toBe('');
  });

  it('reports a dead pid', async () => {
    const { fixture } = await setup('win32');
    const transport = createSocketTransport({ sessionsDir: fixture.dir, settingsPath: fixture.settingsPath, platform: 'win32', isAlive: () => false });
    const probe = await transport.probe(fixture.session);
    expect(probe.available).toBe(false);
    expect(probe.details['code']).toBe('pid-dead');
  });

  it('reports a missing token file on win32', async () => {
    const { fixture, transport } = await setup('win32', { token: null });
    const probe = await transport.probe(fixture.session);
    expect(probe.available).toBe(false);
    expect(probe.details['code']).toBe('no-token-file');
    expect(probe.fix).toMatch(/peerToken/);
  });

  it('reports a pipe that refuses', async () => {
    const { pipe, fixture, transport } = await setup('win32');
    await pipe.close();
    const probe = await transport.probe(fixture.session);
    expect(probe.available).toBe(false);
    expect(probe.details['code']).toBe('pipe-refused');
  });

  it('warns when the session is in bypass-permissions and crossSessionInbound is not accept', async () => {
    const { fixture, transport } = await setup('win32', { settings: { crossSessionInbound: 'hold' } });
    const probe = await transport.probe(fixture.session, { permissionMode: 'bypassPermissions' });
    expect(probe.available).toBe(true);
    expect(probe.details['crossSessionInbound']).toBe('hold');
    expect((probe.details['warnings'] as string[])[0]).toMatch(/bypass-permissions and crossSessionInbound is "hold".*holds the message/);
  });

  it('marks the mode UNVERIFIED when it is unknown and the setting is not accept; no warning at accept', async () => {
    const notSet = await setup('win32', { settings: {} });
    const warned = await notSet.transport.probe(notSet.fixture.session);
    expect(warned.details['crossSessionInbound']).toBeNull();
    expect((warned.details['warnings'] as string[])[0]).toMatch(/UNVERIFIED/);
    const accept = await setup('win32', { settings: { crossSessionInbound: 'accept' } });
    expect((await accept.transport.probe(accept.fixture.session)).details['warnings']).toEqual([]);
  });

  it('survives a settings file that is missing or not JSON', async () => {
    const missing = await setup('win32');
    expect((await missing.transport.probe(missing.fixture.session)).details['crossSessionInboundNote']).toMatch(/does not exist/);
    const bad = await setup('win32', { settings: 'not json {' });
    const probe = await bad.transport.probe(bad.fixture.session);
    expect(probe.available).toBe(true);
    expect(probe.details['crossSessionInboundNote']).toMatch(/not valid JSON/);
  });
});
