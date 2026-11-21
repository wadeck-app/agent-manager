import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeModule } from './testKit.js';

// The registry folder of each test: the module reads it from AGENT_MANAGER_SESSIONS_DIR at every request (never the real ~/.claude/sessions).
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-manager-module-registry-'));
  process.env['AGENT_MANAGER_SESSIONS_DIR'] = dir;
});
afterEach(() => {
  delete process.env['AGENT_MANAGER_SESSIONS_DIR'];
  rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

function entry(pid: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { pid, sessionId: `s-${pid}`, cwd: '/work/shop', version: '2.1.323', status: 'idle', statusUpdatedAt: 1_000, ...overrides };
}

function write(name: string, content: Record<string, unknown> | string): void {
  writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
}

/** The pid of a process that ended (a short-lived child of this run). */
function deadPid(): number {
  const child = spawnSync(process.execPath, ['--version'], { windowsHide: true });
  if (child.pid === undefined) {
    throw new Error('cannot start a child process to get a dead pid');
  }
  return child.pid;
}

describe('GET /sessions', () => {
  it('registers the list, summary, log (and its locate) and reply routes the two user-state write routes, the two transport setting routes and the owned-session routes, nothing else', () => {
    expect(makeModule().routes.sort()).toEqual(['GET /csrf', 'GET /folders/list', 'GET /folders/recent', 'GET /folders/roots', 'GET /folders/search', 'GET /guardrails/denials', 'GET /guardrails/denials/commands', 'GET /guardrails/overview', 'GET /health', 'GET /owned', 'GET /owned/:id/permissions', 'GET /sessions', 'GET /sessions/:sessionId/hc-permission', 'GET /sessions/:sessionId/log', 'GET /sessions/:sessionId/log/locate', 'GET /sessions/:sessionId/reply/status', 'GET /summary', 'POST /owned/:id/forget', 'POST /owned/:id/interrupt', 'POST /owned/:id/permission-mode', 'POST /owned/:id/permissions/:requestId', 'POST /owned/:id/resume', 'POST /owned/:id/stop', 'POST /owned/launch', 'POST /sessions/:sessionId/hc-permission', 'POST /sessions/:sessionId/pin', 'POST /sessions/:sessionId/reply', 'POST /sessions/:sessionId/seen', 'PUT /reply/transport/default', 'PUT /sessions/:sessionId/reply/transport']);
  });

  it('answers the alive session with the derived texts and the generation time', async () => {
    write(`${process.pid}.json`, entry(process.pid, { name: 'older', statusUpdatedAt: 1_000 }));
    const { call } = makeModule();
    const { status, body } = await call('GET', '/sessions');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.show).toBe('alive');
    expect(new Date(body.generatedAt).toISOString()).toBe(body.generatedAt);
    expect(body.unreadable).toEqual([]);
    const own = body.sessions.find((s: { pid: number }) => s.pid === process.pid);
    expect(own).toMatchObject({ displayName: 'older', statusGroup: 'idle', statusDetail: 'idle', aliveText: 'alive', alive: true, livenessCheck: 'pid-only', folder: 'shop' });
  });

  it('hides the dead sessions by default and says how many; show=all lists them, dead and marked', async () => {
    const dead = deadPid();
    write(`${process.pid}.json`, entry(process.pid, { statusUpdatedAt: 5_000 }));
    write(`${dead}.json`, entry(dead, { statusUpdatedAt: 9_000 }));
    const { call } = makeModule();

    const hidden = (await call('GET', '/sessions')).body;
    expect(hidden.sessions.map((s: { pid: number }) => s.pid)).toEqual([process.pid]);
    expect(hidden.hiddenDead).toBe(1);
    expect(hidden.hiddenText).toContain('1 dead session is hidden');
    expect(hidden.summary).toMatchObject({ idle: 1, alive: 1, dead: 1 });

    const all = (await call('GET', '/sessions?show=all')).body;
    // statusUpdatedAt desc: the dead one (9000) comes first
    expect(all.sessions.map((s: { pid: number; aliveText: string }) => [s.pid, s.aliveText])).toEqual([[dead, 'dead'], [process.pid, 'alive']]);
    expect(all.hiddenDead).toBe(0);
    expect(all.hiddenText).toBe('');
  });

  it('an unknown show value is a 400 that names the allowed values; as data (200, errorText) for a view', async () => {
    const { call } = makeModule();
    const direct = await call('GET', '/sessions?show=dead');
    expect(direct.status).toBe(400);
    expect(direct.body.message).toContain("'show' must be one of alive, all");
    const inline = await call('GET', '/sessions?show=dead&inlineErrors=true');
    expect(inline.status).toBe(200);
    expect(inline.body).toMatchObject({ ok: false, failed: true, httpStatus: 400 });
    expect(inline.body.errorText).toContain("'show' must be one of alive, all");
  });

  it('an empty ?show= (a cleared filter) is the default', async () => {
    const { call } = makeModule();
    expect((await call('GET', '/sessions?show=')).body.show).toBe('alive');
  });

  it('reports the unreadable files with the reason and still answers the readable sessions', async () => {
    write(`${process.pid}.json`, entry(process.pid));
    write('77.json', '{"pid": 77,');
    const { body } = await makeModule().call('GET', '/sessions');
    expect(body.sessions).toHaveLength(1);
    expect(body.unreadable).toEqual([{ file: '77.json', reason: expect.stringContaining('not valid JSON') }]);
    expect(body.unreadableText).toContain('1 registry file could not be read');
    expect(body.unreadableText).toContain('77.json');
  });

  it('a missing registry folder is an explicit error with its hint, never an empty successful list', async () => {
    process.env['AGENT_MANAGER_SESSIONS_DIR'] = join(dir, 'missing');
    const { status, body } = await makeModule().call('GET', '/sessions');
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: false, sessions: [], error: { code: 'missing-dir' } });
    expect(body.errorText).toContain(join(dir, 'missing'));
    expect(body.errorText).toContain('AGENT_MANAGER_SESSIONS_DIR');
  });

  it('an empty registry says so (it is a success, with an explanation)', async () => {
    const { body } = await makeModule().call('GET', '/sessions');
    expect(body).toMatchObject({ ok: true, sessions: [], unreadable: [] });
    expect(body.emptyText).toContain('No Claude Code session is registered');
  });

  it('a registry folder that is a file is an explicit error', async () => {
    write('afile', 'x');
    process.env['AGENT_MANAGER_SESSIONS_DIR'] = join(dir, 'afile');
    expect((await makeModule().call('GET', '/sessions')).body).toMatchObject({ ok: false, error: { code: 'not-a-directory' } });
  });
});

describe('GET /summary', () => {
  it('counts the alive sessions by status group; the dead are not counted in the groups', async () => {
    const dead = deadPid();
    const otherDead = deadPid();
    write(`${process.pid}.json`, entry(process.pid, { status: 'busy' }));
    write(`${dead}.json`, entry(dead, { status: 'busy' }));
    write(`${otherDead}.json`, entry(otherDead, { status: 'waiting' }));
    const { status, body } = await makeModule().call('GET', '/summary');
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, busy: 1, idle: 0, other: 0, alive: 1, dead: 2 });
  });

  it('reports the unreadable files and the missing folder explicitly', async () => {
    write('9.json', 'nope');
    const { body } = await makeModule().call('GET', '/summary');
    expect(body.unreadable).toBe(1);
    expect(body.unreadableText).toContain('9.json');
    process.env['AGENT_MANAGER_SESSIONS_DIR'] = join(dir, 'missing');
    const missing = await makeModule().call('GET', '/summary');
    expect(missing.body).toMatchObject({ ok: false, error: { code: 'missing-dir' } });
    expect(missing.body.errorText).toContain('does not exist');
  });
});

describe('GET /health', () => {
  it('is ok with the registry and user state checks when the registry folder exists', async () => {
    write(`${process.pid}.json`, entry(process.pid));
    write('9.json', 'nope');
    const { status, body } = await makeModule({ dataDir: dir }).call('GET', '/health');
    expect(status).toBe(200);
    expect(body.checks.filter((check: { ok: boolean }) => !check.ok)).toEqual([]);
    expect(body.ok).toBe(true);
    expect(body.checks.map((check: { name: string }) => check.name)).toEqual(['session-registry', 'user-state']);
    expect(body.checks[0].detail).toContain('1 unreadable file(s)');
  });

  it('fails with an actionable detail when the registry folder is missing', async () => {
    process.env['AGENT_MANAGER_SESSIONS_DIR'] = join(dir, 'missing');
    const { body } = await makeModule({ dataDir: dir }).call('GET', '/health');
    expect(body.ok).toBe(false);
    expect(body.checks[0]).toMatchObject({ name: 'session-registry', ok: false });
    expect(body.checks[0].detail).toContain('does not exist');
  });
});
