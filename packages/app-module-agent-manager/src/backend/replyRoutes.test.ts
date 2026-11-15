import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReplyMessage, ReplyTransport } from '@wadeck-app/agent-manager-core/reply';
import { describe, expect, it } from 'vitest';
import { ID, deadPid, putSession, transcriptFile, useSandbox, userLine, writeLines } from './apiFixtures.js';
import { makeModule } from './testKit.js';

const box = useSandbox();

interface FakeTransport extends ReplyTransport {
  sent: ReplyMessage[];
}

/** A transport of this test process: it records the messages, nothing is sent anywhere. */
function fakeTransport(over: { id?: string; available?: boolean } = {}): FakeTransport {
  const sent: ReplyMessage[] = [];
  return {
    id: over.id ?? 'socket',
    kind: 'direct',
    deliveredAs: over.id === 'hc' ? 'typed' : 'peer',
    sent,
    describe: () => 'fake transport of the tests',
    probe: () =>
      Promise.resolve(
        over.available === false
          ? { available: false, reason: 'the fake is switched off', fix: 'switch it on', details: {} }
          : { available: true, reason: 'the fake is on', fix: '', details: { warnings: ['a warning of the probe'] } },
      ),
    send: (_session, message) => {
      sent.push(message);
      return Promise.resolve({ accepted: true, detail: 'recorded', sentAt: Date.now() });
    },
  };
}

// null: the real transports of the module (the socket one). The session of these tests has no socket path, so it can never connect.
const module_ = (transport: ReplyTransport | null = fakeTransport()) => makeModule({ dataDir: box.data, options: transport === null ? {} : { transports: [transport] } });

/** A tiny valid PNG: the signature and padding. */
const png = (size = 64): string => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size - 8, 7)]).toString('base64');

describe('POST /sessions/:sessionId/reply', () => {
  it('sends through the transport with the origin marker, and answers the delivery state', async () => {
    const id = putSession(box, process.pid);
    const transport = fakeTransport();
    const { status, body } = await module_(transport).call('POST', `/sessions/${id}/reply`, { body: { text: 'please continue' } });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, deliveryState: 'sent', deliveryUi: 'delivered', transportId: 'socket', deliveredAs: 'peer', handle: '', messageId: expect.any(String), duplicate: false, auditWarning: '', imagesSaved: 0 });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.text).toContain(`[web reply via agent-manager #${body.messageId}]`);
    expect(transport.sent[0]!.text).toContain('please continue');
    expect(transport.sent[0]).toMatchObject({ priority: 'next', origin: 'web', imagePaths: [] });
  });

  it('the same messageId never sends twice (a retry is safe)', async () => {
    const id = putSession(box, process.pid);
    const transport = fakeTransport();
    const { call } = module_(transport);
    const first = await call('POST', `/sessions/${id}/reply`, { body: { text: 'once', messageId: 'retry-1' } });
    const second = await call('POST', `/sessions/${id}/reply`, { body: { text: 'once', messageId: 'retry-1' } });
    expect(first.body).toMatchObject({ ok: true, duplicate: false, messageId: 'retry-1' });
    expect(second.body).toMatchObject({ ok: true, duplicate: true, messageId: 'retry-1' });
    expect(transport.sent).toHaveLength(1);
  });

  it('saves an image on disk and sends only its path, never the bytes', async () => {
    const id = putSession(box, process.pid);
    const transport = fakeTransport();
    const data = png(128);
    const answer = await module_(transport).call('POST', `/sessions/${id}/reply`, { body: { text: 'look', images: [{ name: 'shot.png', mime: 'image/png', dataBase64: data }] } });
    expect(answer.body).toMatchObject({ ok: true, imagesSaved: 1 });
    const message = transport.sent[0]!;
    expect(message.imagePaths).toHaveLength(1);
    expect(message.imagePaths[0]!.startsWith(join(box.config, 'uploads'))).toBe(true);
    expect(existsSync(message.imagePaths[0]!)).toBe(true);
    expect(message.text).toContain(message.imagePaths[0]);
    expect(message.text).not.toContain(data);
  });

  it('a file that is not an image is a 400 with the fix, and nothing is sent or left on disk', async () => {
    const id = putSession(box, process.pid);
    const transport = fakeTransport();
    const answer = await module_(transport).call('POST', `/sessions/${id}/reply`, { body: { text: 'x', images: [{ name: 'a.png', mime: 'image/png', dataBase64: Buffer.from('hello world, not an image').toString('base64') }] } });
    expect(answer).toMatchObject({ status: 400, body: { ok: false, error: { code: 'unsupported-image', hint: expect.stringContaining('png, jpeg, gif or webp') } } });
    expect(transport.sent).toEqual([]);
  });

  it('an image over the cap is a 400 whose hint says the 1 MiB body limit', async () => {
    const id = putSession(box, process.pid);
    const answer = await module_().call('POST', `/sessions/${id}/reply`, { body: { text: 'x', images: [{ name: 'big.png', mime: 'image/png', dataBase64: png(800 * 1024) }] } });
    expect(answer).toMatchObject({ status: 400, body: { ok: false, error: { code: 'upload-too-large' } } });
    expect(answer.body.error.hint).toContain('1 MiB');
  });

  it('priority now needs the confirmation of the user', async () => {
    const id = putSession(box, process.pid);
    const transport = fakeTransport();
    const { call } = module_(transport);
    const refused = await call('POST', `/sessions/${id}/reply`, { body: { text: 'stop', priority: 'now' } });
    expect(refused).toMatchObject({ status: 400, body: { ok: false, error: { code: 'confirm-now-required', hint: expect.stringContaining('confirmNow') } } });
    expect(transport.sent).toEqual([]);
    const accepted = await call('POST', `/sessions/${id}/reply`, { body: { text: 'stop', priority: 'now', confirmNow: true } });
    expect(accepted.body.ok).toBe(true);
    expect(transport.sent[0]!.priority).toBe('now');
  });

  it.each([
    ['no body', undefined, /JSON object/],
    ['an array', ['x'], /JSON object/],
    ['no text', {}, /'text' must be a string/],
    ['a numeric text', { text: 4 }, /'text' must be a string/],
    ['an unknown field', { text: 'x', extra: 1 }, /Unknown field/],
    ['too many images', { text: 'x', images: [1, 2, 3, 4, 5] }, /at most 4 images/],
    ['an image that is not an object', { text: 'x', images: ['a'] }, /images\[0\] must be an object/],
    ['an image without data', { text: 'x', images: [{ name: 'a', mime: 'image/png' }] }, /needs the text fields/],
    ['a bad priority', { text: 'x', priority: 'later' }, /priority/],
    ['a non boolean confirmNow', { text: 'x', confirmNow: 'yes' }, /confirmNow/],
  ])('refuses %s with a 400 that says what to send', async (_label, body, message) => {
    const id = putSession(box, process.pid);
    const transport = fakeTransport();
    const answer = await module_(transport).call('POST', `/sessions/${id}/reply`, { body });
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ ok: false, error: { code: 'bad-request', hint: expect.any(String) } });
    expect(answer.body.error['message']).toMatch(message);
    expect(transport.sent).toEqual([]);
  });

  it('an empty reply is refused', async () => {
    const id = putSession(box, process.pid);
    const answer = await module_().call('POST', `/sessions/${id}/reply`, { body: { text: '  ' } });
    expect(answer).toMatchObject({ status: 400, body: { error: { code: 'empty-reply' } } });
  });

  it('an unknown session is a 404 and a dead one a 409, both with a hint', async () => {
    putSession(box, process.pid);
    const dead = deadPid();
    const deadId = putSession(box, dead);
    const { call } = module_();
    const unknown = await call('POST', `/sessions/${ID(999_999)}/reply`, { body: { text: 'x' } });
    expect(unknown).toMatchObject({ status: 404, body: { ok: false, error: { code: 'unknown-session', hint: expect.any(String) } } });
    const ended = await call('POST', `/sessions/${deadId}/reply`, { body: { text: 'x' } });
    expect(ended).toMatchObject({ status: 409, body: { ok: false, error: { code: 'session-dead', hint: expect.any(String) } } });
    const unsafe = await call('POST', `/sessions/${encodeURIComponent('../x')}/reply`, { body: { text: 'x' } });
    expect(unsafe.status).toBe(404);
  });

  it('an unavailable transport is an error with the reason and the fix, nothing is sent', async () => {
    const id = putSession(box, process.pid);
    const transport = fakeTransport({ available: false });
    const answer = await module_(transport).call('POST', `/sessions/${id}/reply`, { body: { text: 'x' } });
    expect(answer).toMatchObject({ status: 502, body: { ok: false, error: { code: 'transport-unavailable', message: expect.stringContaining('the fake is switched off'), hint: 'switch it on' } } });
    expect(transport.sent).toEqual([]);
  });

  it('the real socket transport of a session without a socket is an explicit error, and never connects', async () => {
    const id = putSession(box, process.pid);
    const answer = await module_(null).call('POST', `/sessions/${id}/reply`, { body: { text: 'x' } });
    expect(answer.status).toBe(502);
    expect(answer.body).toMatchObject({ ok: false, error: { code: 'transport-unavailable', hint: expect.any(String) } });
    expect(answer.body.error.hint.length).toBeGreaterThan(10);
  });

  it('a transports.json that names a transport the module does not offer is an explicit error with the choices', async () => {
    const id = putSession(box, process.pid);
    writeFileSync(join(box.config, 'transports.json'), JSON.stringify({ default: 'herdr' }));
    const answer = await module_().call('POST', `/sessions/${id}/reply`, { body: { text: 'x' } });
    expect(answer).toMatchObject({ status: 502, body: { ok: false, error: { code: 'unknown-transport', message: expect.stringContaining('socket') } } });
  });

  it('writes an audit record of every send', async () => {
    const id = putSession(box, process.pid);
    await module_().call('POST', `/sessions/${id}/reply`, { body: { text: 'audited' } });
    const files = readdirSync(join(box.config, 'audit'));
    expect(files).toHaveLength(1);
    expect(readFileSync(join(box.config, 'audit', files[0]!), 'utf8')).toContain('audited');
  });
});

describe('GET /sessions/:sessionId/reply/status', () => {
  const statusOf = (id: string, m = module_()) => m.call('GET', `/sessions/${id}/reply/status`);

  it('lists the transports with their availability, the selection and the limits', async () => {
    const id = putSession(box, process.pid);
    const { status, body } = await statusOf(id);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      sessionId: id,
      sessionAlive: true,
      selectedFrom: 'default',
      messages: [],
      warnings: [],
      limits: { maxTextChars: 20000, maxImages: 4, maxImageBytes: 700 * 1024, maxBodyBytes: 1024 * 1024 },
      transports: [{ transportId: 'socket', kind: 'direct', available: true, reason: 'the fake is on', fix: '', warnings: ['a warning of the probe'], selected: true, isDefault: true, sessionOverride: false, deliveredAs: 'peer', deliveredAsText: 'peer message (wrapped by Claude Code)' }],
    });
  });

  it('says why a transport is not available, with the fix', async () => {
    const id = putSession(box, process.pid);
    const { body } = await statusOf(id, module_(fakeTransport({ available: false })));
    expect(body.transports[0]).toMatchObject({ available: false, reason: 'the fake is switched off', fix: 'switch it on' });
  });

  it('shows where the selection comes from: a file, or a session override', async () => {
    const id = putSession(box, process.pid);
    writeFileSync(join(box.config, 'transports.json'), JSON.stringify({ default: 'socket' }));
    expect((await statusOf(id)).body.selectedFrom).toBe('transports.json');
    writeFileSync(join(box.config, 'transports.json'), JSON.stringify({ default: 'socket', perSession: { [id]: 'socket' } }));
    expect((await statusOf(id)).body.selectedFrom).toBe('transports.json (session override)');
  });

  it('a transports.json that names an unknown transport is a warning, not a silent switch', async () => {
    const id = putSession(box, process.pid);
    writeFileSync(join(box.config, 'transports.json'), JSON.stringify({ default: 'herdr' }));
    const { body } = await statusOf(id);
    expect(body.ok).toBe(true);
    expect(body.transports.some((t: { selected: boolean }) => t.selected)).toBe(false);
    expect(body.warnings.join(' ')).toContain("'herdr'");
  });

  it('a corrupt transports.json is an inline error naming the file and what to do', async () => {
    const id = putSession(box, process.pid);
    writeFileSync(join(box.config, 'transports.json'), '{nope');
    const { status, body } = await statusOf(id);
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: false, error: { code: 'transports-invalid', message: expect.stringContaining('transports.json'), hint: expect.stringContaining('delete it') } });
  });

  it('warns that the delivery options of config.yml are not read yet', async () => {
    const id = putSession(box, process.pid);
    writeFileSync(join(box.config, 'config.yml'), 'hintAfter: 30s\n');
    expect((await statusOf(id)).body.warnings.join(' ')).toContain('does not read them yet');
  });

  it('an unknown session is a 404 with a hint', async () => {
    putSession(box, process.pid);
    const answer = await statusOf(ID(999_999));
    expect(answer).toMatchObject({ status: 404, body: { ok: false, error: { code: 'unknown-session', hint: expect.any(String) } } });
  });

  it('follows a reply from sent to seen by the agent, with the transcript as the proof', async () => {
    const id = putSession(box, process.pid);
    const file = transcriptFile(box, id);
    writeLines(file, [userLine(1, 'earlier')]);
    const m = module_();
    const sent = await m.call('POST', `/sessions/${id}/reply`, { body: { text: 'hello agent', images: [{ name: 'a.png', mime: 'image/png', dataBase64: png() }] } });
    const messageId = sent.body.messageId as string;

    const before = (await statusOf(id, m)).body.messages;
    expect(before).toEqual([expect.objectContaining({ messageId, text: 'hello agent', imageCount: 1, transportId: 'socket', priority: 'next', state: 'sent', ui: 'delivered' })]);

    // the session wrote the message as a user line carrying the origin marker
    writeLines(file, [userLine(Math.floor(Date.now() / 1000) - 1_760_000_000 + 10_000_000, `[web reply via agent-manager #${messageId}]\nhello agent`)], true);
    const after = (await statusOf(id, m)).body.messages;
    expect(after[0]).toMatchObject({ messageId, state: 'confirmed', ui: 'seen' });
  });

  it('a send that failed is listed as failed with the reason', async () => {
    const id = putSession(box, process.pid);
    const m = module_(fakeTransport({ available: false }));
    await m.call('POST', `/sessions/${id}/reply`, { body: { text: 'nope' } });
    const { messages } = (await statusOf(id, m)).body;
    expect(messages).toEqual([expect.objectContaining({ text: 'nope', state: 'failed', ui: 'failed', reason: expect.stringContaining('the fake is switched off') })]);
  });

  it('lists at most the last 10 replies of this session, newest first', async () => {
    const id = putSession(box, process.pid);
    const m = module_();
    for (let i = 0; i < 12; i += 1) {
      await m.call('POST', `/sessions/${id}/reply`, { body: { text: `m${i}` } });
    }
    const { messages } = (await statusOf(id, m)).body;
    expect(messages).toHaveLength(10);
    expect(messages[0].text).toBe('m11');
  });
});

describe('transport switching routes', () => {
  const both = (): FakeTransport[] => [fakeTransport({ id: 'socket' }), fakeTransport({ id: 'hc' })];
  const withBoth = () => makeModule({ dataDir: box.data, options: { transports: both() } });
  const config = (): unknown => JSON.parse(readFileSync(join(box.config, 'transports.json'), 'utf8'));

  it('a plain status probes only the selected transport; ?probe=all probes every one (the menu)', async () => {
    const id = putSession(box, process.pid);
    let probes = 0;
    const counting = fakeTransport({ id: 'hc' });
    const probe = counting.probe.bind(counting);
    counting.probe = (...args) => {
      probes += 1;
      return probe(...args);
    };
    const m = makeModule({ dataDir: box.data, options: { transports: [fakeTransport({ id: 'socket' }), counting] } });
    const plain = (await m.call('GET', `/sessions/${id}/reply/status`)).body;
    expect(plain.transports.map((entry: { transportId: string; probed: boolean }) => [entry.transportId, entry.probed])).toEqual([['socket', true], ['hc', false]]);
    expect(probes).toBe(0);
    const all = (await m.call('GET', `/sessions/${id}/reply/status?probe=all`)).body;
    expect(all.transports.every((entry: { probed: boolean }) => entry.probed)).toBe(true);
    expect(probes).toBe(1);
  });

  it('the status lists both transports with how each delivers, the default and the override', async () => {
    const id = putSession(box, process.pid);
    const body = (await withBoth().call('GET', `/sessions/${id}/reply/status`)).body;
    expect(body.selectedTransportId).toBe('socket');
    expect(body.sessionOverrideTransportId).toBeNull();
    expect(body.transports.map((entry: { transportId: string; deliveredAsText: string }) => [entry.transportId, entry.deliveredAsText])).toEqual([
      ['socket', 'peer message (wrapped by Claude Code)'],
      ['hc', 'typed prompt (as the user)'],
    ]);
  });

  it('PUT session transport selects hc for this session only, and null clears it', async () => {
    const id = putSession(box, process.pid);
    const m = withBoth();
    const set = await m.call('PUT', `/sessions/${id}/reply/transport`, { body: { transportId: 'hc' } });
    expect(set).toMatchObject({ status: 200, body: { ok: true, sessionId: id, selectedTransportId: 'hc', sessionOverrideTransportId: 'hc', defaultTransportId: 'socket' } });
    expect(config()).toEqual({ default: 'socket', perSession: { [id]: 'hc' } });
    const status = (await m.call('GET', `/sessions/${id}/reply/status`)).body;
    expect(status).toMatchObject({ selectedTransportId: 'hc', selectedFrom: 'transports.json (session override)' });
    expect(status.transports.find((entry: { transportId: string }) => entry.transportId === 'hc')).toMatchObject({ selected: true, sessionOverride: true, isDefault: false });
    const cleared = await m.call('PUT', `/sessions/${id}/reply/transport`, { body: { transportId: null } });
    expect(cleared.body).toMatchObject({ ok: true, selectedTransportId: 'socket', sessionOverrideTransportId: null });
    expect(config()).toEqual({ default: 'socket', perSession: {} });
  });

  it('a reply then goes through the selected transport, and never through another one', async () => {
    const id = putSession(box, process.pid);
    const [socket, hc] = both() as [FakeTransport, FakeTransport];
    const m = makeModule({ dataDir: box.data, options: { transports: [socket, hc] } });
    await m.call('PUT', `/sessions/${id}/reply/transport`, { body: { transportId: 'hc' } });
    const answer = await m.call('POST', `/sessions/${id}/reply`, { body: { text: 'hello' } });
    expect(answer.body).toMatchObject({ ok: true, transportId: 'hc', deliveredAs: 'typed' });
    expect(hc.sent).toHaveLength(1);
    expect(socket.sent).toHaveLength(0);
  });

  it('a selected transport that cannot deliver fails with its reason: no fallback to the other one', async () => {
    const id = putSession(box, process.pid);
    const socket = fakeTransport({ id: 'socket' });
    const hc = fakeTransport({ id: 'hc', available: false });
    const m = makeModule({ dataDir: box.data, options: { transports: [socket, hc] } });
    await m.call('PUT', `/sessions/${id}/reply/transport`, { body: { transportId: 'hc' } });
    const answer = await m.call('POST', `/sessions/${id}/reply`, { body: { text: 'hello' } });
    expect(answer.body).toMatchObject({ ok: false, error: { code: 'transport-unavailable' } });
    expect(socket.sent).toHaveLength(0);
  });

  it('PUT default changes the default for the sessions without override', async () => {
    const id = putSession(box, process.pid);
    const m = withBoth();
    expect((await m.call('PUT', '/reply/transport/default', { body: { transportId: 'hc' } })).body).toEqual({ ok: true, defaultTransportId: 'hc' });
    expect((await m.call('GET', `/sessions/${id}/reply/status`)).body.selectedTransportId).toBe('hc');
  });

  it('an unknown transport id is a 400 that lists the valid ids, and nothing is written', async () => {
    const id = putSession(box, process.pid);
    const m = withBoth();
    const answer = await m.call('PUT', `/sessions/${id}/reply/transport`, { body: { transportId: 'pigeon' } });
    expect(answer).toMatchObject({ status: 400, body: { ok: false, error: { code: 'unknown-transport', message: expect.stringContaining('socket, hc'), hint: expect.stringContaining('socket, hc') } } });
    expect((await m.call('PUT', '/reply/transport/default', { body: { transportId: 'pigeon' } })).status).toBe(400);
    expect(existsSync(join(box.config, 'transports.json'))).toBe(false);
  });

  it('refuses a bad body, a null default and an unknown session, and writes nothing', async () => {
    const id = putSession(box, process.pid);
    const m = withBoth();
    expect((await m.call('PUT', `/sessions/${id}/reply/transport`, { body: {} })).status).toBe(400);
    expect((await m.call('PUT', `/sessions/${id}/reply/transport`, { body: { transportId: 'hc', extra: 1 } })).status).toBe(400);
    expect((await m.call('PUT', '/reply/transport/default', { body: { transportId: null } })).status).toBe(400);
    expect((await m.call('PUT', '/sessions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/reply/transport', { body: { transportId: 'hc' } })).status).toBe(404);
    expect(existsSync(join(box.config, 'transports.json'))).toBe(false);
  });

  it('POST reply accepts no transport field and says where to choose it', async () => {
    const id = putSession(box, process.pid);
    const answer = await withBoth().call('POST', `/sessions/${id}/reply`, { body: { text: 'x', transportId: 'hc' } });
    expect(answer.status).toBe(400);
    expect(JSON.stringify(answer.body)).toContain('PUT /sessions/:sessionId/reply/transport');
  });
});
