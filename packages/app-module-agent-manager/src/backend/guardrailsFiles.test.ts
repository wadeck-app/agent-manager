import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCounters, parseGrants, parseRules, RATIONALE_MAX, readCounters, readJsonFile, readKillSwitch, killSwitchFileOf } from './guardrailsFiles.js';
import { grantEntry, iso, putCounters, useHome } from './guardrailsFixtures.js';

const FILE = '/proj/state-file.json';

describe('parseGrants (shape version 1)', () => {
  const now = Date.now();

  it('lists the grants the hook honours, with uses for a one-shot grant', () => {
    const parsed = parseGrants({ overrides: [grantEntry(), grantEntry({ id: 'b', mode: 'once', max_uses: 1, used: 0, category: 'kill' })] }, FILE, now);
    expect(parsed.problems).toEqual([]);
    expect(parsed.grants.map((g) => [g.id, g.mode, g.used, g.maxUses])).toEqual([
      ['a1b2c3d4', 'ttl', 0, null],
      ['b', 'once', 0, 1],
    ]);
  });

  it('leaves out, and counts, what the hook ignores: expired, used up, more than 24 h ahead', () => {
    const parsed = parseGrants({ overrides: [grantEntry({ expires: iso(-1000) }), grantEntry({ mode: 'once', used: 1, max_uses: 1 }), grantEntry({ expires: iso(25 * 3_600_000) }), grantEntry({ id: 'ok' })] }, FILE, now);
    expect(parsed.grants.map((g) => g.id)).toEqual(['ok']);
    expect(parsed.hidden).toBe(3);
  });

  it('cuts a long rationale', () => {
    const parsed = parseGrants({ overrides: [grantEntry({ reason: 'x'.repeat(500) })] }, FILE, now);
    expect(parsed.grants[0]!.rationale).toHaveLength(RATIONALE_MAX + 3);
  });

  it('refuses an entry with an unknown field, a bad mode or a bad date, names it, and keeps the valid ones', () => {
    const parsed = parseGrants({ overrides: [grantEntry({ scope: 'x' }), grantEntry({ mode: '5m' }), grantEntry({ expires: 12345 }), grantEntry({ id: 'fine' })] }, FILE, now);
    expect(parsed.grants.map((g) => g.id)).toEqual(['fine']);
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0]).toMatchObject({ file: FILE });
    expect(parsed.problems[0]!.message).toMatch(/3 of 4 entries are not shown.*entry 1 has the unknown field 'scope'.*entry 2 has mode "5m".*entry 3 has an 'expires'/);
    expect(parsed.problems[0]!.hint).toMatch(/update this module|schema/);
  });

  it('shows nothing and says why for an unknown top-level shape', () => {
    for (const value of [{ version: 2, overrides: [] }, { grants: [] }, [], 'text', null]) {
      const parsed = parseGrants(value, FILE, now);
      expect(parsed.grants).toEqual([]);
      expect(parsed.problems[0]!.message).toMatch(/unknown shape: expected \{ "overrides"/);
    }
  });
});

describe('parseCounters (shape version 1)', () => {
  const now = Date.now();

  it('lists the categories most blocked first, and the running timeout', () => {
    const parsed = parseCounters({ requests: { '287760ca-1': { refused_count: 3, last_request_ts: iso(-1000), timeout_until: iso(600_000), block_counts: { rm: 30, 'interpreter-exec': 37, kill: 0 } } } }, FILE, now);
    expect(parsed.problems).toEqual([]);
    expect(parsed.sessions[0]).toMatchObject({ sessionId: '287760ca-1', total: 67, refusedCount: 3, blocks: [{ category: 'interpreter-exec', count: 37 }, { category: 'rm', count: 30 }] });
    expect(parsed.sessions[0]!.timeoutUntil).toBeGreaterThan(now);
  });

  it('reports a timeout in the past as none', () => {
    const parsed = parseCounters({ requests: { s: { refused_count: 0, last_request_ts: null, timeout_until: iso(-5000) } } }, FILE, now);
    expect(parsed.sessions[0]!.timeoutUntil).toBeNull();
  });

  it('refuses a session entry with an unknown field or a negative count, names it, keeps the others', () => {
    const parsed = parseCounters({ requests: { bad: { extra: 1 }, neg: { block_counts: { rm: -1 } }, good: { block_counts: { rm: 1 } } } }, FILE, now);
    expect(parsed.sessions.map((s) => s.sessionId)).toEqual(['good']);
    expect(parsed.problems[0]!.message).toMatch(/2 session entries are not shown.*'bad' has the unknown field 'extra'.*'neg' has 'block_counts'/);
  });

  it('refuses an unknown top-level shape', () => {
    expect(parseCounters({ requests: {}, version: 2 }, FILE, now).problems[0]!.message).toMatch(/unknown shape/);
    expect(parseCounters({ sessions: {} }, FILE, now).sessions).toEqual([]);
  });
});

describe('parseRules', () => {
  it('shows the file as written', () => {
    const rules = parseRules({ categories: { rm: 'ask', kill: 'allow' }, category_messages: { rm: 'x' }, protected_files: [{ glob: '**/*.pem', decision: 'deny' }], secrets: { file: 'f' } });
    expect(rules).toMatchObject({ state: 'ok', categoryMessages: 1, hasSecrets: true, warnings: [] });
    expect(rules.categories).toEqual([{ name: 'rm', decision: 'ask' }, { name: 'kill', decision: 'allow' }]);
    expect(rules.protectedFiles).toEqual([{ glob: '**/*.pem', decision: 'deny' }]);
  });

  it('warns about an unknown key and an unknown decision, and still shows the rest', () => {
    const rules = parseRules({ categories: { rm: 'maybe' }, extra: 1 });
    expect(rules.state).toBe('ok');
    expect(rules.warnings.join(' ')).toMatch(/Unknown key 'extra'.*Category 'rm' has the decision "maybe"/);
  });

  it('is malformed when a container has the wrong type', () => {
    for (const value of [{ categories: ['rm'] }, { protected_files: {} }, { category_messages: [] }, [], 'x']) {
      const rules = parseRules(value);
      expect(rules.state).toBe('malformed');
      expect(rules.errorText).not.toBe('');
    }
  });
});

describe('readJsonFile and readCounters', () => {
  const home = useHome();

  it('distinguishes absent, valid, not JSON and too big', async () => {
    const dir = home.project('a');
    expect(await readJsonFile(join(dir, 'none.json'), 100)).toEqual({ kind: 'absent' });
    writeFileSync(join(dir, 'ok.json'), '{"a":1}');
    expect(await readJsonFile(join(dir, 'ok.json'), 100)).toMatchObject({ kind: 'ok', value: { a: 1 } });
    writeFileSync(join(dir, 'bad.json'), '{"a":');
    const bad = await readJsonFile(join(dir, 'bad.json'), 100);
    expect(bad).toMatchObject({ kind: 'problem', problem: { file: join(dir, 'bad.json') } });
    expect(bad.kind === 'problem' && bad.problem.message).toMatch(/^is not valid JSON/);
    writeFileSync(join(dir, 'big.json'), `{"a":"${'x'.repeat(200)}"}`);
    const big = await readJsonFile(join(dir, 'big.json'), 100);
    expect(big.kind === 'problem' && big.problem.message).toMatch(/above the 100 bytes/);
  });

  it('a path through a file (ENOTDIR) is absent, a directory in place of the file is a problem', async () => {
    const dir = home.project('b');
    writeFileSync(join(dir, 'file'), '{}');
    expect(await readJsonFile(join(dir, 'file', 'x.json'), 100)).toEqual({ kind: 'absent' });
    mkdirSync(join(dir, 'folder'));
    expect((await readJsonFile(join(dir, 'folder'), 100)).kind).toBe('problem');
  });

  it('readCounters re-reads a file that changed and reports an unreadable one', async () => {
    const dir = home.project('c');
    expect(await readCounters(dir, Date.now())).toMatchObject({ present: false, sessions: [], problems: [] });
    putCounters(dir, { requests: { s1: { block_counts: { rm: 1 } } } });
    expect((await readCounters(dir, Date.now())).sessions[0]!.total).toBe(1);
    putCounters(dir, { requests: { s1: { block_counts: { rm: 12 } } } });
    expect((await readCounters(dir, Date.now())).sessions[0]!.total).toBe(12);
    putCounters(dir, '{ not json');
    const broken = await readCounters(dir, Date.now());
    expect(broken.sessions).toEqual([]);
    expect(broken.problems[0]!.message).toMatch(/not valid JSON/);
  });
});

describe('readKillSwitch', () => {
  const home = useHome();

  it('is active when the flag file exists, with its path', async () => {
    expect(await readKillSwitch(home.home)).toMatchObject({ active: false, errorText: '' });
    const file = killSwitchFileOf(home.home);
    mkdirSync(join(home.home, '.claude', 'w-guardrails'), { recursive: true });
    writeFileSync(file, '');
    expect(await readKillSwitch(home.home)).toEqual({ active: true, path: file, errorText: '' });
  });
});
