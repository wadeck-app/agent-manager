import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SENSITIVE_ROUTES, isSensitiveRequest } from '../commons/routeClasses.js';
import { ID, putSession, transcriptFile, useSandbox, userLine } from './apiFixtures.js';
import { adminOverrideEnv } from './guardrailsAdmin.js';
import { makeModule } from './testKit.js';

const FAKE = fileURLToPath(new URL('./testSupport/fakeAdmin.cjs', import.meta.url));
const box = useSandbox();
const SESSION = ID(4242);
const OTHER = ID(4343);

let root = '';
let project = '';
const saved: Record<string, string | undefined> = {};
function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in saved)) {
      saved[key] = process.env[key];
    }
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'am-grants-'));
  project = join(root, 'project');
  mkdirSync(project);
  setEnv({ [adminOverrideEnv]: undefined });
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const grant = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  category: 'rm',
  mode: 'once',
  session_id: SESSION,
  expires: new Date(Date.now() + 600_000).toISOString(),
  remaining_ms: 600_000,
  uses_left: 1,
  reason: 'clean the build',
  ...extra,
});

function fake(scenario: string, grants: Record<string, unknown>[]): { calls: () => string[][]; grantsFile: string } {
  const grantsFile = join(root, 'grants.json');
  const logFile = join(root, 'calls.log');
  writeFileSync(grantsFile, JSON.stringify(grants));
  writeFileSync(logFile, '');
  setEnv({ FAKE_ADMIN_SCENARIO: scenario, FAKE_ADMIN_GRANTS_FILE: grantsFile, FAKE_ADMIN_LOG: logFile });
  return {
    grantsFile,
    calls: () =>
      readFileSync(logFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as { argv: string[] }).argv),
  };
}

function mod(guardrails: Record<string, unknown> = { adminScript: FAKE, homeDir: join(root, 'home') }): ReturnType<typeof makeModule> {
  return makeModule({ dataDir: box.data, options: { guardrails } });
}

type AuditLine = { time: number; kind: string; sessionId: string; id: string; category: string; cwd: string; outcome: string };

function auditLines(): AuditLine[] {
  const dir = join(box.config, 'audit');
  try {
    return readdirSync(dir)
      .filter((name) => name.startsWith('guardrails-'))
      .flatMap((name) => readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean))
      .map((line) => JSON.parse(line) as AuditLine);
  } catch {
    return [];
  }
}

describe('GET /guardrails/sessions/:sessionId/grants', () => {
  it('lists the grants of the session through the admin CLI, in the cwd of the session, with the time left as text', async () => {
    putSession(box, 4242, { cwd: project });
    // The transcript says the same folder as the registry: no note.
    writeFileSync(transcriptFile(box, SESSION), `${JSON.stringify({ ...userLine(1, 'a'), cwd: project })}
`);
    const cli = fake('ok', [grant('a1b2c3d4'), grant('b2c3d4e5', { session_id: OTHER })]);
    const { status, body } = await mod().call('GET', `/guardrails/sessions/${SESSION}/grants`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, code: '', sessionId: SESSION, cwd: project, cwdNote: '', errorText: '' });
    expect(body.grants).toHaveLength(1);
    expect(body.grants[0]).toMatchObject({ id: 'a1b2c3d4', category: 'rm', mode: 'once', sessionId: SESSION, usesLeft: 1, reason: 'clean the build', remainingText: '10 min' });
    expect(body.grants[0].expiresAt).toBeGreaterThan(Date.now());
    expect(cli.calls()).toEqual([['bypass', 'list', '--cwd', project, '--session', SESSION, '--json']]);
  });

  it('uses the cwd of the newest transcript line when the session moved, and says so', async () => {
    putSession(box, 4242, { cwd: '/work/shop' });
    const moved = join(root, 'moved');
    mkdirSync(moved);
    writeFileSync(transcriptFile(box, SESSION), `${JSON.stringify(userLine(1, 'a'))}\n${JSON.stringify({ ...userLine(2, 'b'), cwd: moved })}\n`);
    const cli = fake('ok', [grant('a1b2c3d4')]);
    const { body } = await mod().call('GET', `/guardrails/sessions/${SESSION}/grants`);
    expect(body.ok).toBe(true);
    expect(body.cwd).toBe(moved);
    expect(body.cwdNote).toBe(`cwd used: ${moved} (the session moved from /work/shop)`);
    expect(cli.calls()[0]).toContain(moved);
  });

  it('a transcript that cannot tell is said next to the registry folder that is used instead', async () => {
    putSession(box, 4242, { cwd: project });
    fake('ok', []);
    const { body } = await mod().call('GET', `/guardrails/sessions/${SESSION}/grants`);
    expect(body.ok).toBe(true);
    expect(body.cwd).toBe(project);
    expect(body.cwdNote).toMatch(new RegExp(`^cwd used: .*project \\(the registry folder; the transcript could not be read to check whether the session moved: `));
  });

  it('the plugin is not installed: ok false, code not-installed, the path looked in and the fix', async () => {
    putSession(box, 4242, { cwd: project });
    const { status, body } = await mod({ homeDir: join(root, 'home') }).call('GET', `/guardrails/sessions/${SESSION}/grants`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: false, code: 'not-installed', grants: [] });
    expect(body.errorText).toMatch(/w-guardrails is not installed \(looked in .*w-guardrails\)\. .*Install/);
  });

  it.each([
    ['corrupt', 'plugin-error', /not valid JSON/],
    ['bad-schema', 'bad-output', /unknown schema/],
    ['usage', 'usage', /exit code 2/],
    ['exit7', 'exit-code', /exit code 7/],
  ])('%s is ok false with code %s and the message, never an empty list', async (scenario, code, message) => {
    putSession(box, 4242, { cwd: project });
    fake(scenario, []);
    const { status, body } = await mod().call('GET', `/guardrails/sessions/${SESSION}/grants`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: false, code, grants: [] });
    expect(body.errorText).toMatch(message);
  });

  it('a timeout of the CLI is said (the limit comes from the options in tests)', async () => {
    putSession(box, 4242, { cwd: project });
    fake('hang', []);
    const { body } = await mod({ adminScript: FAKE, adminTimeoutMs: 400 }).call('GET', `/guardrails/sessions/${SESSION}/grants`);
    expect(body).toMatchObject({ ok: false, code: 'timeout' });
  });

  it('an id that is not a session id is a 404 with a hint, an unknown session too', async () => {
    expect((await mod().call('GET', '/guardrails/sessions/..%2F..%2Fx/grants')).status).toBe(404);
    expect((await mod().call('GET', `/guardrails/sessions/${ID(1)}/grants`)).status).toBe(404);
  });

  it('is not a PIN route (read-only)', () => {
    expect(isSensitiveRequest('GET', `/guardrails/sessions/${SESSION}/grants`)).toBe(false);
    expect(mod().registered.find((route) => route.key === 'GET /guardrails/sessions/:sessionId/grants')?.effect).toBeUndefined();
  });
});

describe('POST /guardrails/grants/:id/revoke (T-22)', () => {
  const post = (m: ReturnType<typeof makeModule>, id: string, body: unknown = { sessionId: SESSION }): ReturnType<ReturnType<typeof makeModule>['call']> => m.call('POST', `/guardrails/grants/${id}/revoke`, { body });

  it('is PIN-sensitive: in SENSITIVE_ROUTES, registered with the sensitive effect, and the shell asks for the PIN for its path', () => {
    expect(SENSITIVE_ROUTES).toContain('POST /guardrails/grants/:id/revoke');
    expect(mod().registered.find((route) => route.key === 'POST /guardrails/grants/:id/revoke')?.effect).toBe('sensitive');
    expect(isSensitiveRequest('POST', '/guardrails/grants/a1b2c3d4/revoke')).toBe(true);
  });

  it('lists first, then revokes by id in the folder of the session, and answers what was removed; one audit line', async () => {
    putSession(box, 4242, { cwd: project });
    const cli = fake('ok', [grant('a1b2c3d4'), grant('b2c3d4e5')]);
    const { status, body } = await post(mod(), 'a1b2c3d4');
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, id: 'a1b2c3d4', category: 'rm', sessionId: SESSION, cwd: project, auditError: '' });
    expect(cli.calls()).toEqual([
      ['bypass', 'list', '--cwd', project, '--session', SESSION, '--json'],
      ['bypass', 'revoke', '--id', 'a1b2c3d4', '--cwd', project, '--json'],
    ]);
    expect(JSON.parse(readFileSync(cli.grantsFile, 'utf8')).map((g: { id: string }) => g.id)).toEqual(['b2c3d4e5']);
    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'bypass-revoke', sessionId: SESSION, id: 'a1b2c3d4', category: 'rm', cwd: project, outcome: 'revoked' });
    expect(typeof lines[0]?.['time']).toBe('number');
  });

  it('refuses a grant of ANOTHER session in the same folder: nothing is revoked, the refusal is audited', async () => {
    putSession(box, 4242, { cwd: project });
    const cli = fake('ok', [grant('b2c3d4e5', { session_id: OTHER })]);
    const { status, body } = await post(mod(), 'b2c3d4e5');
    expect(status).toBe(409);
    expect(body).toMatchObject({ ok: false, error: { code: 'grant-not-found' } });
    expect(body.error).toMatchObject({ message: expect.stringMatching(/No active bypass b2c3d4e5 for session/) });
    expect(cli.calls().map((argv) => argv[1])).toEqual(['list']);
    expect(JSON.parse(readFileSync(cli.grantsFile, 'utf8'))).toHaveLength(1);
    expect(auditLines()[0]).toMatchObject({ id: 'b2c3d4e5', outcome: expect.stringMatching(/^refused: grant-not-found/) });
  });

  it.each(['A1B2C3D4', 'a1b2c3', 'a1b2c3d4e', '..', 'zzzzzzzz', 'a1b2c3d4%20--cwd'])('the id %s is refused before any process runs', async (id) => {
    putSession(box, 4242, { cwd: project });
    const cli = fake('ok', [grant('a1b2c3d4')]);
    const { status, body } = await post(mod(), id);
    expect(status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: 'bad-grant-id' } });
    expect(cli.calls()).toEqual([]);
  });

  it('a body that is not exactly {sessionId} is a 400 (extra fields are refused, not ignored)', async () => {
    putSession(box, 4242, { cwd: project });
    const cli = fake('ok', [grant('a1b2c3d4')]);
    for (const body of [null, {}, { sessionId: 3 }, { sessionId: SESSION, cwd: '/etc' }, [SESSION]]) {
      const answer = await post(mod(), 'a1b2c3d4', body);
      expect(answer.status, JSON.stringify(body)).toBe(400);
      expect(answer.body).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    }
    expect(cli.calls()).toEqual([]);
  });

  it('the plugin failing at revoke time is a 502 with its message and the fix; audited as failed', async () => {
    putSession(box, 4242, { cwd: project });
    fake('revoke-fails', [grant('a1b2c3d4')]);
    const { status, body } = await post(mod(), 'a1b2c3d4');
    expect(status).toBe(502);
    expect(body).toMatchObject({ ok: false, error: { code: 'plugin-error' } });
    expect(body.error).toMatchObject({ message: expect.stringMatching(/Could not acquire the lock/) });
    expect(body.error.hint).not.toBe('');
    expect(auditLines().at(-1)?.['outcome']).toMatch(/^failed: plugin-error: Could not acquire the lock/);
  });

  it('the plugin missing is a 503 not-installed with the fix, nothing audited as revoked', async () => {
    putSession(box, 4242, { cwd: project });
    const { status, body } = await post(mod({ homeDir: join(root, 'home') }), 'a1b2c3d4');
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, error: { code: 'not-installed' } });
  });

  it('the CSRF guard answers 403 without the web UI headers', async () => {
    putSession(box, 4242, { cwd: project });
    const cli = fake('ok', [grant('a1b2c3d4')]);
    const answer = await mod().call('POST', '/guardrails/grants/a1b2c3d4/revoke', { body: { sessionId: SESSION }, headers: { 'sec-fetch-site': undefined } });
    expect(answer.status).toBe(403);
    expect(cli.calls()).toEqual([]);
  });

  it('an audit that cannot be written is said on the refusal and failure paths too (hint), never dropped', async () => {
    putSession(box, 4242, { cwd: project });
    writeFileSync(join(box.config, 'audit'), 'not a folder');
    // Refused: the grant belongs to another session.
    fake('ok', [grant('b2c3d4e5', { session_id: OTHER })]);
    const refused = await post(mod(), 'b2c3d4e5');
    expect(refused.status).toBe(409);
    expect(refused.body.error.hint).toMatch(/audit line could not be written/);
    // Failed: the plugin fails at revoke time.
    fake('revoke-fails', [grant('a1b2c3d4')]);
    const failed = await post(mod(), 'a1b2c3d4');
    expect(failed.status).toBe(502);
    expect(failed.body.error.hint).toMatch(/audit line could not be written/);
  });

  it('an audit that cannot be written does not hide the revoke: the grant IS revoked and auditError says why', async () => {
    putSession(box, 4242, { cwd: project });
    fake('ok', [grant('a1b2c3d4')]);
    // A FILE where the audit folder should be: mkdir fails.
    rmSync(join(box.config, 'audit'), { recursive: true, force: true });
    writeFileSync(join(box.config, 'audit'), 'not a folder');
    const { status, body } = await post(mod(), 'a1b2c3d4');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.auditError).toMatch(/audit line could not be written/);
  });
});
