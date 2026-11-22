import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOT_SENSITIVE_READ_ROUTES } from '../commons/routeClasses.js';
import { cachedScan, gitInfo, resetScanCache, searchScore } from './folderBrowse.js';
import { derivedRootOf } from './foldersScope.js';
import { makeModule } from './testKit.js';

// A sandbox per test: `base` holds the registry, the config folder and the folders to browse (real path: the temp folder can be a link on some systems).
let base: string;
let work: string;
let outside: string;
let registry: string;
let config: string;

const mk = (...parts: string[]): string => {
  const path = join(base, ...parts);
  mkdirSync(path, { recursive: true });
  return path;
};
const writeConfig = (text: string): void => writeFileSync(join(config, 'config.yml'), text);
const configure = (...roots: string[]): void => writeConfig(`launchRoots:\n${roots.map((root) => `  - '${root}'`).join('\n')}\n`);
const session = (pid: number, cwd: string, at = 1000): void => writeFileSync(join(registry, `${pid}.json`), JSON.stringify({ pid, sessionId: `s-${pid}`, cwd, version: '2.1.323', status: 'idle', statusUpdatedAt: at }));
/** A link to a folder: a junction on Windows (no privilege needed), a symbolic link elsewhere. It throws when it cannot be made: a test never passes by skipping. */
const link = (target: string, path: string): void => symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir');
const git = (dir: string, head = 'ref: refs/heads/main\n'): void => {
  mkdirSync(join(dir, '.git'), { recursive: true });
  writeFileSync(join(dir, '.git', 'HEAD'), head);
};

beforeEach(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), 'fx-folders-')));
  work = mk('work');
  outside = mk('outside', 'secret');
  registry = mk('registry');
  config = mk('config');
  process.env['AGENT_MANAGER_SESSIONS_DIR'] = registry;
  process.env['AGENT_MANAGER_CONFIG_DIR'] = config;
  resetScanCache();
});
afterEach(() => {
  delete process.env['AGENT_MANAGER_SESSIONS_DIR'];
  delete process.env['AGENT_MANAGER_CONFIG_DIR'];
  rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const list = (path: string) => makeModule().call('GET', `/folders/list?path=${encodeURIComponent(path)}`);

describe('route classes', () => {
  it('registers exactly the four folder reads, and they are the documented not-sensitive reads', () => {
    const folderRoutes = makeModule().registered.filter((route) => route.key.startsWith('GET /folders/'));
    expect(folderRoutes.map((route) => route.key).sort()).toEqual([...NOT_SENSITIVE_READ_ROUTES].sort());
    expect(folderRoutes.every((route) => route.effect === undefined)).toBe(true);
  });
});

describe('GET /folders/roots', () => {
  it('with nothing configured and no session, says why nothing can be browsed and how to fix it (no silent empty list)', async () => {
    const { status, body } = await makeModule().call('GET', '/folders/roots');
    expect(status).toBe(200);
    expect(body.roots).toEqual([]);
    expect(body.note).toContain('agent-manager launch-roots add <path>');
    expect(body.note).toContain('You can still type a path');
    expect(body.configFile).toBe(join(config, 'config.yml'));
  });

  it('lists the configured roots and the parent of the folder of a session, each with its source, outermost only', async () => {
    const shop = mk('code', 'shop');
    configure(work, join(work, 'deeper'));
    mkdirSync(join(work, 'deeper'));
    session(11, shop);
    const { body } = await makeModule().call('GET', '/folders/roots');
    expect(body.note).toBe('');
    // `deeper` is inside `work`: not repeated. The parent of the session folder is `code`.
    expect(body.roots).toEqual([
      { path: work, name: 'work', source: 'config' },
      { path: join(base, 'code'), name: 'code', source: 'sessions' },
    ]);
  });

  it('a configured root that does not exist is said, not dropped silently', async () => {
    configure(work, join(base, 'gone'));
    const { body } = await makeModule().call('GET', '/folders/roots');
    expect(body.roots.map((root: { path: string }) => root.path)).toEqual([work]);
    expect(body.note).toContain('does not exist');
    expect(body.note).toContain(join(base, 'gone'));
    expect(body.note).toContain('launch-roots remove');
  });

  it('a launchRoots that cannot be understood degrades: the roots of the sessions only, and the file, line and fix said in configProblem, in the note and as a warning everywhere', async () => {
    writeConfig('autoUpdate: false\nlaunchRoots: [a]\n');
    const shop = mk('code', 'shop');
    mk('code', 'blog');
    session(81, shop);
    const m = makeModule();
    const roots = await m.call('GET', '/folders/roots');
    expect(roots.status).toBe(200);
    expect(roots.body.roots).toEqual([{ path: join(base, 'code'), name: 'code', source: 'sessions' }]);
    expect(roots.body.configProblem).toContain(join(config, 'config.yml'));
    expect(roots.body.configProblem).toContain('line 2');
    expect(roots.body.configProblem).toContain('must be a block list');
    expect(roots.body.configProblem).toContain('Fix:');
    expect(roots.body.note).toContain(roots.body.configProblem);
    // The browsing still works inside the roots of the sessions, and says why the configured roots are missing.
    const listed = await m.call('GET', `/folders/list?path=${encodeURIComponent(join(base, 'code'))}`);
    expect(listed.status).toBe(200);
    expect(listed.body.entries.map((entry: { name: string }) => entry.name)).toEqual(['blog', 'shop']);
    expect(listed.body.warnings[0]).toContain('line 2');
    expect((await m.call('GET', '/folders/recent')).body.warnings[0]).toContain('line 2');
    expect((await m.call('GET', '/folders/search?q=shop')).body.warnings[0]).toContain('line 2');
    // Fixed: back to the configured roots, no restart.
    configure(work);
    const fixed = await m.call('GET', '/folders/roots');
    expect(fixed.body.configProblem).toBe('');
    expect(fixed.body.roots.map((root: { path: string }) => root.path)).toContain(work);
  });
});

describe('derived roots', () => {
  it('a folder directly under a drive root or the home folder never gives that parent', () => {
    // violations-suppress: shared/no-out-of-repo-path a path as a plain value (an example or a test input), never read from disk
    const top = process.platform === 'win32' ? 'C:\\' : '/';
    const home = join(top, 'Users', 'me');
    expect(derivedRootOf(join(top, 'shop'), home)).toBe(join(top, 'shop'));
    // The home folder and a drive root are never a root, not even when the session ran in them.
    expect(derivedRootOf(home, home)).toBeUndefined();
    expect(derivedRootOf(top, home)).toBeUndefined();
    // Never derived: a folder that equals or contains the home folder, a folder of accounts, and the home folder of another account.
    expect(derivedRootOf(join(top, 'Users'), home)).toBeUndefined();
    expect(derivedRootOf(join(top, 'Users', 'other'), home)).toBeUndefined();
    expect(derivedRootOf(join(top, 'home'), join(top, 'srv', 'me'))).toBeUndefined();
    expect(derivedRootOf(join(top, 'Users', 'other', 'shop'), home)).toBe(join(top, 'Users', 'other', 'shop'));
    expect(derivedRootOf(join(top, 'Users', 'me', 'deeper', 'shop'), home)).toBe(join(top, 'Users', 'me', 'deeper'));
    // Directly under the home folder: the project itself, never the home folder (its listing would show every folder of it).
    expect(derivedRootOf(join(home, 'shop'), home)).toBe(join(home, 'shop'));
    expect(derivedRootOf(join(top, 'code', 'shop'), home)).toBe(join(top, 'code'));
  });
});

describe('the home folder is never a root', () => {
  it('a session directly under the home folder gives that project, not the home folder, and the home folder cannot be listed', async () => {
    const home = realpathSync.native(homedir());
    const project = join(home, 'fx-home-project');
    mkdirSync(project, { recursive: true });
    try {
      session(71, project);
      const { body } = await makeModule().call('GET', '/folders/roots');
      expect(body.roots).toEqual([{ path: project, name: 'fx-home-project', source: 'sessions' }]);
      const listed = await list(home);
      expect([listed.status, listed.body.error.code]).toEqual([403, 'folder-not-browsable']);
      // A session that ran in the home folder itself adds no root either.
      session(72, home);
      expect((await makeModule().call('GET', '/folders/roots')).body.roots.map((root: { path: string }) => root.path)).toEqual([project]);
    } finally {
      rmSync(project, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    }
  });
});

describe('GET /folders/list', () => {
  beforeEach(() => {
    configure(work);
  });

  it('lists the subfolders only: sorted with digits as numbers, no file, hidden and technical folders counted as skipped', async () => {
    for (const name of ['beta', 'Alpha', '10-x', '2-y', '.hidden', 'node_modules']) {
      mkdirSync(join(work, name));
    }
    writeFileSync(join(work, 'readme.md'), 'x');
    const { status, body } = await list(work);
    expect(status).toBe(200);
    expect(body.entries.map((entry: { name: string }) => entry.name)).toEqual(['2-y', '10-x', 'Alpha', 'beta']);
    expect(body).toMatchObject({ ok: true, path: work, name: 'work', parent: null, truncated: false, skipped: 2, limit: 300 });
    expect(JSON.stringify(body)).not.toContain('readme');
    expect(body.breadcrumbs).toEqual([{ name: work, path: work }]);
  });

  it('flags a git repository with its branch, a worktree file, a detached HEAD and the folders sessions ran in', async () => {
    git(mk('work', 'alpha'));
    git(mk('work', 'detached'), '0123456789abcdef0123456789abcdef01234567\n');
    const tree = mk('work', 'tree');
    writeFileSync(join(tree, '.git'), `gitdir: ${join(base, 'gitdirs', 'tree')}\n`);
    mkdirSync(join(base, 'gitdirs', 'tree'), { recursive: true });
    writeFileSync(join(base, 'gitdirs', 'tree', 'HEAD'), 'ref: refs/heads/feature/x\n');
    mk('work', 'plain');
    session(21, join(work, 'plain'));
    const entries = Object.fromEntries((await list(work)).body.entries.map((entry: { name: string }) => [entry.name, entry]));
    expect(entries['alpha']).toMatchObject({ hasGit: true, branch: 'main', isRecent: false, isKnownProject: true, isLink: false, path: join(work, 'alpha') });
    expect(entries['detached']).toMatchObject({ hasGit: true });
    expect(entries['detached'].branch).toBeUndefined();
    expect(entries['tree']).toMatchObject({ hasGit: true, branch: 'feature/x' });
    expect(entries['plain']).toMatchObject({ hasGit: false, isRecent: true, isKnownProject: true });
  });

  it('gives the breadcrumbs from the root, the parent below it, and the branch of the folder itself', async () => {
    const sub = mk('work', 'a', 'b');
    git(sub);
    const { body } = await list(sub);
    expect(body.breadcrumbs.map((crumb: { name: string }) => crumb.name)).toEqual([work, 'a', 'b']);
    expect(body.parent).toBe(join(work, 'a'));
    expect(body).toMatchObject({ hasGit: true, branch: 'main' });
  });

  it('bounds a listing: 300 entries, truncated flagged, with the limit', async () => {
    for (let index = 0; index < 305; index += 1) {
      mkdirSync(join(work, `d${String(index).padStart(3, '0')}`));
    }
    const { body } = await list(work);
    expect(body.entries).toHaveLength(300);
    expect(body.truncated).toBe(true);
    expect(body.limit).toBe(300);
    expect(body.entries[0].name).toBe('d000');
  });

  it('refuses a missing parameter, a relative path, a traversal, a UNC path and several values, each with its hint', async () => {
    const m = makeModule();
    const missing = await m.call('GET', '/folders/list');
    expect([missing.status, missing.body.error.code]).toEqual([400, 'path-missing']);
    expect(missing.body.error.hint).toContain('/folders/roots');
    for (const [path, code] of [
      ['work/alpha', 'path-not-absolute'],
      [`${work}/../outside`, 'path-traversal'],
      [`${work}\\..\\outside`, 'path-traversal'],
      ['\\\\evil\\share', 'path-unc'],
    ] as const) {
      const answer = await m.call('GET', `/folders/list?path=${encodeURIComponent(path)}`);
      expect([answer.status, answer.body.error.code], path).toEqual([400, code]);
      expect(answer.body.error.hint.length).toBeGreaterThan(10);
    }
    const twice = await m.call('GET', `/folders/list?path=${encodeURIComponent(work)}&path=${encodeURIComponent(work)}`);
    expect(twice.status).toBe(400);
  });

  it('refuses a folder outside the roots with the same answer whether it exists or not, and says how to allow it', async () => {
    const m = makeModule();
    const real = await m.call('GET', `/folders/list?path=${encodeURIComponent(outside)}`);
    const absent = await m.call('GET', `/folders/list?path=${encodeURIComponent(join(base, 'outside', 'nothing'))}`);
    expect(real.status).toBe(403);
    expect(real.body.error.code).toBe('folder-not-browsable');
    expect(real.body.error.hint).toContain(`launch-roots add ${outside}`);
    expect(absent.status).toBe(403);
    expect(absent.body.error.code).toBe('folder-not-browsable');
    expect(absent.body.error.hint).not.toContain(outside);
  });

  it('a sibling that only shares a name prefix with a root is outside it', async () => {
    const sibling = mk('work-other');
    const { status, body } = await list(sibling);
    expect(status).toBe(403);
    expect(body.error.code).toBe('folder-not-browsable');
  });

  it('answers 404 for a folder inside the roots that does not exist and 400 for a file', async () => {
    writeFileSync(join(work, 'a.txt'), '');
    expect((await list(join(work, 'nope'))).body.error.code).toBe('folder-not-found');
    expect((await list(join(work, 'nope'))).status).toBe(404);
    const file = await list(join(work, 'a.txt'));
    expect([file.status, file.body.error.code]).toEqual([400, 'not-a-folder']);
  });

  it('does not follow a link or junction out of the roots, and lists one that stays inside', async () => {
    mk('work', 'inside');
    link(outside, join(work, 'escape'));
    link(join(work, 'inside'), join(work, 'shortcut'));
    const { body } = await list(work);
    expect(body.entries.map((entry: { name: string }) => entry.name)).toEqual(['inside', 'shortcut']);
    expect(body.entries.find((entry: { name: string }) => entry.name === 'shortcut').isLink).toBe(true);
    expect(body.skipped).toBe(1);
    // Asked for directly, the link is refused too: its real folder is outside.
    const direct = await list(join(work, 'escape'));
    expect([direct.status, direct.body.error.code]).toEqual([403, 'folder-not-browsable']);
  });

  it('a root that is itself a link is browsed, and the folders below it are listed by the link path', async () => {
    const target = mk('real-projects', 'p1');
    const via = join(base, 'via');
    link(join(base, 'real-projects'), via);
    configure(via);
    const { body } = await list(via);
    expect(body.entries.map((entry: { path: string }) => entry.path)).toEqual([join(via, 'p1')]);
    expect(target).toContain('real-projects');
    expect((await list(join(via, 'p1'))).status).toBe(200);
  });

  it('a session folder makes its siblings browsable', async () => {
    writeConfig('autoUpdate: false\n');
    const shop = mk('code', 'shop');
    mk('code', 'blog');
    session(31, shop);
    const { status, body } = await list(join(base, 'code'));
    expect(status).toBe(200);
    expect(body.entries.map((entry: { name: string; isRecent: boolean }) => [entry.name, entry.isRecent])).toEqual([['blog', false], ['shop', true]]);
  });
});

describe('GET /folders/search', () => {
  beforeEach(() => {
    configure(work);
    git(mk('work', 'agent-manager'));
    mk('work', 'shop', 'frontend');
    mk('work', 'blog');
  });

  it('finds a folder at depth 2 of a root by a scattered match, best name first, with its flags', async () => {
    const { status, body } = await makeModule().call('GET', '/folders/search?q=agmgr');
    expect(status).toBe(200);
    expect(body.results.map((result: { name: string }) => result.name)).toEqual(['agent-manager']);
    expect(body.results[0]).toMatchObject({ hasGit: true, branch: 'main', path: join(work, 'agent-manager') });
    const deep = await makeModule().call('GET', '/folders/search?q=front');
    expect(deep.body.results[0].path).toBe(join(work, 'shop', 'frontend'));
  });

  it('a recent folder outside the roots is found and ranks first; a deleted one is not offered', async () => {
    const elsewhere = mk('elsewhere', 'blog-notes');
    session(41, elsewhere, 5000);
    session(42, join(base, 'elsewhere', 'blog-gone'), 6000);
    const { body } = await makeModule().call('GET', '/folders/search?q=blog');
    expect(body.results.map((result: { path: string }) => result.path)).toEqual([elsewhere, join(work, 'blog')].sort((a) => (a === elsewhere ? -1 : 1)));
    expect(body.results[0]).toMatchObject({ isRecent: true, lastUsedAt: 5000 });
  });

  it('an empty query lists the recent folders, and no match is an empty list, not an error', async () => {
    session(51, join(work, 'blog'), 7000);
    const recent = await makeModule().call('GET', '/folders/search');
    expect(recent.body.results.map((result: { name: string }) => result.name)).toEqual(['blog']);
    const none = await makeModule().call('GET', '/folders/search?q=zzzzqqq');
    expect(none.body).toMatchObject({ ok: true, results: [], truncated: false });
  });

  it('refuses a query that is too long, and reports an unreadable registry as a warning', async () => {
    const long = await makeModule().call('GET', `/folders/search?q=${'a'.repeat(201)}`);
    expect([long.status, long.body.error.code]).toEqual([400, 'query-too-long']);
    process.env['AGENT_MANAGER_SESSIONS_DIR'] = join(base, 'no-registry');
    const { body } = await makeModule().call('GET', '/folders/search?q=blog');
    expect(body.ok).toBe(true);
    expect(body.warnings[0]).toContain('The session registry cannot be read');
  });

  it('caches the scan of the roots for 30 seconds', async () => {
    const scope = { roots: [{ path: work, real: work, name: 'work', source: 'config' as const }], known: { folders: new Map(), warnings: [], ignored: 0 }, missing: [], configFile: '', configProblem: '' };
    const first = await cachedScan(scope, 1_000_000);
    mk('work', 'late-folder');
    expect((await cachedScan(scope, 1_020_000)).projects).toHaveLength(first.projects.length);
    expect((await cachedScan(scope, 1_031_000)).projects.length).toBe(first.projects.length + 1);
  });
});

describe('GET /folders/recent', () => {
  it('lists the distinct folders of the sessions, most recent first, with uses, branch and existence', async () => {
    const shop = mk('code', 'shop');
    git(shop);
    session(61, shop, 2000);
    session(62, shop, 3000);
    session(63, join(base, 'code', 'deleted'), 1000);
    const { status, body } = await makeModule().call('GET', '/folders/recent');
    expect(status).toBe(200);
    expect(body.folders).toMatchObject([
      { path: shop, name: 'shop', lastUsedAt: 3000, uses: 2, exists: true, hasGit: true, branch: 'main', isRecent: true },
      { path: join(base, 'code', 'deleted'), exists: false, hasGit: false, uses: 1 },
    ]);
    expect(body.warnings).toEqual([]);
  });

  it('says when the registry cannot be read instead of answering an empty list', async () => {
    process.env['AGENT_MANAGER_SESSIONS_DIR'] = join(base, 'no-registry');
    const { body } = await makeModule().call('GET', '/folders/recent');
    expect(body.folders).toEqual([]);
    expect(body.warnings.join(' ')).toContain('The session registry cannot be read');
  });
});

describe('gitInfo and searchScore', () => {
  it('reads nothing but the branch, and says false for a folder without .git', async () => {
    const repo = mk('repo');
    expect(await gitInfo(repo)).toEqual({ hasGit: false });
    git(repo, 'ref: refs/heads/release/1.0\n');
    expect(await gitInfo(repo)).toEqual({ hasGit: true, branch: 'release/1.0' });
    writeFileSync(join(repo, '.git', 'HEAD'), 'garbage');
    expect(await gitInfo(repo)).toEqual({ hasGit: true });
  });

  it('every word must match; a name prefix beats a substring beats a scattered match beats the path', () => {
    const none = { isRecent: false, hasGit: false };
    const score = (query: string, path: string): number => searchScore(query, path, none);
    expect(score('shop', '/w/shop')).toBeGreaterThan(score('shop', '/w/my-shop'));
    expect(score('shop', '/w/my-shop')).toBeGreaterThan(score('shp', '/w/shop-x'.replace('-x', '')) - 1);
    expect(score('sp', '/w/shop')).toBeGreaterThan(score('w', '/w/shop') - 1);
    expect(score('shop zzz', '/w/shop')).toBe(0);
    expect(score('shop', '/w/blog')).toBe(0);
    // A scattered match never reaches the folders above the parent (a long temp or home folder would match anything).
    expect(score('agmgr', '/a/g/m/g/r/work/blog')).toBe(0);
    expect(score('', '/w/shop')).toBe(0);
    expect(searchScore('shop', '/w/shop', { isRecent: true, hasGit: true })).toBeGreaterThan(score('shop', '/w/shop'));
  });
});
