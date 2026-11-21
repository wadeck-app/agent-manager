import { afterEach, describe, expect, it } from 'vitest';
import { SENSITIVE_ROUTES } from '../commons/routeClasses.js';
import { ID, useSandbox } from './apiFixtures.js';
import { createDaemonApi } from './daemon/daemonApi.js';
import { ownedView, startFakeDaemon } from './daemon/fakeDaemon.js';
import type { FakeDaemon } from './daemon/fakeDaemon.js';
import { makeModule } from './testKit.js';

// The switch of the host of an owned session (#71): POST /owned/:id/switch {target, force?}, a checked proxy of the daemon. Mock daemon only.

const box = useSandbox();
const START = 'agent-manager start --detach';
const OWNED = ID(21);

let daemon: FakeDaemon | undefined;
afterEach(async () => {
  await daemon?.stop();
  daemon = undefined;
});

const mod = () => makeModule({ dataDir: box.data, options: { daemon: createDaemonApi({ cacheMs: 0, timeoutMs: 3000 }) } });

describe('POST /owned/:id/switch', () => {
  it('asks the daemon to switch and answers the session on its new host with the readiness and the notes', async () => {
    daemon = await startFakeDaemon(box.config);
    daemon.sessions.push(ownedView({ id: OWNED, cwd: box.data, name: 'one', model: 'haiku' }));
    const { status, body } = await mod().call('POST', `/owned/${OWNED}/switch`, { body: { target: 'hc' } });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, from: 'stream-json', to: 'hc', forced: false, readiness: { state: 'free', reasons: [] }, notes: [], session: { id: OWNED, hostKind: 'hc' } });
    expect(daemon.requests.at(-1)).toMatchObject({ method: 'POST', path: `/sessions/${OWNED}/switch`, body: { target: 'hc', force: false } });
  });

  it('passes force only when the body says so', async () => {
    daemon = await startFakeDaemon(box.config);
    daemon.sessions.push(ownedView({ id: OWNED, cwd: box.data }));
    await mod().call('POST', `/owned/${OWNED}/switch`, { body: { target: 'stream-json', force: true } });
    expect(daemon.requests.at(-1)?.body).toEqual({ target: 'stream-json', force: true });
  });

  it('refuses a body that is not what the route takes, with a fix, without calling the daemon', async () => {
    daemon = await startFakeDaemon(box.config);
    const m = mod();
    const before = daemon.requests.length;
    for (const [body, code] of [
      [undefined, 'invalid-body'],
      [{}, 'invalid-field'],
      [{ target: 'bg' }, 'invalid-switch-target'],
      [{ target: 'hc', force: 'yes' }, 'invalid-field'],
      [{ target: 'hc', frce: true }, 'unknown-field'],
    ] as const) {
      const answer = await m.call('POST', `/owned/${OWNED}/switch`, { body });
      expect(answer.status, JSON.stringify(body)).toBe(400);
      expect(answer.body.error.code).toBe(code);
      expect(answer.body.error.hint.length).toBeGreaterThan(10);
    }
    const badId = await m.call('POST', '/owned/not-an-id/switch', { body: { target: 'hc' } });
    expect(badId.status).toBe(400);
    expect(badId.body.error.code).toBe('invalid-id');
    expect(daemon.requests.length).toBe(before);
  });

  it('keeps the refusal of the daemon with its status, code and fix (the page shows the reasons and asks for the confirmation)', async () => {
    daemon = await startFakeDaemon(box.config);
    daemon.sessions.push(ownedView({ id: OWNED, cwd: box.data }));
    daemon.fail.set(`POST /sessions/${OWNED}/switch`, { status: 409, code: 'switch-not-ready', reason: 'the session is not free to move to hc: Tool Bash `node wait.mjs` is running', fix: 'confirm these items and send force: true' });
    const answer = await mod().call('POST', `/owned/${OWNED}/switch`, { body: { target: 'hc' } });
    expect(answer.status).toBe(409);
    expect(answer.body.error).toMatchObject({ code: 'switch-not-ready', message: expect.stringContaining('node wait.mjs'), hint: expect.stringContaining('force') });
    // The shell fetcher keeps only the top-level message: the one code the page acts on travels in front of it.
    expect(answer.body.message).toMatch(/^\[switch-not-ready\] the session is not free/);
  });

  it('says the daemon is not running with the command to start it', async () => {
    daemon = await startFakeDaemon(box.config);
    await daemon.stopCleanly();
    daemon = undefined;
    const down = await mod().call('POST', `/owned/${OWNED}/switch`, { body: { target: 'hc' } });
    expect(down.status).toBe(409);
    expect(down.body.error).toMatchObject({ code: 'daemon-not-running', hint: expect.stringContaining(START) });
  });

  it('a daemon that answers something else than a switch result is a 502 that says the switch may have happened', async () => {
    daemon = await startFakeDaemon(box.config);
    daemon.sessions.push(ownedView({ id: OWNED, cwd: box.data }));
    daemon.switchAnswer = { session: { id: OWNED } };
    const answer = await mod().call('POST', `/owned/${OWNED}/switch`, { body: { target: 'hc' } });
    expect(answer.status).toBe(502);
    // violations-suppress: ts/no-err-message-direct a field of a JSON response body, not a caught Error
    expect(answer.body.error.message).toMatch(/may have been done/);
  });

  it('is sensitive (PIN) and needs the CSRF header like every write route', async () => {
    expect(SENSITIVE_ROUTES).toContain('POST /owned/:id/switch');
    expect(makeModule().registered.find((route) => route.key === 'POST /owned/:id/switch')?.effect).toBe('sensitive');
    const answer = await makeModule().call('POST', `/owned/${OWNED}/switch`, { body: { target: 'hc' }, headers: { 'sec-fetch-site': undefined } });
    expect(answer.status).toBe(403);
    expect(answer.body).toMatchObject({ ok: false, error: { code: 'csrf-required' } });
  });
});
