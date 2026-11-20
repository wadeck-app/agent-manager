import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { isPidAlive } from '../pidAlive.js';
import { removeDir } from '../testFixtures.js';
import { LaunchError } from './errors.js';
import { StreamJsonSession } from './StreamJsonSession.js';
import type { StreamJsonSessionOptions } from './StreamJsonSession.js';
import { buildStreamJsonArgs } from './streamJsonArgs.js';
import type { SessionEvent } from './types.js';

const FAKE_CLAUDE = fileURLToPath(new URL('./testSupport/fakeClaude.mjs', import.meta.url));

const sessions: StreamJsonSession[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    if (session.exitInfo === undefined) {
      await session.kill();
    }
  }
  for (const dir of dirs.splice(0)) {
    removeDir(dir);
  }
});

/** One line of the log of the fake claude: its argv at start, a received line, or the end of stdin. */
interface LogEntry {
  argv?: string[];
  cwd?: string;
  received?: string;
  stdinEnded?: boolean;
}

interface Harness {
  session: StreamJsonSession;
  events: SessionEvent[];
  dir: string;
  logFile: string;
  /** Resolves with the first event (already seen or future) that matches. */
  until: (predicate: (event: SessionEvent) => boolean, what: string) => Promise<SessionEvent>;
  /** The lines the fake claude received and its argv, from its log. */
  log: () => LogEntry[];
}

async function startFake(options: Partial<StreamJsonSessionOptions> = {}, env: Record<string, string> = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'agent-manager-launch-'));
  dirs.push(dir);
  const cwd = join(dir, 'project folder (x)');
  mkdirSync(cwd);
  const logFile = join(dir, 'fake-claude.ndjson');
  const session = await StreamJsonSession.start({ cwd, command: process.execPath, commandArgs: [FAKE_CLAUDE], env: { ...process.env, FAKE_CLAUDE_LOG: logFile, ...env }, closeTimeoutMs: 5000, controlTimeoutMs: 10_000, ...options });
  sessions.push(session);
  const events: SessionEvent[] = [];
  const waiters: { predicate: (event: SessionEvent) => boolean; resolve: (event: SessionEvent) => void }[] = [];
  session.subscribe((event) => {
    events.push(event);
    for (const waiter of [...waiters]) {
      if (waiter.predicate(event)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(event);
      }
    }
  });
  return {
    session,
    events,
    dir,
    logFile,
    until: (predicate, what) => {
      const seen = events.find(predicate);
      if (seen !== undefined) {
        return Promise.resolve(seen);
      }
      // A guard against a hang, never a performance limit.
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${what}; events so far: ${events.map((event) => event.kind).join(', ')}`)), 20_000);
        waiters.push({
          predicate,
          resolve: (event) => {
            clearTimeout(timer);
            resolve(event);
          },
        });
      });
    },
    log: () =>
      readFileSync(logFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as LogEntry),
  };
}

const kinds = (events: readonly SessionEvent[]): string[] => events.map((event) => event.kind);
const lifecycleStates = (events: readonly SessionEvent[]): string[] => events.flatMap((event) => (event.kind === 'lifecycle' ? [event.state] : []));
const assistantTexts = (events: readonly SessionEvent[]): string[] => events.flatMap((event) => (event.kind === 'assistant' ? [event.text] : []));
const isExit = (event: SessionEvent): boolean => event.kind === 'exit';
const isResult = (event: SessionEvent): boolean => event.kind === 'result';
const isPermission = (event: SessionEvent): boolean => event.kind === 'permission_request';

async function rejection(promise: Promise<unknown>): Promise<LaunchError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LaunchError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a LaunchError, the promise resolved');
}

describe('buildStreamJsonArgs', () => {
  it('builds the proven invocation as an argument array', () => {
    expect(buildStreamJsonArgs({ permissionMode: 'default', model: 'haiku', sessionId: '7b0f6378-600e-4596-bc3c-cfef5f4c6508' })).toEqual([
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--replay-user-messages', '--permission-prompt-tool', 'stdio',
      '--include-partial-messages', '--permission-mode', 'default', '--model', 'haiku', '--session-id', '7b0f6378-600e-4596-bc3c-cfef5f4c6508',
    ]);
  });

  it('builds a resume and can leave the partial messages out', () => {
    const args = buildStreamJsonArgs({ resume: 'abc-123', includePartialMessages: false });
    expect(args.slice(-2)).toEqual(['--resume', 'abc-123']);
    expect(args).not.toContain('--include-partial-messages');
    expect(args).not.toContain('--session-id');
  });

  it('never passes a force or a dangerous flag', () => {
    const joined = buildStreamJsonArgs({ permissionMode: 'acceptEdits', model: 'haiku' }).join(' ').toLowerCase();
    expect(joined).not.toContain('force');
    expect(joined).not.toContain('dangerously');
    expect(joined).not.toContain('allowedtools');
  });

  it('refuses a value that could be read as a flag or hold a command', () => {
    expect(() => buildStreamJsonArgs({ model: '--dangerously-skip-permissions' })).toThrow(LaunchError);
    expect(() => buildStreamJsonArgs({ model: 'haiku; rm -rf /' })).toThrow(/model/);
    expect(() => buildStreamJsonArgs({ permissionMode: '--x' })).toThrow(/permission mode/);
    expect(() => buildStreamJsonArgs({ permissionMode: 'a b' })).toThrow(LaunchError);
    expect(() => buildStreamJsonArgs({ sessionId: 'not-a-uuid' })).toThrow(/UUID/);
    expect(() => buildStreamJsonArgs({ resume: '../x' })).toThrow(LaunchError);
  });

  it('refuses a new session id together with a resume, and every refusal carries a fix', () => {
    const error = (() => {
      try {
        buildStreamJsonArgs({ sessionId: '7b0f6378-600e-4596-bc3c-cfef5f4c6508', resume: 'abc' });
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(LaunchError);
    expect((error as LaunchError).fix).not.toBe('');
    expect((error as LaunchError).message).toContain('Fix:');
  });
});

describe('StreamJsonSession start', () => {
  it('starts without a shell in a folder whose name has spaces and brackets, with the built arguments and a generated session id', async () => {
    const harness = await startFake({ model: 'haiku', permissionMode: 'default' });
    const { session } = harness;
    expect(session.pid).toBeGreaterThan(0);
    expect(session.state).toBe('idle');
    expect(session.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    await (await session.send('hello')).completed;
    const [first] = harness.log();
    expect(first?.argv).toEqual(session.args);
    expect(session.args).toContain('--session-id');
    expect(session.args).toContain(session.sessionId);
    expect(String(first?.cwd).toLowerCase()).toContain('project folder (x)');
  });

  it('resumes with the given id and no --session-id', async () => {
    const harness = await startFake({ resume: 'resume-id-1' });
    expect(harness.session.sessionId).toBe('resume-id-1');
    expect(harness.session.args).toContain('--resume');
    expect(harness.session.args).not.toContain('--session-id');
  });

  it('fails with a fix when the program is missing', async () => {
    const error = await rejection(StreamJsonSession.start({ cwd: tmpdir(), command: 'claude-does-not-exist-agent-manager' }));
    expect(error.code).toBe('claude-missing');
    expect(error.fix).toContain('claude --version');
  });

  it('fails with a fix when the folder does not exist or is a file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-manager-launch-'));
    dirs.push(dir);
    const missing = await rejection(StreamJsonSession.start({ cwd: join(dir, 'nope'), command: process.execPath, commandArgs: [FAKE_CLAUDE] }));
    expect(missing.code).toBe('cwd-missing');
    const file = await rejection(StreamJsonSession.start({ cwd: FAKE_CLAUDE, command: process.execPath, commandArgs: [FAKE_CLAUDE] }));
    expect(file.code).toBe('cwd-not-a-folder');
  });

  it('refuses an invalid option before any process exists', async () => {
    const error = await rejection(StreamJsonSession.start({ cwd: tmpdir(), command: process.execPath, commandArgs: [FAKE_CLAUDE], model: '-x' }));
    expect(error.code).toBe('invalid-model');
  });
});

describe('StreamJsonSession send and delivery', () => {
  it('delivers a message: lifecycle, init, deltas, assistant, result, in order, and settles started and completed', async () => {
    const harness = await startFake({ permissionMode: 'default' });
    const sent = await harness.session.send('hello world');
    expect(sent.uuid).toMatch(/^[0-9a-f-]{36}$/);
    await sent.started;
    expect(await sent.completed).toBe('completed');
    await harness.until((event) => event.kind === 'state' && event.state === 'idle', 'idle after the turn');
    expect(lifecycleStates(harness.events)).toEqual(['queued', 'started', 'completed']);
    expect(assistantTexts(harness.events)).toEqual(['ECHO: hello world [mode: default]']);
    const deltas = harness.events.flatMap((event) => (event.kind === 'text_delta' ? [event.text] : []));
    expect(deltas.join('')).toBe('ECHO: hello world [mode: default]');
    const order = kinds(harness.events).filter((kind) => ['lifecycle', 'init', 'user_replay', 'result'].includes(kind));
    expect(order).toEqual(['lifecycle', 'lifecycle', 'init', 'user_replay', 'result', 'lifecycle']);
    const result = harness.events.find((event) => event.kind === 'result');
    expect(result).toMatchObject({ subtype: 'success', isError: false, stopReason: 'end_turn' });
    const replay = harness.events.find((event) => event.kind === 'user_replay');
    expect(replay).toMatchObject({ uuid: sent.uuid });
    expect(harness.events.filter((event) => event.kind === 'state').map((event) => (event.kind === 'state' ? event.state : ''))).toEqual(['running', 'idle']);
    expect(harness.session.state).toBe('idle');
  });

  it('writes the user frame as proven: type user, client uuid, message with role and string content', async () => {
    const harness = await startFake();
    const sent = await harness.session.send('plain text');
    await sent.completed;
    const received = harness.log().find((entry) => typeof entry.received === 'string');
    expect(JSON.parse(String(received?.received))).toEqual({ type: 'user', uuid: sent.uuid, message: { role: 'user', content: 'plain text' } });
  });

  it('sends images as base64 blocks after the text', async () => {
    const harness = await startFake();
    const sent = await harness.session.send('what colour', [{ mediaType: 'image/png', dataBase64: 'iVBORw0KGgo=' }]);
    await sent.completed;
    const received = JSON.parse(String(harness.log().find((entry) => typeof entry.received === 'string')?.received)) as { message: { content: unknown } };
    expect(received.message.content).toEqual([
      { type: 'text', text: 'what colour' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
    ]);
    expect(assistantTexts(harness.events)[0]).toContain('[images: image/png]');
  });

  it('refuses an empty message, an unsupported image type and data that is not base64, with a fix', async () => {
    const { session } = await startFake();
    expect((await rejection(session.send('   '))).code).toBe('empty-message');
    const type = await rejection(session.send('x', [{ mediaType: 'image/svg+xml', dataBase64: 'AAAA' }]));
    expect(type.code).toBe('invalid-image');
    expect(type.fix).toContain('image/png');
    expect((await rejection(session.send('x', [{ mediaType: 'image/png', dataBase64: 'data:image/png;base64,AAAA' }]))).code).toBe('invalid-image');
  });

  it('queues a second message behind the first and completes both in order', async () => {
    const harness = await startFake();
    const first = await harness.session.send('first');
    const second = await harness.session.send('second');
    expect(await Promise.all([first.completed, second.completed])).toEqual(['completed', 'completed']);
    expect(assistantTexts(harness.events)).toEqual(['ECHO: first [mode: default]', 'ECHO: second [mode: default]']);
  });

  it('forwards unknown lines, other system lines and unhandled control requests instead of dropping them', async () => {
    const harness = await startFake();
    const sent = await harness.session.send('UNKNOWNEVENT CTLREQ');
    await sent.completed;
    expect(harness.events.find((event) => event.kind === 'unknown')).toMatchObject({ type: 'brand_new_event' });
    expect(harness.events.find((event) => event.kind === 'system')).toMatchObject({ subtype: 'thinking_tokens' });
    expect(harness.events.find((event) => event.kind === 'unsupported_control_request')).toMatchObject({ subtype: 'hook_callback' });
    expect(harness.session.pendingPermissions()).toEqual([]);
  });

  it('reports a line that is not JSON and keeps going', async () => {
    const harness = await startFake();
    await (await harness.session.send('GARBAGE')).completed;
    const errors = harness.events.flatMap((event) => (event.kind === 'protocol_error' ? [event] : []));
    expect(errors.map((event) => event.code)).toEqual(['bad-json', 'bad-json']);
    expect(errors[0]?.detail).toContain('this is not json');
    expect(assistantTexts(harness.events)).toHaveLength(1);
  });

  it('drops a line above the limit with a protocol error and keeps going', async () => {
    const harness = await startFake({ maxLineChars: 100_000 });
    await (await harness.session.send('BIGLINE')).completed;
    const errors = harness.events.flatMap((event) => (event.kind === 'protocol_error' ? [event] : []));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'line-too-large' });
    expect(errors[0]?.detail).toContain('300000');
  });

  it('reassembles a line that arrives in two pieces', async () => {
    const harness = await startFake();
    await (await harness.session.send('SPLIT')).completed;
    expect(assistantTexts(harness.events)).toEqual(['ECHO: SPLIT [mode: default]']);
    expect(harness.events.some((event) => event.kind === 'protocol_error')).toBe(false);
  });

  it('keeps going when a listener throws, and tells the other listeners', async () => {
    const harness = await startFake();
    harness.session.subscribe(() => {
      throw new Error('listener bug');
    });
    await (await harness.session.send('hello')).completed;
    expect(harness.events.some((event) => event.kind === 'protocol_error' && event.code === 'listener-failed')).toBe(true);
    expect(harness.session.listenerFailures[0]).toContain('listener bug');
    expect(harness.session.listenerFailures.length).toBeLessThanOrEqual(20);
  });

  it('stops delivering events to a listener that unsubscribed', async () => {
    const harness = await startFake();
    const seen: string[] = [];
    const unsubscribe = harness.session.subscribe((event) => seen.push(event.kind));
    unsubscribe();
    await (await harness.session.send('hello')).completed;
    expect(seen).toEqual([]);
  });
});

describe('StreamJsonSession interrupt', () => {
  it('interrupts a running turn: the receipt, a cancelled message, an error result, and the session answers the next message', async () => {
    const harness = await startFake();
    const slow = await harness.session.send('SLOW please');
    await harness.until((event) => event.kind === 'text_delta', 'the first delta');
    await slow.started;
    expect(harness.session.state).toBe('running');
    const receipt = await harness.session.interrupt();
    expect(receipt).toEqual({ stillQueued: [] });
    expect(await slow.completed).toBe('cancelled');
    expect(harness.events.find(isResult)).toMatchObject({ subtype: 'error_during_execution', isError: true });
    expect(lifecycleStates(harness.events)).toEqual(['queued', 'started', 'cancelled']);
    const next = await harness.session.send('after');
    expect(await next.completed).toBe('completed');
    expect(assistantTexts(harness.events).at(-1)).toContain('ECHO: after');
  });

  it('reports the messages that stay queued', async () => {
    const harness = await startFake();
    const slow = await harness.session.send('SLOW');
    const queued = await harness.session.send('later');
    await harness.until((event) => event.kind === 'text_delta', 'the first delta');
    const receipt = await harness.session.interrupt();
    expect(receipt.stillQueued).toEqual([queued.uuid]);
    expect(await slow.completed).toBe('cancelled');
    expect(await queued.completed).toBe('completed');
  });

  it('succeeds with nothing to interrupt, as the real claude does', async () => {
    const { session } = await startFake();
    expect(await session.interrupt()).toEqual({ stillQueued: [] });
  });

  it('writes the control_request frame as proven', async () => {
    const harness = await startFake();
    await harness.session.interrupt();
    const frame = JSON.parse(String(harness.log().find((entry) => typeof entry.received === 'string')?.received)) as { type: string; request_id: string; request: unknown };
    expect(frame.type).toBe('control_request');
    expect(frame.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(frame.request).toEqual({ subtype: 'interrupt' });
  });
});

describe('StreamJsonSession set_permission_mode', () => {
  it('changes the mode and resolves with the mode claude reports', async () => {
    const harness = await startFake({ permissionMode: 'default' });
    expect(await harness.session.setPermissionMode('acceptEdits')).toBe('acceptEdits');
    await (await harness.session.send('hello')).completed;
    expect(assistantTexts(harness.events)[0]).toContain('[mode: acceptEdits]');
    const frame = JSON.parse(String(harness.log().find((entry) => typeof entry.received === 'string')?.received)) as { request: unknown };
    expect(frame.request).toEqual({ subtype: 'set_permission_mode', mode: 'acceptEdits' });
  });

  it('refuses a mode that is not a single word before writing anything', async () => {
    const harness = await startFake();
    expect((await rejection(harness.session.setPermissionMode('--evil flag'))).code).toBe('invalid-permission-mode');
    // A later message proves the process was running and shows what it received: only that message.
    await (await harness.session.send('hi')).completed;
    const received = harness.log().flatMap((entry) => (typeof entry.received === 'string' ? [JSON.parse(entry.received) as { type: string }] : []));
    expect(received.map((frame) => frame.type)).toEqual(['user']);
  });

  it('rejects with the text of claude when it refuses the request', async () => {
    const { session } = await startFake();
    const error = await rejection(session.setPermissionMode('refuse'));
    expect(error.code).toBe('control-refused');
    expect(error.reason).toContain('mode refused by the fake');
    expect(error.fix).not.toBe('');
  });

  it('times out with a fix when claude never answers', async () => {
    const { session } = await startFake({ controlTimeoutMs: 200 }, { FAKE_CLAUDE_IGNORE_CONTROL: '1' });
    const error = await rejection(session.interrupt());
    expect(error.code).toBe('control-timeout');
    expect(error.fix).toContain('kill()');
  });

  it('rejects a control request that is still waiting when the process ends', async () => {
    const { session } = await startFake({ controlTimeoutMs: 20_000 }, { FAKE_CLAUDE_IGNORE_CONTROL: '1' });
    const pending = rejection(session.interrupt());
    await session.kill();
    expect((await pending).code).toBe('session-exited');
  });
});

describe('StreamJsonSession permissions', () => {
  it('queues a can_use_tool request, blocks the state, and allows it with the original input', async () => {
    const harness = await startFake();
    const sent = await harness.session.send('PERMIT run it');
    const event = await harness.until(isPermission, 'the permission request');
    const pending = harness.session.pendingPermissions();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ toolName: 'Bash', displayName: 'Bash', description: 'Create fake.txt', toolUseId: 'toolu_fake1', blockedPath: 'fake.txt', input: { command: 'touch fake.txt', description: 'Create fake.txt' } });
    expect(pending[0]?.permissionSuggestions).toHaveLength(1);
    expect(event).toMatchObject({ kind: 'permission_request', request: { requestId: pending[0]?.requestId } });
    expect(harness.session.state).toBe('requires_action');
    await harness.session.allow(pending[0]?.requestId ?? '');
    expect(await sent.completed).toBe('completed');
    expect(assistantTexts(harness.events).at(-1)).toBe('ALLOWED {"command":"touch fake.txt","description":"Create fake.txt"}');
    expect(harness.session.pendingPermissions()).toEqual([]);
    expect(harness.events.find((e) => e.kind === 'permission_resolved')).toMatchObject({ behavior: 'allow' });
    // The control_response of the proven shape, request_id echoed, suggestions never echoed.
    const answer = harness.log().flatMap((entry) => (typeof entry.received === 'string' ? [JSON.parse(entry.received) as { type: string; response: object }] : [])).find((frame) => frame.type === 'control_response');
    expect(answer).toEqual({ type: 'control_response', response: { subtype: 'success', request_id: pending[0]?.requestId, response: { behavior: 'allow', updatedInput: { command: 'touch fake.txt', description: 'Create fake.txt' } } } });
  });

  it('allows with an edited input', async () => {
    const harness = await startFake();
    const sent = await harness.session.send('PERMIT');
    await harness.until(isPermission, 'the permission request');
    await harness.session.allow(harness.session.pendingPermissions()[0]?.requestId ?? '', { command: 'echo safe' });
    await sent.completed;
    expect(assistantTexts(harness.events).at(-1)).toBe('ALLOWED {"command":"echo safe"}');
  });

  it('denies with a message the model receives', async () => {
    const harness = await startFake();
    const sent = await harness.session.send('PERMIT');
    await harness.until(isPermission, 'the permission request');
    const requestId = harness.session.pendingPermissions()[0]?.requestId ?? '';
    await harness.session.deny(requestId, 'Denied by the test');
    await sent.completed;
    expect(assistantTexts(harness.events).at(-1)).toBe('DENIED:Denied by the test');
    expect(harness.events.find((e) => e.kind === 'permission_resolved')).toMatchObject({ behavior: 'deny' });
    const answer = harness.log().flatMap((entry) => (typeof entry.received === 'string' ? [JSON.parse(entry.received) as { type: string; response: unknown }] : [])).find((frame) => frame.type === 'control_response');
    expect(answer?.response).toEqual({ subtype: 'success', request_id: requestId, response: { behavior: 'deny', message: 'Denied by the test' } });
  });

  it('forwards the echo of the answer as a control_response event', async () => {
    const harness = await startFake();
    const sent = await harness.session.send('PERMIT');
    await harness.until(isPermission, 'the permission request');
    await harness.session.allow(harness.session.pendingPermissions()[0]?.requestId ?? '');
    await sent.completed;
    expect(harness.events.some((event) => event.kind === 'control_response')).toBe(true);
  });

  it('refuses an unknown or already answered request id, and a denial without a message', async () => {
    const harness = await startFake();
    const sent = await harness.session.send('PERMIT');
    await harness.until(isPermission, 'the permission request');
    const requestId = harness.session.pendingPermissions()[0]?.requestId ?? '';
    expect((await rejection(harness.session.allow('nope'))).code).toBe('unknown-permission-request');
    expect((await rejection(harness.session.deny(requestId, '  '))).code).toBe('empty-deny-message');
    // The failed denial did not consume the request.
    expect(harness.session.pendingPermissions()).toHaveLength(1);
    await harness.session.allow(requestId);
    await sent.completed;
    expect((await rejection(harness.session.allow(requestId))).code).toBe('unknown-permission-request');
  });

  it('ends a pending permission with process-ended when the process is killed, and rejects the delivery', async () => {
    const harness = await startFake();
    const sent = await harness.session.send('PERMIT');
    await harness.until(isPermission, 'the permission request');
    const requestId = harness.session.pendingPermissions()[0]?.requestId ?? '';
    await harness.session.kill();
    expect(harness.events.find((e) => e.kind === 'permission_resolved')).toMatchObject({ requestId, behavior: 'process-ended' });
    expect(harness.session.pendingPermissions()).toEqual([]);
    expect((await rejection(sent.completed)).code).toBe('session-exited');
    expect((await rejection(harness.session.allow(requestId))).code).toBe('unknown-permission-request');
  });
});

describe('StreamJsonSession exit', () => {
  it('reports a crash with the exit code and the stderr tail, rejects the delivery and refuses later sends with a fix', async () => {
    const harness = await startFake();
    const sent = await harness.session.send('CRASH now');
    const exit = await harness.until(isExit, 'the exit');
    expect(exit).toMatchObject({ kind: 'exit', info: { cause: 'crashed', code: 3, signal: null } });
    const info = harness.session.exitInfo;
    expect(info?.stderrTail).toContain('fake claude crashed: boom');
    expect(info?.error).toBeInstanceOf(LaunchError);
    expect((info?.error as LaunchError).code).toBe('claude-crashed');
    expect((info?.error as LaunchError).message).toContain('boom');
    expect((info?.error as LaunchError).fix).toContain('resume');
    expect(harness.session.state).toBe('exited');
    expect((await rejection(sent.completed)).code).toBe('session-exited');
    const later = await rejection(harness.session.send('again'));
    expect(later.code).toBe('session-exited');
    expect(later.message).toContain('boom');
    expect((await rejection(harness.session.interrupt())).code).toBe('session-exited');
    expect(await harness.session.waitForExit()).toBe(info);
  });

  it('bounds the stderr tail', async () => {
    const harness = await startFake({ stderrTailChars: 10 });
    await harness.session.send('CRASH');
    await harness.until(isExit, 'the exit');
    expect(harness.session.exitInfo?.stderrTail.length).toBeLessThanOrEqual(10);
  });

  it('reports a clean exit nobody asked for as exited, with an error that says so', async () => {
    const harness = await startFake();
    await harness.session.send('EXITCLEAN');
    await harness.until(isExit, 'the exit');
    expect(harness.session.exitInfo).toMatchObject({ cause: 'exited', code: 0 });
    expect((harness.session.exitInfo?.error as LaunchError).code).toBe('claude-exited');
  });

  it('close() ends the process cleanly after closing stdin', async () => {
    const harness = await startFake();
    await (await harness.session.send('hello')).completed;
    const info = await harness.session.close();
    expect(info).toMatchObject({ cause: 'closed', code: 0 });
    expect(info.error).toBeUndefined();
    expect(harness.log().some((entry) => entry.stdinEnded === true)).toBe(true);
    expect(await harness.session.close()).toBe(info);
    expect(isPidAlive(harness.session.pid)).toBe(false);
  });

  it('close() kills the process when it does not end within the timeout', async () => {
    const harness = await startFake({ closeTimeoutMs: 300 }, { FAKE_CLAUDE_HANG_ON_CLOSE: '1' });
    const pid = harness.session.pid;
    const info = await harness.session.close();
    expect(info.cause).toBe('killed');
    expect(isPidAlive(pid)).toBe(false);
  });

  it('kill() ends the process at once, even in the middle of a turn', async () => {
    const harness = await startFake();
    const slow = await harness.session.send('SLOW');
    await harness.until((event) => event.kind === 'text_delta', 'the first delta');
    const pid = harness.session.pid;
    const info = await harness.session.kill();
    expect(info.cause).toBe('killed');
    expect(isPidAlive(pid)).toBe(false);
    expect((await rejection(slow.completed)).code).toBe('session-exited');
    expect(await harness.session.kill()).toBe(info);
  });

  it('refuses to send once close() has closed stdin', async () => {
    const harness = await startFake({ closeTimeoutMs: 5000 }, { FAKE_CLAUDE_HANG_ON_CLOSE: '1' });
    const closing = harness.session.close();
    const error = await rejection(harness.session.send('late'));
    expect(['session-closing', 'session-exited']).toContain(error.code);
    expect(error.fix).not.toBe('');
    await harness.session.kill();
    await closing;
  });
});

/**
 * A child process that is driven by hand: the tests decide when its `exit` and its `close` happen, which is the window between the two that a real
 * process only shows when something else holds its pipes open (not reproducible on Windows: a grandchild does not keep the pipes of node open).
 */
class ManualChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 4242;
  readonly signals: string[] = [];
  kill(signal?: string): boolean {
    this.signals.push(signal ?? 'SIGTERM');
    return true;
  }
}

async function startManual(): Promise<{ session: StreamJsonSession; child: ManualChild; events: SessionEvent[] }> {
  const child = new ManualChild();
  const dir = mkdtempSync(join(tmpdir(), 'agent-manager-launch-'));
  dirs.push(dir);
  // The platform is not win32 on purpose: a kill goes to the fake child, never to a real pid through taskkill.
  const starting = StreamJsonSession.start({ cwd: dir, platform: 'linux', command: 'unused', spawnProcess: () => {
    // The 'spawn' event comes after the caller attached its listeners.
    setTimeout(() => child.emit('spawn'), 0);
    return child as unknown as ChildProcessWithoutNullStreams;
  } });
  const session = await starting;
  sessions.push(session);
  const events: SessionEvent[] = [];
  session.subscribe((event) => events.push(event));
  return { session, child, events };
}

const line = (value: Record<string, unknown>): string => `${JSON.stringify(value)}\n`;
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

describe('StreamJsonSession in the window between the exit of the process and the close of its pipes', () => {
  it('keeps a crash a crash when kill() comes late, signals nothing, and drains the last unfinished line before the exited state', async () => {
    const { session, child, events } = await startManual();
    child.stderr.write('boom\n');
    child.stdout.write('{"type":"system","subtype":"tail"}');
    await tick();
    child.emit('exit', 3, null);
    const killing = session.kill();
    // The process ended by itself: the pid is not signalled.
    expect(child.signals).toEqual([]);
    child.emit('close', 3, null);
    const info = await killing;
    expect(info).toMatchObject({ cause: 'crashed', code: 3 });
    expect(info.stderrTail).toContain('boom');
    const order = events.filter((event) => event.kind === 'system' || event.kind === 'state' || event.kind === 'exit').map((event) => (event.kind === 'system' ? `system:${event.subtype}` : event.kind === 'state' ? `state:${event.state}` : 'exit'));
    expect(order).toEqual(['system:tail', 'state:exited', 'exit']);
  });

  it('delivers the unfinished last line before the state turns to exited when a turn was running', async () => {
    const { session, child, events } = await startManual();
    const sent = await session.send('hello');
    child.stdout.write(line({ type: 'command_lifecycle', command_uuid: sent.uuid, state: 'queued' }));
    child.stdout.write('{"type":"system","subtype":"tail"}');
    await tick();
    child.emit('exit', 0, null);
    child.emit('close', 0, null);
    await session.waitForExit();
    const order = events.flatMap((event) => (event.kind === 'system' ? [`system:${event.subtype}`] : event.kind === 'state' ? [`state:${event.state}`] : event.kind === 'exit' ? ['exit'] : []));
    expect(order.indexOf('system:tail')).toBeLessThan(order.indexOf('state:exited'));
    expect(order.at(-1)).toBe('exit');
  });

  it('delivers nothing after the exit event', async () => {
    const { session, child, events } = await startManual();
    child.emit('exit', 3, null);
    child.emit('close', 3, null);
    await session.waitForExit();
    child.stdout.write(line({ type: 'system', subtype: 'late' }));
    child.stdin.emit('error', new Error('EPIPE late'));
    await tick();
    expect(events.at(-1)?.kind).toBe('exit');
    expect(events.some((event) => event.kind === 'system' && event.subtype === 'late')).toBe(false);
    expect(events.some((event) => event.kind === 'protocol_error')).toBe(false);
  });

  it('does not put a pending permission back when the process is gone, and reports it once as process-ended', async () => {
    const { session, child, events } = await startManual();
    child.stdout.write(line({ type: 'control_request', request_id: 'req-1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'x' } } }));
    await tick();
    expect(session.pendingPermissions()).toHaveLength(1);
    // The process dies while the answer is being written: the write fails after the exit was reported.
    child.stdin.write = ((_data: unknown, callback?: (error?: Error | null) => void) => {
      setTimeout(() => {
        child.emit('exit', 5, null);
        child.emit('close', 5, null);
        callback?.(new Error('write EPIPE'));
      }, 0);
      return true;
    }) as typeof child.stdin.write;
    const error = await rejection(session.allow('req-1'));
    expect(error.code).toBe('session-exited');
    expect(session.pendingPermissions()).toEqual([]);
    expect(events.filter((event) => event.kind === 'permission_resolved')).toEqual([{ kind: 'permission_resolved', requestId: 'req-1', behavior: 'process-ended' }]);
    expect(session.exitInfo).toMatchObject({ cause: 'crashed', code: 5 });
  });
});

describe('StreamJsonSession close() after the process ended by itself', () => {
  it('keeps the cause of the exit', async () => {
    const harness = await startFake();
    await harness.session.send('EXITCLEAN');
    await harness.until(isExit, 'the exit');
    expect((await harness.session.close()).cause).toBe('exited');
  });
});

describe('StreamJsonSession concurrent answers', () => {
  it('refuses a second answer for a request that is being answered', async () => {
    const harness = await startFake();
    const sent = await harness.session.send('PERMIT');
    await harness.until(isPermission, 'the permission request');
    const requestId = harness.session.pendingPermissions()[0]?.requestId ?? '';
    const first = harness.session.allow(requestId);
    const second = rejection(harness.session.deny(requestId, 'too late'));
    expect((await second).code).toBe('permission-being-answered');
    await first;
    await sent.completed;
    expect(assistantTexts(harness.events).at(-1)).toContain('ALLOWED');
  });
});
