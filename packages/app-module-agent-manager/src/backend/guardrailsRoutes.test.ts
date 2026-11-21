import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { addLaunchRoot } from '@wadeck-app/agent-manager-core/folders';
import { describe, expect, it } from 'vitest';
import { ID, putSession, useSandbox } from './apiFixtures.js';
import { grantEntry, iso, journalLine, putCounters, putGrants, putJournal, putRules, useHome } from './guardrailsFixtures.js';
import { killSwitchFileOf } from './guardrailsFiles.js';
import { clearGuardrailsCaches, localProject } from './guardrailsRoutes.js';
import { SENSITIVE_ROUTES } from '../commons/routeClasses.js';
import { makeModule } from './testKit.js';

// Every test: a registry, a fake home (journal, kill switch) and project folders in the temp folder; nothing of the real ~/.claude is read.
const box = useSandbox();
const home = useHome();

const SESSION = ID(4242);

function mod(extra: { journalBudgetBytes?: number } = {}): ReturnType<typeof makeModule> {
  return makeModule({ dataDir: box.data, options: { guardrails: { homeDir: home.home, ...extra } } });
}

describe('GET /guardrails/overview', () => {
  it('lists the active grants of the folders of the registry sessions, with the session name and what the sources were', async () => {
    const project = home.project('shop');
    putSession(box, 4242, { cwd: project, name: 'shop agent' });
    putGrants(project, { overrides: [grantEntry({ session_id: SESSION, category: 'rm', mode: 'once', max_uses: 1, used: 0, reason: 'clean build' }), grantEntry({ id: 'old', expires: iso(-1000) })] });
    const { status, body } = await mod().call('GET', '/guardrails/overview');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.grants).toHaveLength(1);
    expect(body.grants[0]).toMatchObject({ id: 'a1b2c3d4', category: 'rm', mode: 'once', sessionId: SESSION, sessionName: 'shop agent', project, rationale: 'clean build', used: 0, maxUses: 1 });
    expect(body.grants[0].remainingMs).toBeGreaterThan(0);
    expect(body.hiddenEntries).toBe(1);
    expect(body.projects).toEqual([{ path: project, sources: ['registry'], hasFiles: true }]);
    expect(body.sourcesText.join('\n')).toMatch(/session registry.*1 folder\(s\) from 1 session/);
    expect(body.sourcesText.join('\n')).toMatch(/agent-manager daemon: NOT asked/);
    expect(body.sourcesText.join('\n')).toMatch(/Blocked journal: no day file/);
    expect(body.problems).toEqual([]);
    expect(body.rulesNote).toMatch(/needs plugin API A2/);
    expect(body.formatVersion).toBe(1);
  });

  it('reads a folder named by the journal only when a session or a launch root makes it a known folder; any other is listed, not read', async () => {
    const known = home.project('known');
    const stranger = home.project('stranger');
    putSession(box, 4242, { cwd: known });
    putGrants(known, { overrides: [grantEntry({ id: 'known-grant' })] });
    putGrants(stranger, { overrides: [grantEntry({ id: 'stranger-grant' })] });
    putJournal(home.journalDir, '2026-11-21', [journalLine({ project: known }), journalLine({ project: stranger }), journalLine({ project: '\\\\evil-host\\share\\x' }), journalLine({ project: '//evil-host/share' }), journalLine({ project: 'relative/dir' })]);
    // Without launch roots: only the folder of the session is read, the stranger is named and left alone.
    const first = (await mod().call('GET', '/guardrails/overview')).body;
    expect(first.grants.map((g: { id: string }) => g.id)).toEqual(['known-grant']);
    expect(first.projects.map((p: { path: string }) => p.path)).toEqual([known]);
    expect([...first.projects[0].sources].sort()).toEqual(['journal', 'registry']);
    expect(first.sourcesText).toContain(`Journal mentions an unknown folder: not read: ${stranger}`);
    expect(JSON.stringify(first)).not.toContain('stranger-grant');
    expect(first.sourcesText.join('\n')).toMatch(/3 folder name\(s\) were refused because they are not a local absolute path/);
    // A launch root of config.yml makes everything under it known.
    await addLaunchRoot(process.env['AGENT_MANAGER_CONFIG_DIR']!, dirname(stranger));
    clearGuardrailsCaches();
    const second = (await mod().call('GET', '/guardrails/overview')).body;
    expect(second.grants.map((g: { id: string }) => g.id).sort()).toEqual(['known-grant', 'stranger-grant']);
    expect(second.sourcesText.join('\n')).not.toMatch(/unknown folder/);
  });

  it('says so when the launch roots cannot be read, and still reads the folders of the sessions', async () => {
    const known = home.project('known2');
    putSession(box, 4242, { cwd: known });
    writeFileSync(join(process.env['AGENT_MANAGER_CONFIG_DIR']!, 'config.yml'), 'launchRoots: [unclosed');
    putJournal(home.journalDir, '2026-11-21', [journalLine({ project: home.project('other') })]);
    const { body } = await mod().call('GET', '/guardrails/overview');
    expect(body.sourcesText.join('\n')).toMatch(/Launch roots NOT read/);
    expect(body.sourcesText.join('\n')).toMatch(/Journal mentions an unknown folder: not read/);
    expect(body.projects.map((p: { path: string }) => p.path)).toEqual([known]);
  });

  it('shows the counters per session with the timeout, and the kill switch banner data', async () => {
    const project = home.project('counters');
    putSession(box, 4242, { cwd: project });
    putCounters(project, { requests: { [SESSION]: { refused_count: 3, last_request_ts: iso(-60_000), timeout_until: iso(20 * 60_000), block_counts: { rm: 30, 'interpreter-exec': 37 } }, quiet: { refused_count: 0, last_request_ts: null, timeout_until: null } } });
    mkdirSync(join(home.home, '.claude', 'w-guardrails'), { recursive: true });
    writeFileSync(killSwitchFileOf(home.home), '');
    const { body } = await mod().call('GET', '/guardrails/overview');
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toMatchObject({ sessionId: SESSION, prefix: '00000000', project, total: 67, refusedCount: 3, blocks: [{ category: 'interpreter-exec', count: 37 }, { category: 'rm', count: 30 }] });
    expect(body.sessions[0].timeoutUntil).toBeGreaterThan(Date.now());
    expect(body.killSwitch).toEqual({ active: true, path: killSwitchFileOf(home.home), errorText: '' });
  });

  it('shows the rules file as written, a malformed one with its parse error, and omits the projects without one', async () => {
    const good = home.project('rules-ok');
    const broken = home.project('rules-broken');
    const none = home.project('rules-none');
    for (const [index, project] of [good, broken, none].entries()) {
      putSession(box, 4300 + index, { cwd: project, sessionId: ID(4300 + index) });
    }
    putRules(good, { categories: { rm: 'deny' }, extra: 1 });
    putRules(broken, '{ "categories": ');
    const { body } = await mod().call('GET', '/guardrails/overview');
    expect(body.configs).toHaveLength(2);
    const byProject = Object.fromEntries(body.configs.map((c: { project: string }) => [c.project, c]));
    expect(byProject[good]).toMatchObject({ state: 'ok', categories: [{ name: 'rm', decision: 'deny' }] });
    expect(byProject[good].warnings.join(' ')).toMatch(/Unknown key 'extra'/);
    expect(byProject[broken]).toMatchObject({ state: 'malformed', categories: [] });
    expect(byProject[broken].errorText).toMatch(/is not valid JSON.*Fix or delete it by hand/);
    expect(body.projects).toHaveLength(3);
  });

  it('names every file whose shape it does not know, with what to do', async () => {
    const project = home.project('unknown');
    putSession(box, 4242, { cwd: project });
    putGrants(project, { version: 2, overrides: [] });
    putCounters(project, '[1,2');
    const { body } = await mod().call('GET', '/guardrails/overview');
    expect(body.grants).toEqual([]);
    expect(body.sessions).toEqual([]);
    expect(body.problems).toHaveLength(2);
    expect(body.problems.map((p: { message: string }) => p.message).join(' | ')).toMatch(/unknown shape.*overrides.*\|.*not valid JSON|not valid JSON.*\|.*unknown shape/);
    for (const item of body.problems) {
      expect(item.file).toContain(project);
      expect(item.hint).not.toBe('');
    }
  });

  it('says when the session registry cannot be read instead of listing nothing', async () => {
    process.env['AGENT_MANAGER_SESSIONS_DIR'] = join(box.registry, 'does-not-exist');
    const { body } = await mod().call('GET', '/guardrails/overview');
    expect(body.sourcesText.join('\n')).toMatch(/session registry: NOT read/);
    expect(body.problems.length).toBeGreaterThan(0);
  });
});

describe('GET /guardrails/denials and /denials/commands', () => {
  it('answers the journal tail WITHOUT the command text, with the filters it offers', async () => {
    putSession(box, 4242, { cwd: home.project('x'), name: 'named' });
    putJournal(home.journalDir, '2026-11-20', [journalLine({ trigger: 'kill', session: 'aaaaaaaa:M' })]);
    putJournal(home.journalDir, '2026-11-21', [journalLine({ session: '00000000:M', command: 'curl -H "Authorization: Bearer abc" x' }), journalLine({ session: '00000000:A:12ab:general-purpose', trigger: 'kill', command: null, tool: 'Write', file: '//x.ts' })]);
    const { body } = await mod().call('GET', '/guardrails/denials');
    expect(body.ok).toBe(true);
    expect(body.withCommands).toBe(false);
    expect(body.days).toEqual(['2026-11-21', '2026-11-20']);
    expect(body.denials).toHaveLength(3);
    expect(JSON.stringify(body)).not.toContain('Bearer');
    expect(body.denials[1]).toMatchObject({ prefix: '00000000', sessionName: 'named', category: 'rm', hasCommand: true });
    expect(body.denials[1]).not.toHaveProperty('command');
    expect(body.denials[0]).toMatchObject({ hasCommand: false, tool: 'Write', file: '//x.ts' });
    expect(body.categories).toEqual(['kill', 'rm']);
    expect(body.note).toMatch(/not masked/);
  });

  it('the commands route includes the text, and is registered as a PIN route', async () => {
    putJournal(home.journalDir, '2026-11-21', [journalLine({ command: 'rm -rf build' })]);
    const m = mod();
    const { body } = await m.call('GET', '/guardrails/denials/commands');
    expect(body.withCommands).toBe(true);
    expect(body.denials[0]).toMatchObject({ command: 'rm -rf build', hasCommand: true });
    expect(SENSITIVE_ROUTES).toContain('GET /guardrails/denials/commands');
    expect(m.registered.find((r) => r.key === 'GET /guardrails/denials/commands')?.effect).toBe('sensitive');
    expect(m.registered.find((r) => r.key === 'GET /guardrails/denials')?.effect).toBeUndefined();
    expect(m.registered.find((r) => r.key === 'GET /guardrails/overview')?.effect).toBeUndefined();
  });

  it('filters by day, category and session prefix, and honours the limit', async () => {
    putJournal(home.journalDir, '2026-11-21', Array.from({ length: 5 }, (_, i) => journalLine({ trigger: i % 2 === 0 ? 'rm' : 'kill', session: i < 3 ? 'abcd1234:M' : 'ffff0000:M' })));
    const m = mod();
    expect((await m.call('GET', '/guardrails/denials?category=kill')).body.denials).toHaveLength(2);
    expect((await m.call('GET', '/guardrails/denials?session=ABCD')).body.denials).toHaveLength(3);
    expect((await m.call('GET', '/guardrails/denials?day=2026-11-21&limit=2')).body).toMatchObject({ truncated: true, filter: { day: '2026-11-21', limit: 2 } });
  });

  it('refuses a bad filter with a hint (400)', async () => {
    const m = mod();
    for (const query of ['day=yesterday', 'session=zz', 'limit=0', 'limit=501', 'category=a%20b']) {
      const answer = await m.call('GET', `/guardrails/denials?${query}`);
      expect(answer.status, query).toBe(400);
      expect(answer.body.hint, query).toBeTruthy();
    }
  });

  it('reports lines of an unknown shape and a bounded read as data, never silently', async () => {
    putJournal(home.journalDir, '2026-11-21', [journalLine(), { ...journalLine(), newField: 1 }]);
    const { body } = await mod({ journalBudgetBytes: 4 * 1024 }).call('GET', '/guardrails/denials');
    expect(body.skipped.count).toBe(1);
    expect(body.problems.some((p: { message: string }) => /do not have the known shape/.test(p.message))).toBe(true);
    expect(body.bytesRead).toBeGreaterThan(0);
  });

  it('the journal folder missing is a visible problem', async () => {
    const { body } = await makeModule({ dataDir: box.data, options: { guardrails: { homeDir: join(home.home, 'nowhere') } } }).call('GET', '/guardrails/denials');
    expect(body.denials).toEqual([]);
    expect(body.problems[0].message).toMatch(/does not exist/);
  });
});

describe('localProject', () => {
  it('accepts a local absolute path and refuses network, relative and odd ones', () => {
    expect(localProject(home.project('ok'))).toBeDefined();
    for (const bad of ['\\\\host\\share', '//host/share', 'relative', '', '  ', 'C:', 'a\0b', 42, undefined, 'x'.repeat(2000)]) {
      expect(localProject(bad), String(bad)).toBeUndefined();
    }
  });
});

describe('the chip of GET /sessions', () => {
  it('gives a session its counters, matched on the first 8 characters of its id', async () => {
    const project = home.project('chip');
    putSession(box, process.pid, { cwd: project });
    putCounters(project, { requests: { [`${SESSION.slice(0, 8)}-aaaa-bbbb-cccc-dddddddddddd`]: { block_counts: { rm: 2, kill: 5 } } } });
    const { body } = await mod().call('GET', '/sessions');
    const row = body.sessions.find((s: { pid: number }) => s.pid === process.pid);
    expect(row.guardrailBlocks).toEqual({ total: 7, categories: [{ category: 'kill', count: 5 }, { category: 'rm', count: 2 }], timeout: false });
    expect(body.guardrailsErrorText).toBe('');
  });

  it('a session without counters has no field; an unreadable state file is said in guardrailsErrorText', async () => {
    const project = home.project('chip-bad');
    putSession(box, process.pid, { cwd: project });
    putCounters(project, '{ broken');
    const { body } = await mod().call('GET', '/sessions');
    expect(body.sessions.find((s: { pid: number }) => s.pid === process.pid)).not.toHaveProperty('guardrailBlocks');
    expect(body.guardrailsErrorText).toMatch(/1 guardrail file\(s\) cannot be read.*not valid JSON.*Guardrails page/);
  });
});
