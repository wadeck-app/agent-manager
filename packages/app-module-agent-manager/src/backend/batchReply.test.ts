import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OutcomeUnknownError, readAudit, type ReplyMessage, type ReplyTransport } from '@wadeck-app/agent-manager-core/reply';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_BATCH_RECIPIENTS } from '../commons/batch.js';
import { CWD, ID, deadPid, putSession, useSandbox } from './apiFixtures.js';
import { makeModule } from './testKit.js';

const box = useSandbox();

interface Probe extends ReplyTransport {
  sent: ReplyMessage[];
  maxInFlight: number;
}

/** A transport of this test process: records the messages; `delayMs` keeps a send in flight, `failFor` throws for the named session ids. */
function fakeTransport(over: { available?: boolean; delayMs?: number; unknownFor?: string[]; refuseFor?: string[] } = {}): Probe {
  let inFlight = 0;
  const probe: Probe = {
    id: 'socket',
    kind: 'direct',
    deliveredAs: 'peer',
    sent: [],
    maxInFlight: 0,
    describe: () => 'fake transport of the tests',
    probe: () => Promise.resolve(over.available === false ? { available: false, reason: 'the fake is switched off', fix: 'switch it on', details: {} } : { available: true, reason: 'on', fix: '', details: {} }),
    send: async (session, message) => {
      inFlight += 1;
      probe.maxInFlight = Math.max(probe.maxInFlight, inFlight);
      try {
        if (over.delayMs !== undefined) {
          await new Promise((resolve) => setTimeout(resolve, over.delayMs));
        }
        if (over.unknownFor?.includes(session.sessionId)) {
          throw new OutcomeUnknownError('send-timeout', 'the socket did not answer in time', 'look at the log of the session before sending again');
        }
        probe.sent.push(message);
        return { accepted: true, detail: 'recorded', sentAt: Date.now() };
      } finally {
        inFlight -= 1;
      }
    },
  };
  return probe;
}

// The registry file of a session is <pid>.json and liveness is the pid: a batch of five needs five live pids. This process, its parent and three idle children (ended after the tests).
const children: ChildProcess[] = [];
beforeAll(() => {
  for (let i = 0; i < 3; i += 1) {
    children.push(spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], { stdio: 'ignore', windowsHide: true }));
  }
});
afterAll(() => {
  for (const child of children) {
    child.kill();
  }
});

/** A live session of the registry: number n (1 to 5) takes the n-th live pid, its id is ID(n) and its name agent-n. */
function live(n: number, fields: Record<string, unknown> = {}): string {
  const pids = [process.pid, process.ppid, ...children.map((child) => child.pid ?? 0)];
  const pid = pids[n - 1];
  if (pid === undefined || pid <= 0) {
    throw new Error(`no live pid for session number ${n} (the test has ${pids.length})`);
  }
  const sessionId = ID(n);
  writeFileSync(join(box.registry, `${pid}.json`), JSON.stringify({ pid, sessionId, cwd: CWD, version: '2.1.323', status: 'idle', statusUpdatedAt: Date.now() - 60_000, name: `agent-${n}`, ...fields }));
  return sessionId;
}

const mod = (transport: ReplyTransport) => makeModule({ dataDir: box.data, options: { transports: [transport] } });
const batch = (call: ReturnType<typeof mod>['call'], body: unknown, headers?: Record<string, string | undefined>) => call('POST', '/sessions/batch/reply', { body, ...(headers === undefined ? {} : { headers }) });

describe('POST /sessions/batch/reply', () => {
  it('sends the same text to every recipient and answers one result per recipient, in the order asked, with its name', async () => {
    const [a, b, c] = [live(1), live(2), live(3)] as [string, string, string];
    const transport = fakeTransport();
    const { status, body } = await batch(mod(transport).call, { ids: [c, a, b], text: 'please wrap up' });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.results.map((r: { id: string }) => r.id)).toEqual([c, a, b]);
    expect(body.results).toEqual([
      { id: c, name: 'agent-3', state: 'sent', reason: '' },
      { id: a, name: 'agent-1', state: 'sent', reason: '' },
      { id: b, name: 'agent-2', state: 'sent', reason: '' },
    ]);
    expect(transport.sent.map((m) => m.text)).toEqual(['please wrap up', 'please wrap up', 'please wrap up']);
    expect(body.counts).toEqual({ sent: 3, queued: 0, refused: 0, 'maybe-sent': 0, failed: 0 });
  });

  it('one recipient that cannot be reached does not stop the others: a dead and an unknown session are refused with the reason, the rest is sent', async () => {
    const good = live(1);
    const dead = putSession(box, deadPid());
    const unknown = ID(777_777);
    const transport = fakeTransport();
    const { body } = await batch(mod(transport).call, { ids: [dead, good, unknown], text: 'hello' });
    const byId = Object.fromEntries(body.results.map((r: { id: string }) => [r.id, r]));
    expect(byId[good]).toMatchObject({ state: 'sent' });
    expect(byId[dead]).toMatchObject({ state: 'refused', reason: expect.stringContaining('session') });
    expect(byId[unknown]).toMatchObject({ state: 'refused', reason: expect.stringContaining('No session') });
    expect(transport.sent).toHaveLength(1);
  });

  it('a transport that is not available refuses every recipient with the reason and the fix, nothing is sent', async () => {
    const ids = [live(1), live(2)];
    const transport = fakeTransport({ available: false });
    const { status, body } = await batch(mod(transport).call, { ids, text: 'hello' });
    expect(status).toBe(200);
    expect(body.results.map((r: { state: string }) => r.state)).toEqual(['refused', 'refused']);
    expect(body.results[0].reason).toContain('the fake is switched off');
    expect(body.results[0].reason).toContain('switch it on');
    expect(transport.sent).toEqual([]);
  });

  it('an outcome that is not known is "maybe-sent", is told apart from a failure and is never retried', async () => {
    const [a, b] = [live(1), live(2)] as [string, string];
    const transport = fakeTransport({ unknownFor: [a] });
    const { body } = await batch(mod(transport).call, { ids: [a, b], text: 'hello' });
    expect(body.results[0]).toMatchObject({ id: a, state: 'maybe-sent', reason: expect.stringContaining('did not answer in time') });
    expect(body.results[1]).toMatchObject({ id: b, state: 'sent' });
    expect(body.counts).toMatchObject({ 'maybe-sent': 1, sent: 1 });
    // One attempt for a: the module has no retry of its own.
    expect(transport.sent).toHaveLength(1);
  });

  it('runs at most 2 sends at a time (and does use the 2)', async () => {
    const ids = [1, 2, 3, 4, 5].map((n) => live(n));
    const transport = fakeTransport({ delayMs: 15 });
    const { body } = await batch(mod(transport).call, { ids, text: 'hello' });
    expect(body.results.every((r: { state: string }) => r.state === 'sent')).toBe(true);
    expect(transport.maxInFlight).toBe(2);
  });

  it('writes one audit line per recipient', async () => {
    const ids = [live(1), live(2), live(3)];
    await batch(mod(fakeTransport()).call, { ids, text: 'audit me' });
    const audit = await readAudit(box.config, { limit: 50 });
    expect(audit.records.filter((record) => record.text === 'audit me' && record.outcome === 'sent').map((record) => record.sessionId).sort()).toEqual([...ids].sort());
  });

  it('a repeated requestId never sends twice: the second answer says it was already sent', async () => {
    const ids = [live(1), live(2)];
    const transport = fakeTransport();
    const { call } = mod(transport);
    const first = await batch(call, { ids, text: 'once', requestId: 'batch-1' });
    const second = await batch(call, { ids, text: 'once', requestId: 'batch-1' });
    expect(first.body.results.map((r: { state: string }) => r.state)).toEqual(['sent', 'sent']);
    expect(second.body.results.map((r: { state: string; reason: string }) => [r.state, r.reason])).toEqual([
      ['sent', 'already sent with this request id'],
      ['sent', 'already sent with this request id'],
    ]);
    expect(transport.sent).toHaveLength(2);
  });

  describe('the request is checked as a whole before anything is sent', () => {
    const cases: [string, unknown, RegExp][] = [
      ['more than the cap', { ids: Array.from({ length: MAX_BATCH_RECIPIENTS + 1 }, (_, i) => ID(i + 1)), text: 'x' }, new RegExp(`at most ${MAX_BATCH_RECIPIENTS}`)],
      ['no recipient', { ids: [], text: 'x' }, /at least one/],
      ['ids that is not a list', { ids: ID(1), text: 'x' }, /'ids' must be a list/],
      ['a recipient that is not a session id', { ids: ['../x'], text: 'x' }, /not a session id/],
      ['the same recipient twice', { ids: [ID(1), ID(1)], text: 'x' }, /twice/],
      ['an empty text', { ids: [ID(1)], text: '   ' }, /text must not be empty/],
      ['a text that is not a string', { ids: [ID(1)], text: 5 }, /'text' must be a string/],
      ['an unknown field', { ids: [ID(1)], text: 'x', images: [] }, /Unknown field/],
      ['an unsafe request id', { ids: [ID(1)], text: 'x', requestId: 'a b' }, /requestId/],
    ];
    for (const [name, body, message] of cases) {
      it(`${name}: 400 with the reason and what to do, nothing sent`, async () => {
        live(1);
        const transport = fakeTransport();
        const { status, body: answer } = await batch(mod(transport).call, body);
        expect(status).toBe(400);
        expect(answer).toMatchObject({ ok: false, error: { code: 'bad-request', hint: expect.any(String) } });
        expect(answer.error['message']).toMatch(message);
        expect(transport.sent).toEqual([]);
      });
    }

    it('the cap is exactly MAX_BATCH_RECIPIENTS (20)', () => {
      expect(MAX_BATCH_RECIPIENTS).toBe(20);
    });
  });

  it('keeps the CSRF guard: 403 without the web UI headers', async () => {
    const { status, body } = await batch(mod(fakeTransport()).call, { ids: [ID(1)], text: 'x' }, { 'sec-fetch-site': undefined });
    expect(status).toBe(403);
    expect(body).toMatchObject({ ok: false, error: { code: 'csrf-required' } });
  });
});
