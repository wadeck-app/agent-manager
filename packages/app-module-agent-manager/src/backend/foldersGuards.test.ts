import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetScanCache } from './folderBrowse.js';
import { makeModule } from './testKit.js';

// Every call the module code makes to the file system layer, with its first argument: the tests below assert what was NOT opened and how often a file was read.
const seen = vi.hoisted(() => ({ calls: [] as { fn: string; path: string }[] }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const wrap =
    (name: 'stat' | 'lstat' | 'opendir' | 'readdir' | 'readFile' | 'realpath' | 'access') =>
    (...args: unknown[]) => {
      seen.calls.push({ fn: name, path: String(args[0]) });
      return (actual[name] as (...inner: unknown[]) => unknown)(...args);
    };
  return { ...actual, default: actual, stat: wrap('stat'), lstat: wrap('lstat'), opendir: wrap('opendir'), readdir: wrap('readdir'), readFile: wrap('readFile'), realpath: wrap('realpath'), access: wrap('access') };
});

let base: string;
let work: string;
let registry: string;
let config: string;

beforeEach(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), 'fx-guards-')));
  work = join(base, 'work');
  registry = join(base, 'registry');
  config = join(base, 'config');
  for (const dir of [join(work, 'shop'), registry, config]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(config, 'config.yml'), `launchRoots:\n  - '${work}'\n`);
  process.env['AGENT_MANAGER_SESSIONS_DIR'] = registry;
  process.env['AGENT_MANAGER_CONFIG_DIR'] = config;
  resetScanCache();
  seen.calls.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env['AGENT_MANAGER_SESSIONS_DIR'];
  delete process.env['AGENT_MANAGER_CONFIG_DIR'];
  rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const session = (pid: number, cwd: string): void => writeFileSync(join(registry, `${pid}.json`), JSON.stringify({ pid, sessionId: `s-${pid}`, cwd, version: '2.1.323', status: 'idle', statusUpdatedAt: 1000 + pid }));

describe('a forged working directory in the registry is never opened', () => {
  // '//attacker/share/x' is a UNC name on Windows but an ordinary absolute path on POSIX: there the refused equivalent is a path with a '..' segment.
  const forgedSlashes = process.platform === 'win32' ? '//attacker/share/x' : '/work/../attacker/share/x';
  const FORGED = ['\\\\attacker\\share\\x', forgedSlashes, 'relative\\dir', 'C:drive-relative', '/ok\u0007/control'];

  it('GET /folders/recent, /search, /roots and /list skip it, count it in a visible note, and make no file system call that names it', async () => {
    session(1, join(work, 'shop'));
    FORGED.forEach((cwd, index) => session(10 + index, cwd));
    const m = makeModule();
    seen.calls.length = 0;
    const recent = await m.call('GET', '/folders/recent');
    const search = await m.call('GET', '/folders/search?q=x');
    const roots = await m.call('GET', '/folders/roots');
    const listed = await m.call('GET', `/folders/list?path=${encodeURIComponent(work)}`);
    expect(recent.body.folders.map((folder: { path: string }) => folder.path)).toEqual([join(work, 'shop')]);
    expect(recent.body.warnings.join(' ')).toMatch(/5 working directories of the sessions were ignored and never opened: not an absolute local path \(first one: /);
    expect(search.body.warnings.join(' ')).toContain('were ignored and never opened');
    expect(listed.body.warnings.join(' ')).toContain('were ignored and never opened');
    expect(roots.body.roots.map((root: { path: string }) => root.path)).toEqual([work]);
    const opened = seen.calls.map((call) => call.path);
    for (const text of ['attacker', 'relative', 'drive-relative', 'control']) {
      expect(opened.filter((path) => path.includes(text)), text).toEqual([]);
    }
    // The registry itself and the legitimate folders were read: the spy sees the layer.
    expect(opened.some((path) => path.includes('shop'))).toBe(true);
  });
});

describe('the scope is reused while nothing it was built from changed', () => {
  const configReads = (): number => seen.calls.filter((call) => call.fn === 'readFile' && call.path.endsWith('config.yml')).length;
  const registryReads = (): number => seen.calls.filter((call) => (call.fn === 'readFile' || call.fn === 'readdir' || call.fn === 'opendir') && call.path.startsWith(registry)).length;

  it('two consecutive requests read config.yml and the registry once; a changed config.yml, a new session, or the end of the 4 s window read again', async () => {
    session(1, join(work, 'shop'));
    const m = makeModule();
    await m.call('GET', '/folders/roots');
    const firstConfig = configReads();
    const firstRegistry = registryReads();
    expect(firstConfig).toBe(1);
    expect(firstRegistry).toBeGreaterThan(0);
    await m.call('GET', '/folders/roots');
    await m.call('GET', `/folders/list?path=${encodeURIComponent(work)}`);
    await m.call('GET', '/folders/recent');
    expect(configReads()).toBe(firstConfig);
    expect(registryReads()).toBe(firstRegistry);

    // `launch-roots add` (any process) rewrites config.yml: the next request sees it, no restart.
    mkdirSync(join(base, 'extra'));
    writeFileSync(join(config, 'config.yml'), `launchRoots:\n  - '${work}'\n  - '${join(base, 'extra')}'\n`);
    const roots = await m.call('GET', '/folders/roots');
    expect(configReads()).toBe(firstConfig + 1);
    expect(roots.body.roots.map((root: { name: string }) => root.name)).toEqual(['work', 'extra']);

    // A session that starts changes the registry folder.
    const before = registryReads();
    mkdirSync(join(base, 'other-project'));
    session(2, join(base, 'other-project'));
    await m.call('GET', '/folders/roots');
    expect(registryReads()).toBeGreaterThan(before);

    // Nothing changed, but the window is over.
    const reads = configReads();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 5000);
    await m.call('GET', '/folders/roots');
    expect(configReads()).toBe(reads + 1);
  });
});
