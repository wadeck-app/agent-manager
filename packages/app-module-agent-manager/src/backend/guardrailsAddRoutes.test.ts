import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SENSITIVE_ROUTES, isSensitiveRequest } from '../commons/routeClasses.js';
import { ID, putSession, transcriptFile, useSandbox, userLine } from './apiFixtures.js';
import { adminOverrideEnv } from './guardrailsAdmin.js';
import { makeModule } from './testKit.js';

// Add a bypass (POST /guardrails/sessions/:id/grants) and the rules route, threat-model T-23. The plugin is the FAKE script testSupport/fakeAdmin.cjs.
const FAKE = fileURLToPath(new URL('./testSupport/fakeAdmin.cjs', import.meta.url));
const box = useSandbox();
const SESSION = ID(4242);
const OTHER = ID(4343);
const TOKEN = 'pin-token-SECRET.v4lue_9';

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
  root = mkdtempSync(join(tmpdir(), 'am-add-'));
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

interface Raw {
  argv: string[];
  stdin: string;
  tokenInEnv: boolean;
}

function fake(scenario: string, grants: Record<string, unknown>[] = []): { calls: () => Raw[]; grantsFile: string } {
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
        .map((line) => JSON.parse(line) as Raw),
  };
}

const mod = (): ReturnType<typeof makeModule> => makeModule({ dataDir: box.data, options: { guardrails: { adminScript: FAKE, homeDir: join(root, 'home') } } });
const bearer = { authorization: `Bearer ${TOKEN}` };
const good = { category: 'rm', mode: '10m', rationale: 'clean the build folder' };

function post(m: ReturnType<typeof makeModule>, body: unknown = good, headers: Record<string, string | undefined> = bearer, session: string = SESSION): ReturnType<ReturnType<typeof makeModule>['call']> {
  return m.call('POST', `/guardrails/sessions/${session}/grants`, { body, headers });
}

function auditText(): string {
  const dir = join(box.config, 'audit');
  try {
    return readdirSync(dir)
      .filter((name) => name.startsWith('guardrails-'))
      .map((name) => readFileSync(join(dir, name), 'utf8'))
      .join('');
  } catch {
    return '';
  }
}
const auditLines = (): Record<string, unknown>[] =>
  auditText()
    .split('\n')
    .filter(Boolean)
    .map((line): Record<string, unknown> => JSON.parse(line));

describe('POST /guardrails/sessions/:sessionId/grants: the class of the route', () => {
  it('is PIN-sensitive: in SENSITIVE_ROUTES, registered with the sensitive effect, and the shell asks for the PIN for its path', () => {
    expect(SENSITIVE_ROUTES).toContain('POST /guardrails/sessions/:sessionId/grants');
    expect(mod().registered.find((route) => route.key === 'POST /guardrails/sessions/:sessionId/grants')?.effect).toBe('sensitive');
    expect(isSensitiveRequest('POST', `/guardrails/sessions/${SESSION}/grants`)).toBe(true);
    // The list stays a plain read.
    expect(isSensitiveRequest('GET', `/guardrails/sessions/${SESSION}/grants`)).toBe(false);
  });

  it('the CSRF guard answers 403 without the web UI headers, and nothing runs', async () => {
    putSession(box, 4242, { cwd: project });
    const cli = fake('ok');
    const answer = await mod().call('POST', `/guardrails/sessions/${SESSION}/grants`, { body: good, headers: { ...bearer, 'sec-fetch-site': undefined } });
    expect(answer.status).toBe(403);
    expect(cli.calls()).toEqual([]);
  });
});

describe('POST /guardrails/sessions/:sessionId/grants: the happy path and the token', () => {
  it('checks the rules, grants in the folder of the session with the token on stdin, answers the grant, writes ONE audit line without the token', async () => {
    putSession(box, 4242, { cwd: project });
    const cli = fake('ok');
    const { status, body } = await post(mod());
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, id: 'c0ffee01', category: 'rm', mode: '10m', sessionId: SESSION, cwd: project, origin: 'ui', auditError: '' });
    expect(body.expiresAt).toBeGreaterThan(Date.now());
    const calls = cli.calls();
    expect(calls.map((call) => call.argv.slice(0, 2))).toEqual([['rules', '--cwd'], ['bypass', 'grant']]);
    expect(calls[0]?.argv).toEqual(['rules', '--cwd', project, '--json']);
    expect(calls[1]?.argv).toEqual(['bypass', 'grant', '--cwd', project, '--category', 'rm', '--mode', '10m', '--session', SESSION, '--rationale', 'clean the build folder', '--json']);
    expect(calls[1]?.stdin).toBe(TOKEN);
    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: 'bypass-grant', sessionId: SESSION, id: 'c0ffee01', category: 'rm', mode: '10m', cwd: project, outcome: 'granted', rationale: 'clean the build folder' });
    expect(JSON.parse(readFileSync(cli.grantsFile, 'utf8'))).toHaveLength(1);
  });

  it('the token appears nowhere: not in argv, not in the environment of the child, not in the audit file, not in the response', async () => {
    putSession(box, 4242, { cwd: project });
    const cli = fake('ok');
    const { body } = await post(mod());
    for (const call of cli.calls()) {
      expect(call.argv.join('\u0000')).not.toContain(TOKEN);
      expect(call.tokenInEnv).toBe(false);
    }
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(auditText()).not.toContain(TOKEN);
    expect(Object.values(process.env).join('\n')).not.toContain(TOKEN);
  });

  it('the token is not in any failure either: a plugin that echoes it, in the response and in the audit', async () => {
    putSession(box, 4242, { cwd: project });
    fake('grant-echo-token');
    const { status, body } = await post(mod());
    expect(status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(auditText()).not.toContain(TOKEN);
    expect(auditText()).toMatch(/failed/);
  });

  it('git-commit-push: the base id of the answer is returned', async () => {
    putSession(box, 4242, { cwd: project });
    fake('ok');
    const { body } = await post(mod(), { ...good, category: 'git-commit-push' });
    expect(body).toMatchObject({ ok: true, category: 'git-commit-push', id: 'c0ffee01' });
  });
});

describe('POST /guardrails/sessions/:sessionId/grants: the Authorization header', () => {
  it.each([[undefined], [''], ['Basic abc'], ['Bearer'], ['Bearer '], ['Bearer a b'], ['Bearer  x'], [`Bearer ${'a'.repeat(5000)}`], ['bearer-x']])('%s is refused with an actionable error before any process runs', async (header) => {
    putSession(box, 4242, { cwd: project });
    const cli = fake('ok');
    const { status, body } = await post(mod(), good, { authorization: header });
    expect(status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: 'pin-token-missing' } });
    expect(body.error.hint).toMatch(/PIN/);
    expect(cli.calls()).toEqual([]);
    expect(auditLines()).toEqual([]);
  });
});

describe('POST /guardrails/sessions/:sessionId/grants: the body', () => {
  it.each([
    ['not an object', null],
    ['an array', [good]],
    ['no category', { mode: 'once', rationale: 'x' }],
    ['a category with a space and a flag', { ...good, category: 'rm --force' }],
    ['an upper-case category', { ...good, category: 'RM' }],
    ['a mode outside the four', { ...good, mode: '1h' }],
    ['a mode that is a number', { ...good, mode: 10 }],
    ['no rationale', { category: 'rm', mode: 'once' }],
    ['an empty rationale', { ...good, rationale: '' }],
    ['a blank rationale', { ...good, rationale: '   ' }],
    ['a rationale over 300 characters', { ...good, rationale: 'x'.repeat(301) }],
    ['a rationale with a newline', { ...good, rationale: 'one\ntwo' }],
    ['a rationale with a control character', { ...good, rationale: 'a\u0007b' }],
    ['a rationale with a line separator', { ...good, rationale: 'a\u2028b' }],
    ['an unknown field (cwd)', { ...good, cwd: '/etc' }],
    ['an unknown field (token)', { ...good, token: 'x' }],
  ])('%s is a 400 bad-request, nothing runs, no audit', async (_name, body) => {
    putSession(box, 4242, { cwd: project });
    const cli = fake('ok');
    const answer = await post(mod(), body);
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    expect(answer.body.error.hint).not.toBe('');
    expect(cli.calls()).toEqual([]);
    expect(auditLines()).toEqual([]);
  });

  it('a rationale of exactly 300 characters is accepted and passed as it is', async () => {
    putSession(box, 4242, { cwd: project });
    const cli = fake('ok');
    const rationale = `${String.fromCharCode(233).repeat(299)}.`;
    const answer = await post(mod(), { ...good, rationale });
    expect(answer.status).toBe(200);
    expect(cli.calls()[1]?.argv).toContain(rationale);
  });

  it('a rationale that looks like a flag is data, never a flag: it stays one argv element after --rationale', async () => {
    putSession(box, 4242, { cwd: project });
    const cli = fake('ok');
    await post(mod(), { ...good, rationale: '--category secrets-leak --mode 4h' });
    const argv = cli.calls()[1]?.argv ?? [];
    expect(argv.indexOf('--rationale')).toBeGreaterThan(-1);
    expect(argv[argv.indexOf('--rationale') + 1]).toBe('--category secrets-leak --mode 4h');
    expect(argv.filter((part) => part === '--category')).toHaveLength(1);
  });
});

describe('POST /guardrails/sessions/:sessionId/grants: the session and its folder', () => {
  it('an id that is not a session id is a 404 and an unknown session too, nothing runs', async () => {
    const cli = fake('ok');
    expect((await post(mod(), good, bearer, '..%2F..%2Fx')).status).toBe(404);
    expect((await post(mod(), good, bearer, ID(1))).status).toBe(404);
    expect(cli.calls()).toEqual([]);
  });

  it('uses the CURRENT folder of the session (the newest transcript cwd), like the list and the revoke', async () => {
    putSession(box, 4242, { cwd: '/work/shop' });
    const moved = join(root, 'moved');
    mkdirSync(moved);
    writeFileSync(transcriptFile(box, SESSION), `${JSON.stringify(userLine(1, 'a'))}\n${JSON.stringify({ ...userLine(2, 'b'), cwd: moved })}\n`);
    const cli = fake('ok');
    const { body } = await post(mod());
    expect(body).toMatchObject({ ok: true, cwd: moved });
    expect(cli.calls().every((call) => call.argv.includes(moved))).toBe(true);
    expect(auditLines()[0]).toMatchObject({ cwd: moved });
  });

  it('only the session of the path gets the grant: another session id never appears in the grant call', async () => {
    putSession(box, 4242, { cwd: project });
    putSession(box, 4343, { cwd: project });
    const cli = fake('ok');
    await post(mod());
    const grantCall = cli.calls().find((call) => call.argv[1] === 'grant');
    expect(grantCall?.argv).toContain(SESSION);
    expect(grantCall?.argv).not.toContain(OTHER);
  });
});

describe('POST /guardrails/sessions/:sessionId/grants: the category is checked against the rules first', () => {
  it('a category that is not bypassable is a 409 that says why; the grant is never called; the refusal is audited', async () => {
    putSession(box, 4242, { cwd: project });
    const cli = fake('ok');
    const { status, body } = await post(mod(), { ...good, category: 'ssh-config' });
    expect(status).toBe(409);
    expect(body).toMatchObject({ ok: false, error: { code: 'not-bypassable' } });
    expect(body.error['message']).toMatch(/'ssh-config' cannot be bypassed/);
    expect(body.error['message']).toMatch(/hardcoded/);
    expect(cli.calls().map((call) => call.argv[0])).toEqual(['rules']);
    expect(auditLines()[0]).toMatchObject({ kind: 'bypass-grant', category: 'ssh-config', outcome: expect.stringMatching(/^refused: not-bypassable/) });
  });

  it('an unknown category is a 400 that lists some bypassable categories', async () => {
    putSession(box, 4242, { cwd: project });
    const cli = fake('ok');
    const { status, body } = await post(mod(), { ...good, category: 'no-such-category' });
    expect(status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: 'unknown-category' } });
    expect(body.error.hint).toMatch(/rm/);
    expect(cli.calls().map((call) => call.argv[0])).toEqual(['rules']);
  });

  it('a category the rules route lists as bypassable is passed even when the rules carry a config error', async () => {
    putSession(box, 4242, { cwd: project });
    fake('ok');
    setEnv({ FAKE_ADMIN_RULES_CONFIG_ERROR: 'guardrails.json: unexpected token' });
    expect((await post(mod())).status).toBe(200);
  });
});

describe('POST /guardrails/sessions/:sessionId/grants: what the plugin refuses becomes an actionable message', () => {
  it.each([
    ['grant-elevation', 409, 'pin-expired', /The PIN was entered more than 10 minutes ago: enter it again and retry/, /elevation-required/],
    ['grant-pin-not-set', 409, 'pin-not-set', /No PIN is set/, /app-core-cli pin set/],
    ['grant-unreachable', 502, 'app-core-unreachable', /could not reach app-core/, /ECONNREFUSED/],
    ['grant-spam', 409, 'spam-lock', /too many/i, /Spam lock active/],
    ['grant-not-bypassable', 409, 'not-bypassable', /cannot be bypassed/, /is not bypassable/],
  ])('%s: HTTP %i, code %s, the original text is kept in the hint', async (scenario, status, code, message, original) => {
    putSession(box, 4242, { cwd: project });
    fake(scenario);
    const answer = await post(mod());
    expect(answer.status).toBe(status);
    expect(answer.body).toMatchObject({ ok: false, error: { code } });
    expect(answer.body.error['message']).toMatch(message);
    expect(`${answer.body.error['message']} ${answer.body.error.hint}`).toMatch(original);
    expect(auditLines().at(-1)?.['outcome']).toMatch(new RegExp(`^failed: ${code === 'not-bypassable' ? 'not-bypassable' : '.*'}`));
  });

  it('never answers 401 or 403 (the shell fetcher would read it as a PIN refusal and ask again)', async () => {
    putSession(box, 4242, { cwd: project });
    for (const scenario of ['grant-elevation', 'grant-pin-not-set', 'grant-unreachable', 'grant-spam', 'grant-not-bypassable']) {
      fake(scenario);
      const { status } = await post(mod());
      expect([401, 403]).not.toContain(status);
    }
  });

  it('a grant answered for another category is a 502 bad-output that says a grant may exist; audited', async () => {
    putSession(box, 4242, { cwd: project });
    fake('grant-wrong-category');
    const { status, body } = await post(mod());
    expect(status).toBe(502);
    expect(body).toMatchObject({ ok: false, error: { code: 'bad-output' } });
    expect(body.error['message']).toMatch(/may have been created/);
    expect(auditLines()[0]?.['outcome']).toMatch(/^failed: bad-output/);
  });

  it('the plugin missing is a 503 not-installed with the fix and nothing is audited as granted', async () => {
    putSession(box, 4242, { cwd: project });
    const answer = await makeModule({ dataDir: box.data, options: { guardrails: { homeDir: join(root, 'home') } } }).call('POST', `/guardrails/sessions/${SESSION}/grants`, { body: good, headers: bearer });
    expect(answer.status).toBe(503);
    expect(answer.body).toMatchObject({ ok: false, error: { code: 'not-installed' } });
  });
});

describe('POST /guardrails/sessions/:sessionId/grants: double submit and audit', () => {
  it('a second identical request while the first runs is a 409 duplicate-request: the plugin is called once', async () => {
    putSession(box, 4242, { cwd: project });
    const cli = fake('grant-slow');
    const m = mod();
    const [first, second] = await Promise.all([post(m), post(m)]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const refused = first.status === 409 ? first : second;
    expect(refused.body).toMatchObject({ ok: false, error: { code: 'duplicate-request' } });
    expect(cli.calls().filter((call) => call.argv[1] === 'grant')).toHaveLength(1);
  });

  it('the same category for another session is not a duplicate', async () => {
    putSession(box, 4242, { cwd: project });
    putSession(box, 4343, { cwd: project });
    fake('grant-slow');
    const m = mod();
    const [first, second] = await Promise.all([post(m), post(m, good, bearer, OTHER)]);
    expect([first.status, second.status]).toEqual([200, 200]);
  });

  it('after a failure the same request can be retried at once', async () => {
    putSession(box, 4242, { cwd: project });
    const m = mod();
    fake('grant-elevation');
    expect((await post(m)).status).toBe(409);
    fake('ok');
    expect((await post(m)).status).toBe(200);
  });

  it('an audit that cannot be written does not hide the grant: it IS made and auditError says why', async () => {
    putSession(box, 4242, { cwd: project });
    fake('ok');
    writeFileSync(join(box.config, 'audit'), 'not a folder');
    const { status, body } = await post(mod());
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.auditError).toMatch(/audit line could not be written/);
  });

  it('an audit problem on a refusal path is in the answer too (the hint), never dropped', async () => {
    putSession(box, 4242, { cwd: project });
    fake('ok');
    writeFileSync(join(box.config, 'audit'), 'not a folder');
    const { status, body } = await post(mod(), { ...good, category: 'ssh-config' });
    expect(status).toBe(409);
    expect(body.error.hint).toMatch(/audit line could not be written/);
  });
});

describe('GET /guardrails/sessions/:sessionId/rules', () => {
  it('is a plain read, not PIN-gated', () => {
    expect(isSensitiveRequest('GET', `/guardrails/sessions/${SESSION}/rules`)).toBe(false);
    expect(mod().registered.find((route) => route.key === 'GET /guardrails/sessions/:sessionId/rules')?.effect).toBeUndefined();
  });

  it('answers the categories of the folder of the session with decision, source and bypassable', async () => {
    putSession(box, 4242, { cwd: project });
    const cli = fake('ok');
    const { status, body } = await mod().call('GET', `/guardrails/sessions/${SESSION}/rules`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, code: '', sessionId: SESSION, cwd: project, configPresent: false, configError: '', errorText: '' });
    expect(body.categories.find((c: { name: string }) => c.name === 'git-push')).toEqual({ name: 'git-push', decision: 'ask', source: 'config', bypassable: true, hardcoded: false });
    expect(body.categories.find((c: { name: string }) => c.name === 'ssh-config')).toMatchObject({ bypassable: false, hardcoded: true });
    expect(cli.calls().map((call) => call.argv)).toEqual([['rules', '--cwd', project, '--json']]);
  });

  it('carries the config error of the plugin', async () => {
    putSession(box, 4242, { cwd: project });
    fake('ok');
    setEnv({ FAKE_ADMIN_RULES_CONFIG_ERROR: 'guardrails.json: unexpected token' });
    const { body } = await mod().call('GET', `/guardrails/sessions/${SESSION}/rules`);
    expect(body).toMatchObject({ ok: true, configError: 'guardrails.json: unexpected token', configPresent: true });
  });

  it.each([
    ['bad-schema', 'bad-output'],
    ['usage', 'usage'],
    ['corrupt', 'plugin-error'],
  ])('%s is ok false with code %s, never an empty list', async (scenario, code) => {
    putSession(box, 4242, { cwd: project });
    fake(scenario);
    const { status, body } = await mod().call('GET', `/guardrails/sessions/${SESSION}/rules`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: false, code, categories: [] });
    expect(body.errorText).not.toBe('');
  });

  it('the plugin not installed is code not-installed', async () => {
    putSession(box, 4242, { cwd: project });
    const { body } = await makeModule({ dataDir: box.data, options: { guardrails: { homeDir: join(root, 'home') } } }).call('GET', `/guardrails/sessions/${SESSION}/rules`);
    expect(body).toMatchObject({ ok: false, code: 'not-installed', categories: [] });
  });
});
