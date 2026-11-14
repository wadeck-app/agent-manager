import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { Session } from '@wadeck-app/agent-manager-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DONE_WINDOW_MS, GROUP_ORDER, buildGroups, stateOf } from './agentState.js';
import { literal } from './cards.js';
import { herdrGroups, herdrRow, markdownText } from './herdr.js';
import { presentSession } from './present.js';
import { makeModule } from './testKit.js';

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const ID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function session(n: number, overrides: Partial<Session> = {}): Session {
  return {
    file: `${n}.json`,
    pid: n,
    sessionId: ID(n),
    cwd: `/work/proj${n}`,
    folder: `proj${n}`,
    name: `owner${n}`,
    status: 'idle',
    statusGroup: 'idle',
    alive: true,
    livenessCheck: 'pid-only',
    version: '2.1.0',
    statusUpdatedAt: NOW - 90 * MIN,
    ...overrides,
  };
}

const NO_USER = { pinned: [], seen: {} };

describe('stateOf: the mapping of the registry values', () => {
  it.each([
    [{ status: 'waiting', waitingFor: 'permission prompt' }, 'needs-you'],
    [{ status: 'waiting' }, 'needs-you'],
    [{ status: 'busy' }, 'working'],
    [{ status: 'shell' }, 'working'],
    [{ status: 'idle', statusUpdatedAt: NOW - 2 * MIN }, 'done'],
    [{ status: 'idle', statusUpdatedAt: NOW - 90 * MIN }, 'idle'],
    [{ status: 'idle', statusUpdatedAt: undefined }, 'idle'],
    [{ status: 'compacting' }, 'other'],
    [{ status: 'busy', alive: false }, 'ended'],
  ] as [Partial<Session>, string][])('%j is %s', (overrides, expected) => {
    expect(stateOf(session(1, overrides), {}, NOW)).toBe(expected);
  });

  it('Done ends at the window, and when the user saw it after the last status change; a newer status change makes it Done again', () => {
    const finished = session(1, { statusUpdatedAt: NOW - 5 * MIN });
    expect(stateOf({ ...finished, statusUpdatedAt: NOW - DONE_WINDOW_MS }, {}, NOW)).toBe('done');
    expect(stateOf({ ...finished, statusUpdatedAt: NOW - DONE_WINDOW_MS - 1 }, {}, NOW)).toBe('idle');
    expect(stateOf(finished, { [ID(1)]: NOW - MIN }, NOW)).toBe('idle');
    // seen before the status changed again: a new finished turn
    expect(stateOf(finished, { [ID(1)]: NOW - 10 * MIN }, NOW)).toBe('done');
  });
});

describe('buildGroups', () => {
  const sessions = [
    session(1, { status: 'idle', statusUpdatedAt: NOW - 4 * 60 * MIN }),
    session(2, { status: 'idle', statusUpdatedAt: NOW - 44 * MIN }),
    session(3, { status: 'busy', statusUpdatedAt: NOW - 3 * MIN }),
    session(4, { status: 'busy', statusUpdatedAt: NOW - 1 * MIN }),
    session(5, { status: 'waiting', waitingFor: 'permission prompt', statusUpdatedAt: NOW - 10_000 }),
    session(6, { status: 'idle', statusUpdatedAt: NOW - 2 * MIN }),
    session(7, { status: 'busy', statusUpdatedAt: NOW - 2 * MIN }),
    session(8, { status: 'weird' }),
    session(9, { status: 'busy', alive: false }),
    session(10, { status: 'idle', statusUpdatedAt: undefined }),
  ];

  it('lists the non-empty groups in the order Pinned, Needs you, Done, Working, Idle, then Other and Ended; none is hidden', () => {
    const groups = buildGroups(sessions, { pinned: [ID(7)], seen: {} }, NOW);
    expect(groups.map((g) => g.label)).toEqual(['Pinned', 'Needs you', 'Done', 'Working', 'Idle', 'Other', 'Ended']);
    expect(groups.map((g) => g.id)).toEqual([...GROUP_ORDER]);
    expect(groups.flatMap((g) => g.entries).length).toBe(sessions.length);
  });

  it('inside a group the most recent state change comes first (Idle: shortest time first); no timestamp goes last', () => {
    const groups = Object.fromEntries(buildGroups(sessions, NO_USER, NOW).map((g) => [g.id, g.entries.map((e) => e.session.pid)]));
    expect(groups['working']).toEqual([4, 7, 3]);
    expect(groups['idle']).toEqual([2, 1, 10]);
  });

  it('a pinned session is listed once, in Pinned, with the state of its own; the state group count does not include it', () => {
    const groups = buildGroups(sessions, { pinned: [ID(7), ID(5)], seen: {} }, NOW);
    const pinned = groups.find((g) => g.id === 'pinned');
    expect(pinned?.entries.map((e) => [e.session.pid, e.state])).toEqual([
      [5, 'needs-you'],
      [7, 'working'],
    ]);
    expect(groups.find((g) => g.id === 'needs-you')).toBeUndefined();
    expect(groups.find((g) => g.id === 'working')?.entries.map((e) => e.session.pid)).toEqual([4, 3]);
  });

  it('an empty list has no group', () => {
    expect(buildGroups([], NO_USER, NOW)).toEqual([]);
  });
});

describe('the DSL nodes', () => {
  const row = (s: Session, state = stateOf(s, {}, NOW), pinned = false) => herdrRow({ session: s, state, pinned }, presentSession(s, '2.1.0'), NOW);

  it('a name or folder that starts with $ or ! is shown, not evaluated: no string of the nodes starts with them', () => {
    for (const text of ['$sources.secret', '!$sources.x', '  $x', '!']) {
      const node = row(session(1, { name: text, folder: text }));
      const strings: string[] = [];
      JSON.stringify(node, (_key, value: unknown) => {
        if (typeof value === 'string') {
          strings.push(value);
        }
        return value;
      });
      expect(strings.filter((v) => /^\s*[$!]/.test(v)), text).toEqual([]);
    }
    expect(literal('$a')).not.toBe('$a');
  });

  it.each([1e20, Number.NaN, -5, Number.POSITIVE_INFINITY])('an unusable statusUpdatedAt (%s) does not break the row: time "?", a visible marker, the rest of the row still there', (bad) => {
    const s = session(1, { statusUpdatedAt: bad });
    const node = JSON.stringify(row(s));
    expect(node).toContain('"bad time"');
    expect(node).toContain('invalid time');
    // the folder is still there
    expect(node).toContain('proj1');
    // the time text is the unknown marker ("?" escaped for Markdown, then JSON-escaped)
    expect(node).toContain('"text":"###### \\\\?"');
    // a whole layout with this row and a good one still renders, the good one keeps its time
    const groups = buildGroups([s, session(2)], NO_USER, NOW);
    const rows = [presentSession(s, '2.1.0'), presentSession(session(2), '2.1.0')];
    const layout = JSON.stringify(herdrGroups(groups, rows, NOW));
    expect(layout).toContain('proj1');
    expect(layout).toContain('proj2');
    expect(layout).toContain('"text":"###### 1h"');
  });

  it('a good statusUpdatedAt has no marker', () => {
    expect(JSON.stringify(row(session(1)))).not.toContain('bad time');
  });

  it('markdown syntax in a name is escaped so that it shows as typed', () => {
    expect(markdownText('**bold** [l](http://x.y) `c` _i_ # a\nb')).toBe('\\*\\*bold\\*\\* \\[l\\]\\(http\\:\\/\\/x\\.y\\) \\`c\\` \\_i\\_ \\# a b');
  });

  it('shows the compact time and the state icons: ! for needs you, dot for done, spinner for working, ring for idle', () => {
    const text = (s: Session): string => JSON.stringify(row(s));
    expect(text(session(1, { status: 'waiting', statusUpdatedAt: NOW - 30_000 }))).toContain('"label":"!"');
    expect(text(session(1, { statusUpdatedAt: NOW - 2 * MIN }))).toContain(String.fromCharCode(0x25cf));
    expect(text(session(1, { status: 'busy' }))).toContain('"$type":"Spinner"');
    expect(text(session(1))).toContain(String.fromCharCode(0x25cb));
    expect(text(session(1, { status: 'busy', statusUpdatedAt: NOW - 3 * MIN }))).toContain('3m');
    expect(text(session(1, { status: 'busy', statusUpdatedAt: undefined }))).toContain('?');
  });

  it('the Mark seen button is only on Done rows; the pin button flips to unpin on a pinned row', () => {
    const text = (s: Session, pinned: boolean): string => JSON.stringify(row(s, undefined, pinned));
    expect(text(session(1, { statusUpdatedAt: NOW - MIN }), false)).toContain('"action":"markSeen"');
    expect(text(session(1), false)).not.toContain('markSeen');
    expect(text(session(1), false)).toContain('"body":{"pinned":true}');
    expect(text(session(1), true)).toContain('"body":{"pinned":false}');
  });

  it('a group is a Collapsible with the label and the count', () => {
    const groups = buildGroups([session(1), session(2)], NO_USER, NOW);
    const nodes = herdrGroups(groups, [session(1), session(2)].map((s) => presentSession(s)), NOW);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ $type: 'Collapsible', title: 'Idle 2', defaultOpen: true });
  });

  it('holds only keys the installed dsl-ui knows', async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const walker = (await import('@wadeck-app/dsl-renderer/build/unknownKeys')) as { findUnknownKeys: (doc: unknown, known: unknown) => { severity: string; message: string; nodePath: string }[] };
    const known: unknown = JSON.parse(readFileSync(require.resolve('@wadeck-app/dsl-ui/known-keys.json'), 'utf8'));
    const all = [session(1, { status: 'waiting' }), session(2, { statusUpdatedAt: NOW - MIN }), session(3, { status: 'busy' }), session(4), session(5, { status: 'x' }), session(6, { alive: false }), session(7, { name: undefined })];
    const groups = buildGroups(all, { pinned: [ID(4)], seen: {} }, NOW);
    const nodes = herdrGroups(groups, all.map((s) => presentSession(s, '2.1.0')), NOW);
    const errors = known === undefined ? [] : walker.findUnknownKeys({ $type: 'PageContent', sections: nodes }, known).filter((d) => d.severity === 'error');
    expect(errors, errors.map((d) => `${d.nodePath} ${d.message}`).join('\n')).toEqual([]);
  });
});

describe('routes: GET /sessions (herdr) and the pin and seen routes', () => {
  let registry: string;
  let data: string;
  beforeEach(() => {
    registry = mkdtempSync(join(tmpdir(), 'agent-manager-herdr-registry-'));
    data = mkdtempSync(join(tmpdir(), 'agent-manager-herdr-data-'));
    process.env['AGENT_MANAGER_SESSIONS_DIR'] = registry;
  });
  afterEach(() => {
    delete process.env['AGENT_MANAGER_SESSIONS_DIR'];
    rmSync(registry, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    rmSync(data, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });

  const put = (pid: number, fields: Record<string, unknown>): void =>
    writeFileSync(join(registry, `${pid}.json`), JSON.stringify({ pid, sessionId: ID(pid), cwd: '/work/shop', version: '2.1.323', status: 'idle', statusUpdatedAt: Date.now() - 2 * MIN, ...fields }));
  const deadPid = (): number => {
    const child = spawnSync(process.execPath, ['--version'], { windowsHide: true });
    if (child.pid === undefined) {
      throw new Error('cannot start a child process to get a dead pid');
    }
    return child.pid;
  };
  const titles = (body: { herdr: { title: string }[] }): string[] => body.herdr.map((g) => g.title);

  it('groups the registry: needs you, done, ended (show=all), and back to idle once seen', async () => {
    const dead = deadPid();
    put(process.pid, { status: 'waiting', waitingFor: 'permission prompt', statusUpdatedAt: Date.now() - 10_000 });
    put(process.ppid, { status: 'idle', statusUpdatedAt: Date.now() - 2 * MIN });
    put(dead, { status: 'busy' });
    const { call } = makeModule({ dataDir: data });
    const before = (await call('GET', '/sessions?show=all')).body;
    expect(before.herdrError).toBe('');
    expect(titles(before)).toEqual(['Needs you 1', 'Done 1', 'Ended 1']);

    const seen = await call('POST', `/sessions/${ID(process.ppid)}/seen`);
    expect(seen.status).toBe(200);
    const after = (await call('GET', '/sessions?show=all')).body;
    expect(titles(after)).toEqual(['Needs you 1', 'Idle 1', 'Ended 1']);
    // the seen marker is a file of the module data folder
    expect(JSON.parse(readFileSync(join(data, 'agents-user-state.json'), 'utf8')).seen[ID(process.ppid)]).toEqual(expect.any(Number));
  });

  it('pin and unpin: the session moves to Pinned and back, the pin survives in the data folder', async () => {
    put(process.pid, { status: 'busy' });
    const { call } = makeModule({ dataDir: data });
    expect(titles((await call('GET', '/sessions')).body)).toEqual(['Working 1']);
    const pin = await call('POST', `/sessions/${ID(process.pid)}/pin`, { body: { pinned: true } });
    expect(pin).toMatchObject({ status: 200, body: { ok: true, pinned: true, pinnedCount: 1 } });
    expect(titles((await call('GET', '/sessions')).body)).toEqual(['Pinned 1']);
    // a new module instance (a restart) reads the same file
    expect(titles((await makeModule({ dataDir: data }).call('GET', '/sessions')).body)).toEqual(['Pinned 1']);
    await call('POST', `/sessions/${ID(process.pid)}/pin`, { body: { pinned: false } });
    expect(titles((await call('GET', '/sessions')).body)).toEqual(['Working 1']);
  });

  it('pinning twice keeps one pin; the id is case-insensitive', async () => {
    const { call } = makeModule({ dataDir: data });
    const id = 'ABCDEF01-0000-4000-8000-000000000001';
    await call('POST', `/sessions/${id}/pin`, { body: { pinned: true } });
    const second = await call('POST', `/sessions/${id.toLowerCase()}/pin`, { body: { pinned: true } });
    expect(second.body.pinnedCount).toBe(1);
  });

  it.each(['abc', '../../x', ID(1) + 'x', 'x' + ID(1), '00000000-0000-4000-8000-00000000000g', '%24sources', '1234'])('refuses the session id %s with an actionable 400', async (id) => {
    const { call } = makeModule({ dataDir: data });
    for (const route of ['pin', 'seen']) {
      const answer = await call('POST', `/sessions/${encodeURIComponent(id)}/${route}`, { body: route === 'pin' ? { pinned: true } : undefined });
      expect(answer.status, `${id} ${route}`).toBe(400);
      expect(answer.body.hint).toContain('8-4-4-4-12');
    }
  });

  it.each([
    ['no body', undefined],
    ['null', null],
    ['an array', [true]],
    ['a string', 'yes'],
    ['pinned as text', { pinned: 'true' }],
    ['pinned missing', {}],
    ['an unknown field', { pinned: true, extra: 1 }],
  ])('refuses a pin body that is %s with an actionable 400, and writes nothing', async (_label, body) => {
    const { call } = makeModule({ dataDir: data });
    const answer = await call('POST', `/sessions/${ID(1)}/pin`, { body });
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ error: 'BAD_REQUEST', message: expect.any(String), hint: expect.stringContaining('pinned') });
    expect(() => readFileSync(join(data, 'agents-user-state.json'))).toThrow();
  });

  it('seen refuses a body, and an unknown session with a 404 that says what to do', async () => {
    put(process.pid, { status: 'idle' });
    const { call } = makeModule({ dataDir: data });
    expect((await call('POST', `/sessions/${ID(process.pid)}/seen`, { body: { x: 1 } })).status).toBe(400);
    const missing = await call('POST', `/sessions/${ID(999_999)}/seen`);
    expect(missing.status).toBe(404);
    expect(missing.body.hint).toContain('next refresh');
  });

  it('seen on an unreadable registry is a 409 with the registry hint', async () => {
    process.env['AGENT_MANAGER_SESSIONS_DIR'] = join(registry, 'missing');
    const answer = await makeModule({ dataDir: data }).call('POST', `/sessions/${ID(1)}/seen`);
    expect(answer.status).toBe(409);
    expect(answer.body.hint).toContain('AGENT_MANAGER_SESSIONS_DIR');
  });

  it('a corrupt user state file is reported (herdrError for the page, 500 with the file for a write) and never overwritten', async () => {
    put(process.pid, { status: 'busy' });
    writeFileSync(join(data, 'agents-user-state.json'), '{"pinned": [');
    const { call } = makeModule({ dataDir: data });
    const page = (await call('GET', '/sessions')).body;
    expect(page.ok).toBe(true);
    expect(page.herdr).toEqual([]);
    expect(page.herdrError).toContain('agents-user-state.json');
    expect(page.cards).toHaveLength(1);
    const write = await call('POST', `/sessions/${ID(1)}/pin`, { body: { pinned: true } });
    expect(write.status).toBe(500);
    expect(write.body.message).toContain('not valid JSON');
    expect(readFileSync(join(data, 'agents-user-state.json'), 'utf8')).toBe('{"pinned": [');
  });

  it('a user state file of the wrong shape is reported, not trusted', async () => {
    writeFileSync(join(data, 'agents-user-state.json'), JSON.stringify({ pinned: ['not-an-id'], seen: {} }));
    put(process.pid, { status: 'busy' });
    expect((await makeModule({ dataDir: data }).call('GET', '/sessions')).body.herdrError).toContain('"pinned" must be an array of session ids');
  });
});
