import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SENSITIVE_ROUTES, isSensitiveRequest } from '../commons/routeClasses.js';
import { ID, putSession, useSandbox } from './apiFixtures.js';
import { adminOverrideEnv } from './guardrailsAdmin.js';
import { makeModule } from './testKit.js';

// Batch add and batch revoke of bypasses (POST /guardrails/batch/grants and /revoke), threat-model T-24. The plugin is the FAKE script testSupport/fakeAdmin.cjs.
const FAKE = fileURLToPath(new URL('./testSupport/fakeAdmin.cjs', import.meta.url));
const box = useSandbox();
const TOKEN = 'pin-token-SECRET.v4lue_9';
const GRANTS = 'POST /guardrails/batch/grants';
const REVOKE = 'POST /guardrails/batch/revoke';

let root = '';
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
  root = mkdtempSync(join(tmpdir(), 'am-batch-'));
  setEnv({ [adminOverrideEnv]: undefined });
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
    delete saved[key];
  }
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

interface Raw {
  argv: string[];
  stdin: string;
  tokenInEnv: boolean;
}

/** One project folder per session, named p<pid>, so that the fake can answer other rules per folder. */
function sessions(...pids: number[]): string[] {
  return pids.map((pid) => {
    const dir = join(root, `p${pid}`);
    mkdirSync(dir);
    putSession(box, pid, { cwd: dir, name: `agent-${pid}` });
    return ID(pid);
  });
}

function fake(scenario = 'ok', extra: Record<string, string | undefined> = {}): { calls: () => Raw[]; grantsFile: string; counter: string; concurrency: string } {
  const grantsFile = join(root, 'grants.json');
  const logFile = join(root, 'calls.log');
  const counter = join(root, 'counter.txt');
  const concurrency = join(root, 'concurrency.txt');
  writeFileSync(grantsFile, '[]');
  writeFileSync(logFile, '');
  writeFileSync(counter, '');
  writeFileSync(concurrency, '');
  setEnv({ FAKE_ADMIN_SCENARIO: scenario, FAKE_ADMIN_GRANTS_FILE: grantsFile, FAKE_ADMIN_LOG: logFile, FAKE_ADMIN_UNIQUE_IDS: '1', ...extra });
  return {
    grantsFile,
    counter,
    concurrency,
    calls: () =>
      readFileSync(logFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Raw),
  };
}

const mod = (): ReturnType<typeof makeModule> => makeModule({ dataDir: box.data, options: { guardrails: { adminScript: FAKE, homeDir: join(root, 'home') } } });
const bearer = { authorization: `Bearer ${TOKEN}` };
let counterOfIds = 0;
const rid = (): string => `r-${(counterOfIds += 1)}`;
const grantBody = (ids: string[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({ requestId: rid(), category: 'rm', mode: 'once', rationale: 'clean the build folders', sessions: ids, ...extra });

function postGrants(m: ReturnType<typeof makeModule>, body: unknown, headers: Record<string, string | undefined> = bearer): ReturnType<ReturnType<typeof makeModule>['call']> {
  return m.call('POST', '/guardrails/batch/grants', { body, headers });
}
function postRevoke(m: ReturnType<typeof makeModule>, body: unknown): ReturnType<ReturnType<typeof makeModule>['call']> {
  return m.call('POST', '/guardrails/batch/revoke', { body, headers: bearer });
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
const grantCalls = (cli: { calls: () => Raw[] }): Raw[] => cli.calls().filter((call) => call.argv[0] === 'bypass' && call.argv[1] === 'grant');

describe('the class of the batch routes', () => {
  it('both are PIN-sensitive: listed, registered with the sensitive effect, and the shell asks for the PIN for their paths', () => {
    for (const route of [GRANTS, REVOKE]) {
      expect(SENSITIVE_ROUTES).toContain(route);
      expect(mod().registered.find((registered) => registered.key === route)?.effect).toBe('sensitive');
    }
    expect(isSensitiveRequest('POST', '/guardrails/batch/grants')).toBe(true);
    expect(isSensitiveRequest('POST', '/guardrails/batch/revoke')).toBe(true);
  });

  it('the CSRF guard answers 403 without the web UI headers, and nothing runs', async () => {
    const ids = sessions(4242);
    const cli = fake();
    const answer = await mod().call('POST', '/guardrails/batch/grants', { body: grantBody(ids), headers: { ...bearer, 'sec-fetch-site': undefined } });
    expect(answer.status).toBe(403);
    expect(cli.calls()).toEqual([]);
  });
});

describe('POST /guardrails/batch/grants: the happy path', () => {
  it('grants every session in ITS OWN folder with the token on stdin, answers one result per session in order, one audit line per session', async () => {
    const ids = sessions(4242, 4343, 4444);
    const cli = fake();
    const { status, body } = await postGrants(mod(), grantBody(ids, { mode: '10m' }));
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, replayed: false, counts: { granted: 3, refused: 0, failed: 0, 'not-attempted': 0 } });
    expect(body.results.map((result: { sessionId: string; name: string; status: string }) => [result.sessionId, result.name, result.status])).toEqual([
      [ids[0], 'agent-4242', 'granted'],
      [ids[1], 'agent-4343', 'granted'],
      [ids[2], 'agent-4444', 'granted'],
    ]);
    expect(new Set(body.results.map((result: { id: string }) => result.id)).size).toBe(3);
    // Each grant names the folder and the session of ITS session.
    const grants = grantCalls(cli);
    expect(grants).toHaveLength(3);
    for (const [index, id] of ids.entries()) {
      const call = grants.find((candidate) => candidate.argv[candidate.argv.indexOf('--session') + 1] === id);
      expect(call?.argv[call.argv.indexOf('--cwd') + 1]).toBe(join(root, `p${[4242, 4343, 4444][index]}`));
      expect(call?.stdin).toBe(TOKEN);
    }
    const lines = auditLines();
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line['outcome'])).toEqual(['granted', 'granted', 'granted']);
    expect(new Set(lines.map((line) => line['sessionId']))).toEqual(new Set(ids));
    expect(lines[0]).toMatchObject({ kind: 'bypass-grant', category: 'rm', mode: '10m', rationale: 'clean the build folders' });
    expect(JSON.parse(readFileSync(cli.grantsFile, 'utf8'))).toHaveLength(3);
  });

  it('runs at most 2 grants at the same time', async () => {
    const ids = sessions(4242, 4343, 4444, 4545, 4646);
    const cli = fake('ok', { FAKE_ADMIN_GRANT_DELAY_MS: '120', FAKE_ADMIN_CONCURRENCY_FILE: join(root, 'concurrency.txt') });
    const { body } = await postGrants(mod(), grantBody(ids));
    expect(body.counts.granted).toBe(5);
    let running = 0;
    let peak = 0;
    for (const mark of readFileSync(cli.concurrency, 'utf8')) {
      running += mark === '+' ? 1 : -1;
      peak = Math.max(peak, running);
    }
    expect(peak).toBe(2);
  });
});

describe('POST /guardrails/batch/grants: the token', () => {
  it('appears nowhere: not in argv, not in the environment of the child, not in the audit file, not in the response', async () => {
    const ids = sessions(4242, 4343);
    const cli = fake();
    const { body } = await postGrants(mod(), grantBody(ids));
    for (const call of cli.calls()) {
      expect(call.argv.join('\u0000')).not.toContain(TOKEN);
      expect(call.tokenInEnv).toBe(false);
    }
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(auditText()).not.toContain(TOKEN);
  });

  it('is not in any failure either: a plugin that echoes it, in the response and in the audit', async () => {
    const ids = sessions(4242, 4343);
    fake('grant-echo-token');
    const { body } = await postGrants(mod(), grantBody(ids));
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(auditText()).not.toContain(TOKEN);
    expect(auditText()).toMatch(/failed/);
  });

  it.each([[undefined], [''], ['Basic abc'], ['Bearer'], ['Bearer a b'], [`Bearer ${'a'.repeat(5000)}`]])('the header %s is refused before any process runs, nothing audited', async (header) => {
    const ids = sessions(4242);
    const cli = fake();
    const { status, body } = await postGrants(mod(), grantBody(ids), { authorization: header });
    expect(status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: 'pin-token-missing' } });
    expect(cli.calls()).toEqual([]);
    expect(auditLines()).toEqual([]);
  });
});

describe('POST /guardrails/batch/grants: partial failure', () => {
  it('a plugin refusal of one session does not stop the others: refused or failed with its reason and code', async () => {
    const ids = sessions(4242, 4343, 4444);
    fake('ok', { FAKE_ADMIN_SPAM_SESSIONS: ids[1] });
    const { status, body } = await postGrants(mod(), grantBody(ids));
    expect(status).toBe(200);
    expect(body.counts).toMatchObject({ granted: 2 });
    const second = body.results[1];
    expect(second).toMatchObject({ sessionId: ids[1], status: 'refused', code: 'spam-lock' });
    expect(second.text).toMatch(/Wait a minute/);
    expect(second.id).toBeUndefined();
    expect(auditLines().map((line) => String(line['outcome']).split(':')[0])).toEqual(expect.arrayContaining(['granted', 'failed']));
    expect(auditLines()).toHaveLength(3);
  });

  it('the category must be bypassable for the folder of EACH session: the others are refused with the reason, no grant runs for them', async () => {
    const ids = sessions(4242, 4343, 4444);
    const table = join(root, 'rules-by-cwd.json');
    writeFileSync(table, JSON.stringify({ p4343: [{ name: 'rm', decision: 'deny', source: 'config', bypassable: false, hardcoded: false }], p4444: [{ name: 'git-push', decision: 'ask', source: 'default', bypassable: true, hardcoded: false }] }));
    const cli = fake('ok', { FAKE_ADMIN_RULES_BY_CWD: table });
    const { body } = await postGrants(mod(), grantBody(ids));
    expect(body.results.map((result: { status: string; code: string }) => [result.status, result.code])).toEqual([
      ['granted', ''],
      ['refused', 'not-bypassable'],
      ['refused', 'unknown-category'],
    ]);
    expect(body.results[1].text).toMatch(/'rm' cannot be bypassed/);
    expect(grantCalls(cli)).toHaveLength(1);
    expect(auditLines().map((line) => String(line['outcome']).split(':')[0]).sort()).toEqual(['granted', 'refused', 'refused']);
  });

  it('an unknown session is refused on its own, the others run', async () => {
    const [known] = sessions(4242);
    const cli = fake();
    const { body } = await postGrants(mod(), grantBody([ID(9999), known as string]));
    expect(body.results.map((result: { status: string; code: string }) => [result.status, result.code])).toEqual([
      ['refused', 'unknown-session'],
      ['granted', ''],
    ]);
    expect(body.results[0].name).toBe(ID(9999));
    expect(grantCalls(cli)).toHaveLength(1);
  });
});

describe('POST /guardrails/batch/grants: the PIN token expires mid-batch', () => {
  it('stops launching new grants, reports the rest as not-attempted with the actionable message, audits them', async () => {
    const ids = sessions(4242, 4343, 4444, 4545, 4646, 4747);
    const cli = fake('ok', { FAKE_ADMIN_ELEVATE_AFTER: '2', FAKE_ADMIN_COUNTER_FILE: join(root, 'counter.txt') });
    const { status, body } = await postGrants(mod(), grantBody(ids));
    expect(status).toBe(200);
    const statuses: string[] = body.results.map((result: { status: string }) => result.status);
    expect(statuses.slice(0, 2)).toEqual(['granted', 'granted']);
    // Two grants run at the same time: the two that were in flight when the token expired both fail with the code, the rest is never launched.
    expect(statuses.slice(2, 4)).toEqual(['failed', 'failed']);
    expect(body.results[2].code).toBe('pin-expired');
    expect(statuses.slice(4)).toEqual(['not-attempted', 'not-attempted']);
    for (const result of body.results.slice(4)) {
      expect(result.code).toBe('pin-expired');
      expect(result.text).toMatch(/Enter the PIN again and retry/);
    }
    expect(body.counts).toMatchObject({ granted: 2, failed: 2, 'not-attempted': 2 });
    // Nothing was launched for the not-attempted ones.
    expect(grantCalls(cli)).toHaveLength(4);
    const lines = auditLines();
    expect(lines).toHaveLength(6);
    expect(lines.filter((line) => String(line['outcome']).startsWith('not-attempted'))).toHaveLength(2);
    expect(auditText()).not.toContain(TOKEN);
  });
});

describe('POST /guardrails/batch/grants: idempotency and duplicates', () => {
  it('a replay of the same requestId and body returns the previous results and grants nothing twice', async () => {
    const ids = sessions(4242, 4343);
    const cli = fake();
    const m = mod();
    const body = grantBody(ids);
    const first = await postGrants(m, body);
    const grantsBefore = grantCalls(cli).length;
    const again = await postGrants(m, body);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ ok: true, replayed: true, results: first.body.results });
    expect(grantCalls(cli)).toHaveLength(grantsBefore);
    expect(auditLines()).toHaveLength(2);
  });

  it('the same requestId with another body is refused (409 request-id-reused), nothing runs', async () => {
    const ids = sessions(4242, 4343);
    const cli = fake();
    const m = mod();
    const body = grantBody(ids);
    await postGrants(m, body);
    const before = cli.calls().length;
    const other = await postGrants(m, { ...body, category: 'git-push' });
    expect(other.status).toBe(409);
    expect(other.body).toMatchObject({ ok: false, error: { code: 'request-id-reused' } });
    expect(cli.calls()).toHaveLength(before);
  });

  it('a second request for the same session and category made a moment ago is refused per session (duplicate-request), like the single route', async () => {
    const ids = sessions(4242, 4343);
    const cli = fake();
    const m = mod();
    await postGrants(m, grantBody([ids[0] as string]));
    const second = await postGrants(m, grantBody(ids));
    expect(second.body.results.map((result: { status: string; code: string }) => [result.status, result.code])).toEqual([
      ['refused', 'duplicate-request'],
      ['granted', ''],
    ]);
    expect(grantCalls(cli)).toHaveLength(2);
  });

  it('a request whose requestId is still running is refused (409 duplicate-request)', async () => {
    const ids = sessions(4242, 4343);
    fake('ok', { FAKE_ADMIN_GRANT_DELAY_MS: '300' });
    const m = mod();
    const body = grantBody(ids);
    const first = postGrants(m, body);
    // Let the first request start its work.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const second = await postGrants(m, body);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ ok: false, error: { code: 'duplicate-request' } });
    expect((await first).body.counts.granted).toBe(2);
  });
});

describe('POST /guardrails/batch/grants: the body', () => {
  const ids = (): string[] => sessions(4242);
  it.each([
    ['not an object', () => null],
    ['an array', () => []],
    ['an unknown field (a folder)', (s: string[]) => grantBody(s, { cwd: '/x' })],
    ['no requestId', (s: string[]) => ({ ...grantBody(s), requestId: undefined })],
    ['a requestId with a slash', (s: string[]) => grantBody(s, { requestId: 'a/b' })],
    ['no category', (s: string[]) => ({ ...grantBody(s), category: undefined })],
    ['a category with a flag', (s: string[]) => grantBody(s, { category: 'rm --force' })],
    ['a mode out of the list', (s: string[]) => grantBody(s, { mode: '1h' })],
    ['an empty rationale', (s: string[]) => grantBody(s, { rationale: '  ' })],
    ['a rationale with a line break', (s: string[]) => grantBody(s, { rationale: 'a\nb' })],
    ['sessions not a list', () => grantBody([], { sessions: 'x' })],
    ['no session', () => grantBody([])],
    ['a bad session id', () => grantBody(['../x'])],
    ['the same session twice', (s: string[]) => grantBody([...s, ...s])],
    ['21 sessions', () => grantBody(Array.from({ length: 21 }, (_, index) => ID(index + 1)))],
  ])('%s is a 400 bad-request, nothing runs and nothing is audited', async (_name, make) => {
    const list = ids();
    const cli = fake();
    const { status, body } = await postGrants(mod(), make(list));
    expect(status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    expect(body.error.hint.length).toBeGreaterThan(10);
    expect(cli.calls()).toEqual([]);
    expect(auditLines()).toEqual([]);
  });

  it('20 sessions are accepted (the cap is inclusive)', async () => {
    const pids = Array.from({ length: 20 }, (_, index) => 5000 + index);
    const list = sessions(...pids);
    fake();
    const { status, body } = await postGrants(mod(), grantBody(list));
    expect(status).toBe(200);
    expect(body.counts.granted).toBe(20);
  });
});

describe('POST /guardrails/batch/revoke', () => {
  /** Grants one bypass per session through the batch route and returns the grant ids by session. */
  async function seeded(m: ReturnType<typeof makeModule>, list: string[]): Promise<Record<string, string>> {
    const { body } = await postGrants(m, grantBody(list, { mode: '30m' }));
    return Object.fromEntries(body.results.map((result: { sessionId: string; id: string }) => [result.sessionId, result.id]));
  }

  it('revokes every named grant of its session, one result per item in order, one audit line per item, 2 at most at a time', async () => {
    const list = sessions(4242, 4343, 4444);
    const cli = fake();
    const m = mod();
    const made = await seeded(m, list);
    const items = list.map((sessionId) => ({ sessionId, grantId: made[sessionId] as string }));
    const { status, body } = await postRevoke(m, { requestId: rid(), items });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, replayed: false, counts: { revoked: 3, refused: 0, failed: 0 } });
    expect(body.results.map((result: { sessionId: string; grantId: string; status: string; category: string }) => [result.sessionId, result.grantId, result.status, result.category])).toEqual(items.map((item) => [item.sessionId, item.grantId, 'revoked', 'rm']));
    expect(JSON.parse(readFileSync(cli.grantsFile, 'utf8'))).toEqual([]);
    const revokes = auditLines().filter((line) => line['kind'] === 'bypass-revoke');
    expect(revokes).toHaveLength(3);
    expect(revokes.every((line) => line['outcome'] === 'revoked')).toBe(true);
    expect(auditText()).not.toContain(TOKEN);
  });

  it('a grant that is not this session\'s, or already gone, is refused (grant-not-found) and the others still run', async () => {
    const list = sessions(4242, 4343);
    const cli = fake();
    const m = mod();
    const made = await seeded(m, list);
    const { body } = await postRevoke(m, {
      requestId: rid(),
      items: [
        // The grant of the second session named under the first: the plugin's list filtered by session does not have it.
        { sessionId: list[0] as string, grantId: made[list[1] as string] as string },
        { sessionId: list[1] as string, grantId: made[list[1] as string] as string },
      ],
    });
    expect(body.results.map((result: { status: string; code: string }) => [result.status, result.code])).toEqual([
      ['refused', 'grant-not-found'],
      ['revoked', ''],
    ]);
    expect(JSON.parse(readFileSync(cli.grantsFile, 'utf8'))).toHaveLength(1);
  });

  it('a plugin failure is reported per item (failed) and the others run', async () => {
    const list = sessions(4242, 4343);
    const cli = fake();
    const m = mod();
    const made = await seeded(m, list);
    setEnv({ FAKE_ADMIN_SCENARIO: 'revoke-fails' });
    const { body } = await postRevoke(m, { requestId: rid(), items: list.map((sessionId) => ({ sessionId, grantId: made[sessionId] as string })) });
    expect(body.counts).toMatchObject({ failed: 2, revoked: 0 });
    expect(body.results[0].code).toBe('plugin-error');
    expect(body.results[0].text).toMatch(/lock/);
    expect(JSON.parse(readFileSync(cli.grantsFile, 'utf8'))).toHaveLength(2);
  });

  it('replays the same requestId without revoking again; refuses it with another body', async () => {
    const list = sessions(4242);
    const cli = fake();
    const m = mod();
    const made = await seeded(m, list);
    const body = { requestId: rid(), items: [{ sessionId: list[0] as string, grantId: made[list[0] as string] as string }] };
    const first = await postRevoke(m, body);
    const before = cli.calls().length;
    const again = await postRevoke(m, body);
    expect(again.body).toMatchObject({ ok: true, replayed: true, results: first.body.results });
    expect(cli.calls()).toHaveLength(before);
    const other = await postRevoke(m, { ...body, items: [{ sessionId: list[0] as string, grantId: 'deadbeef' }] });
    expect(other.status).toBe(409);
    expect(other.body).toMatchObject({ error: { code: 'request-id-reused' } });
  });

  it.each([
    ['not an object', () => null],
    ['no requestId', () => ({ items: [{ sessionId: ID(1), grantId: 'c0ffee01' }] })],
    ['an unknown field', () => ({ requestId: 'a', items: [{ sessionId: ID(1), grantId: 'c0ffee01' }], cwd: '/x' })],
    ['no items', () => ({ requestId: 'a', items: [] })],
    ['a bad grant id', () => ({ requestId: 'a', items: [{ sessionId: ID(1), grantId: 'xyz' }] })],
    ['a bad session id', () => ({ requestId: 'a', items: [{ sessionId: '../x', grantId: 'c0ffee01' }] })],
    ['an extra field in an item', () => ({ requestId: 'a', items: [{ sessionId: ID(1), grantId: 'c0ffee01', cwd: '/x' }] })],
    ['the same item twice', () => ({ requestId: 'a', items: [{ sessionId: ID(1), grantId: 'c0ffee01' }, { sessionId: ID(1), grantId: 'c0ffee01' }] })],
    ['61 items', () => ({ requestId: 'a', items: Array.from({ length: 61 }, (_, index) => ({ sessionId: ID((index % 20) + 1), grantId: (0xc0ffee00 + index).toString(16) })) })],
    ['21 sessions', () => ({ requestId: 'a', items: Array.from({ length: 21 }, (_, index) => ({ sessionId: ID(index + 1), grantId: (0xc0ffee00 + index).toString(16) })) })],
  ])('%s is a 400 bad-request, nothing runs', async (_name, make) => {
    const cli = fake();
    const { status, body } = await postRevoke(mod(), make());
    expect(status).toBe(400);
    expect(body).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    expect(cli.calls()).toEqual([]);
  });
});
