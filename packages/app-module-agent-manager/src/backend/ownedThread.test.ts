import { afterEach, describe, expect, it } from 'vitest';
import { ID, putSession, textLine, transcriptFile, useSandbox, userLine, writeLines } from './apiFixtures.js';
import { createDaemonApi } from './daemon/daemonApi.js';
import { ownedView, startFakeDaemon } from './daemon/fakeDaemon.js';
import type { FakeDaemon } from './daemon/fakeDaemon.js';
import { FORK_NAME_MAX, forkNameOf, threadNameOf } from '../commons/forkName.js';
import { makeModule } from './testKit.js';

// Threads (#65): POST /owned/fork with `atMessageId`, the uuid of the log rows, `threadOf` on the rows. Mock daemon only, never a real claude.

const box = useSandbox();
const ANCHOR = '27bf9648-39df-453b-bd04-99816f5c1819';
const OWNED = ID(7);

let daemon: FakeDaemon | undefined;
afterEach(async () => {
  await daemon?.stop();
  daemon = undefined;
});

const mod = () => makeModule({ dataDir: box.data, options: { daemon: createDaemonApi({ cacheMs: 0, timeoutMs: 3000 }) } });

describe('GET /sessions/:id/log exposes the uuid of each entry', () => {
  it('every row carries the uuid of its transcript line (the anchor of a thread)', async () => {
    const id = putSession(box, process.pid);
    const lines = [userLine(0, 'first question'), textLine(1, 'first answer')];
    writeLines(transcriptFile(box, id), lines);
    const answer = await makeModule({ dataDir: box.data }).call('GET', `/sessions/${id}/log`);
    expect(answer.status).toBe(200);
    const entries = answer.body.entries as { kind: string; uuid?: string }[];
    expect(entries.find((entry) => entry.kind === 'user-prompt')?.uuid).toBe(lines[0]?.uuid);
    expect(entries.find((entry) => entry.kind === 'assistant-text')?.uuid).toBe(lines[1]?.uuid);
  });
});

describe('POST /owned/fork with atMessageId (a thread)', () => {
  it('launches a stream-json fork with resumeSessionAt and answers forkedAtMessage', async () => {
    daemon = await startFakeDaemon(box.config);
    const id = putSession(box, 4200, { cwd: box.data, name: 'terminal one' });
    const { status, body } = await mod().call('POST', '/owned/fork', { body: { sourceSessionId: id, atMessageId: ANCHOR.toUpperCase(), name: 'thread: why?' } });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, session: { hostKind: 'stream-json', cwd: box.data, name: 'thread: why?', forkedFrom: id, forkedAtMessage: ANCHOR } });
    expect(daemon.requests.at(-1)).toMatchObject({ method: 'POST', path: '/sessions/launch', body: { hostKind: 'stream-json', forkOf: id, resumeSessionAt: ANCHOR } });
  });

  it('without a name the default says it is a thread, within the limit of the daemon', async () => {
    daemon = await startFakeDaemon(box.config);
    const id = putSession(box, 4201, { cwd: box.data, name: 'terminal one' });
    const { body } = await mod().call('POST', '/owned/fork', { body: { sourceSessionId: id, atMessageId: ANCHOR } });
    expect(body.session.name).toBe('thread of terminal one');
  });

  it('a fork without atMessageId sends no resumeSessionAt', async () => {
    daemon = await startFakeDaemon(box.config);
    const id = putSession(box, 4202, { cwd: box.data });
    await mod().call('POST', '/owned/fork', { body: { sourceSessionId: id } });
    expect(daemon.requests.at(-1)?.body).not.toHaveProperty('resumeSessionAt');
  });

  it('refuses an anchor that is not a uuid with a fix, without calling the daemon', async () => {
    daemon = await startFakeDaemon(box.config);
    const id = putSession(box, 4203, { cwd: box.data });
    const before = daemon.requests.length;
    for (const atMessageId of ['--model', 'abc', '', 42]) {
      const answer = await mod().call('POST', '/owned/fork', { body: { sourceSessionId: id, atMessageId } });
      expect(answer.status, JSON.stringify(atMessageId)).toBe(400);
      expect(answer.body.error.hint.length).toBeGreaterThan(10);
    }
    expect(daemon.requests.length).toBe(before);
  });

  it('keeps the refusals of the daemon: unknown anchor (404) and too many threads (409), each with its fix', async () => {
    daemon = await startFakeDaemon(box.config);
    const id = putSession(box, 4204, { cwd: box.data });
    daemon.fail.set('POST /sessions/launch', { status: 404, code: 'fork-anchor-not-found', reason: 'the message is not in the transcript', fix: 'reload the log and pick a shown message' });
    const unknown = await mod().call('POST', '/owned/fork', { body: { sourceSessionId: id, atMessageId: ANCHOR } });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toMatchObject({ code: 'fork-anchor-not-found', hint: expect.stringContaining('reload the log') });
    daemon.fail.set('POST /sessions/launch', { status: 409, code: 'too-many-threads', reason: '3 threads are live', fix: 'stop one of its threads' });
    const many = await mod().call('POST', '/owned/fork', { body: { sourceSessionId: id, atMessageId: ANCHOR } });
    expect(many.status).toBe(409);
    expect(many.body.error).toMatchObject({ code: 'too-many-threads', hint: expect.stringContaining('stop one') });
  });

  it('a bg or hc source gives a thread too (only its transcript is read); the thread is always a Web session', async () => {
    daemon = await startFakeDaemon(box.config);
    daemon.sessions.push(ownedView({ id: OWNED, hostKind: 'hc', cwd: box.data, name: 'hc one', hcAddress: 't1z' }));
    const forked = await mod().call('POST', '/owned/fork', { body: { sourceSessionId: OWNED, atMessageId: ANCHOR } });
    expect(forked.status).toBe(200);
    expect(forked.body).toMatchObject({ ok: true, session: { hostKind: 'stream-json', forkedFrom: OWNED, forkedAtMessage: ANCHOR } });
  });

  it('needs the CSRF header like every write route (the route is already PIN-sensitive)', async () => {
    const answer = await makeModule().call('POST', '/owned/fork', { body: { sourceSessionId: OWNED, atMessageId: ANCHOR }, headers: { 'sec-fetch-site': undefined } });
    expect(answer.status).toBe(403);
    expect(answer.body).toMatchObject({ ok: false, error: { code: 'csrf-required' } });
  });
});

describe('GET /sessions rows of a thread', () => {
  it('a thread row carries threadOf {sessionId, messageId} next to forkedFrom; a plain fork and a plain session do not', async () => {
    daemon = await startFakeDaemon(box.config);
    const sourceId = putSession(box, process.ppid, { cwd: box.data });
    daemon.sessions.push(
      ownedView({ id: ID(610), cwd: box.data, name: 'thread of x', forkedFrom: sourceId, forkedAtMessage: ANCHOR }),
      ownedView({ id: ID(611), cwd: box.data, name: 'fork of x', forkedFrom: sourceId }),
      ownedView({ id: ID(612), cwd: box.data, name: 'plain' }),
    );
    const { body } = await mod().call('GET', '/sessions');
    const rows = body.sessions as { sessionId: string; forkedFrom?: string; threadOf?: { sessionId: string; messageId: string } }[];
    const thread = rows.find((row) => row.sessionId === ID(610));
    expect(thread?.forkedFrom).toBe(sourceId);
    expect(thread?.threadOf).toEqual({ sessionId: sourceId, messageId: ANCHOR });
    expect(rows.find((row) => row.sessionId === ID(611))).not.toHaveProperty('threadOf');
    expect(rows.find((row) => row.sessionId === ID(612))).not.toHaveProperty('threadOf');
  });

  it('GET /owned keeps forkedAtMessage on the owned session', async () => {
    daemon = await startFakeDaemon(box.config);
    daemon.sessions.push(ownedView({ id: ID(613), cwd: box.data, forkedFrom: ID(1), forkedAtMessage: ANCHOR }));
    const { body } = await mod().call('GET', '/owned');
    expect((body.sessions as { id: string; forkedAtMessage?: string }[]).find((session) => session.id === ID(613))?.forkedAtMessage).toBe(ANCHOR);
  });
});

describe('threadNameOf and the fork name prefix', () => {
  it('threadNameOf is "thread: <first 40 characters of the message>", on one line, never empty', () => {
    expect(threadNameOf('why is the build red?')).toBe('thread: why is the build red?');
    expect(threadNameOf('x'.repeat(100))).toBe(`thread: ${'x'.repeat(40)}`);
    expect(threadNameOf('two\nlines\there')).toBe('thread: two lines here');
    expect(threadNameOf('  \n ')).toBe('thread: message');
    expect(threadNameOf('x'.repeat(100)).length).toBeLessThanOrEqual(FORK_NAME_MAX);
  });

  it('forkNameOf keeps its default prefix and takes another one within the same limit', () => {
    expect(forkNameOf('shop')).toBe('fork of shop');
    expect(forkNameOf('shop', 'thread of')).toBe('thread of shop');
    expect(forkNameOf('x'.repeat(200), 'thread of')).toHaveLength(FORK_NAME_MAX);
  });
});

describe('the quote of a thread (review)', () => {
  it('atMessageQuote is sent to the daemon as forkedAtQuote, comes back on the session and on the row as threadOf.quote', async () => {
    daemon = await startFakeDaemon(box.config);
    const id = putSession(box, 4210, { cwd: box.data });
    const { body } = await mod().call('POST', '/owned/fork', { body: { sourceSessionId: id, atMessageId: ANCHOR, atMessageQuote: 'why red?' } });
    expect(daemon.requests.at(-1)?.body).toMatchObject({ forkedAtQuote: 'why red?', resumeSessionAt: ANCHOR });
    expect(body.session).toMatchObject({ forkedAtMessage: ANCHOR, forkedAtQuote: 'why red?' });
    const rows = (await mod().call('GET', '/sessions')).body.sessions as { sessionId: string; threadOf?: { quote?: string } }[];
    expect(rows.find((row) => row.sessionId === body.session.id)?.threadOf).toMatchObject({ messageId: ANCHOR, quote: 'why red?' });
  });

  it('refuses a quote without an anchor, and one longer than 80 characters, with a fix and without calling the daemon', async () => {
    daemon = await startFakeDaemon(box.config);
    const id = putSession(box, 4211, { cwd: box.data });
    const before = daemon.requests.length;
    const alone = await mod().call('POST', '/owned/fork', { body: { sourceSessionId: id, atMessageQuote: 'q' } });
    expect(alone.status).toBe(400);
    expect(alone.body.error.hint.length).toBeGreaterThan(10);
    const long = await mod().call('POST', '/owned/fork', { body: { sourceSessionId: id, atMessageId: ANCHOR, atMessageQuote: 'q'.repeat(81) } });
    expect(long.status).toBe(400);
    expect(daemon.requests.length).toBe(before);
  });
});
