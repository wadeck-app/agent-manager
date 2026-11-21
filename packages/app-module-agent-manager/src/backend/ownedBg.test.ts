import { afterEach, describe, expect, it } from 'vitest';
import type { ReplyMessage, ReplyTransport } from '@wadeck-app/agent-manager-core/reply';
import { ID, putSession, useSandbox } from './apiFixtures.js';
import { createDaemonApi } from './daemon/daemonApi.js';
import { ownedView, startFakeDaemon } from './daemon/fakeDaemon.js';
import type { FakeDaemon } from './daemon/fakeDaemon.js';
import { makeModule } from './testKit.js';

/*
 * Background sessions (`claude --bg`, host kind `bg`) through the module: a row that says so, the socket transport (the daemon has no pipe), the refusal
 * texts that name `claude attach`, and the launch of a bg session through the PIN-class route.
 */

const box = useSandbox();
const BG = (): string => ID(process.pid);
const JOB = 'abcd1234';

let daemon: FakeDaemon | undefined;
afterEach(async () => {
  await daemon?.stop();
  daemon = undefined;
});

function fakeSocket(): ReplyTransport & { sent: ReplyMessage[] } {
  const sent: ReplyMessage[] = [];
  return {
    id: 'socket',
    kind: 'direct',
    deliveredAs: 'peer',
    sent,
    describe: () => 'fake socket',
    probe: () => Promise.resolve({ available: true, reason: 'the fake is on', fix: '', details: {} }),
    send: (_session, message) => {
      sent.push(message);
      return Promise.resolve({ accepted: true, detail: 'recorded', sentAt: Date.now() });
    },
  };
}

async function scene(over: Partial<Parameters<typeof ownedView>[0]> = {}) {
  putSession(box, process.pid, { status: 'waiting', waitingFor: 'permission prompt' });
  const fake = await startFakeDaemon(box.config);
  daemon = fake;
  fake.sessions = [ownedView({ id: BG(), hostKind: 'bg', jobId: JOB, state: 'requires_action', bgState: 'blocked', waitingFor: 'permission prompt', attachCommand: `claude attach ${JOB}`, name: 'am-bg', pid: undefined, ...over })];
  const socket = fakeSocket();
  const m = makeModule({ dataDir: box.data, options: { daemon: createDaemonApi({ cacheMs: 0, timeoutMs: 3000 }), transports: [socket] } });
  return { fake, socket, m };
}

describe('a bg session in the list', () => {
  it('is a row of host bg with the supervisor wait named, and no daemon permission request', async () => {
    const { m } = await scene();
    const { body } = await m.call('GET', '/sessions');
    const row = body.sessions.find((entry: { sessionId: string }) => entry.sessionId === BG());
    expect(row).toMatchObject({ launchedBy: 'agent-manager', host: 'bg', ownedState: 'requires_action', pendingPermissions: 0, status: 'waiting', state: 'needs-you' });
  });

  it('GET /owned carries jobId, bgState, waitingFor and the attach command to the page', async () => {
    const { m } = await scene();
    const { body } = await m.call('GET', '/owned');
    expect(body.sessions[0]).toMatchObject({ hostKind: 'bg', jobId: JOB, bgState: 'blocked', waitingFor: 'permission prompt', attachCommand: `claude attach ${JOB}` });
  });
});

describe('replying to a bg session', () => {
  it('goes through the socket transport (a peer message): the daemon is not asked to write', async () => {
    const { fake, socket, m } = await scene({ state: 'idle', waitingFor: undefined });
    const answer = await m.call('POST', `/sessions/${BG()}/reply`, { body: { text: 'continue please' } });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ ok: true, transportId: 'socket', deliveredAs: 'peer' });
    expect(socket.sent).toHaveLength(1);
    expect(fake.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/send'))).toEqual([]);
  });

  it('the status route says why owned is not used and what to do instead', async () => {
    const { m } = await scene();
    const { body } = await m.call('GET', `/sessions/${BG()}/reply/status?probe=all`);
    expect(body.selectedTransportId).toBe('socket');
    expect(body.transports.find((entry: { transportId: string }) => entry.transportId === 'owned')).toMatchObject({
      available: false,
      reason: expect.stringContaining('background session'),
      fix: expect.stringContaining(`claude attach ${JOB}`),
    });
  });

  it('an ended bg session answers 409 owned-session-ended with the resume fix, and sends nothing', async () => {
    const { socket, m } = await scene({ state: 'exited', status: 'exited', resumable: true, waitingFor: undefined, bgState: undefined });
    const answer = await m.call('POST', `/sessions/${BG()}/reply`, { body: { text: 'hello' } });
    expect(answer.status).toBe(409);
    expect(answer.body.error).toMatchObject({ code: 'owned-session-ended', hint: expect.stringContaining('Resume it') });
    expect(socket.sent).toEqual([]);
  });
});

describe('the routes of the owned sessions with a bg session', () => {
  it('launch accepts hostKind bg and passes it to the daemon; a daemon refusal keeps its code and fix', async () => {
    const { fake, m } = await scene();
    const launched = await m.call('POST', '/owned/launch', { body: { hostKind: 'bg', cwd: box.data, model: 'haiku', name: 'am-new' } });
    expect(launched.status).toBe(200);
    expect(fake.requests.find((request) => request.path === '/sessions/launch')?.body).toMatchObject({ hostKind: 'bg', model: 'haiku', name: 'am-new' });
    expect(launched.body.session).toMatchObject({ hostKind: 'bg' });
  });

  it('forget is a sensitive route (it removes the session from the supervisor too)', async () => {
    const { m } = await scene();
    const forgot = m.registered.find((route) => route.key === 'POST /owned/:id/forget');
    expect(forgot?.effect).toBe('sensitive');
  });
});
