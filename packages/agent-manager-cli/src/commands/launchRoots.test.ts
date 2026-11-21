import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, makeHarness } from '../testHelpers.js';

describe('agent-manager launch-roots', () => {
  let h: Harness;
  let projects: string;
  const configFile = (): string => join(h.configDir, 'config.yml');
  const text = (): string => readFileSync(configFile(), 'utf8');

  beforeEach(() => {
    h = makeHarness();
    // A real folder of the harness' temp root: `add` checks that the folder exists.
    projects = join(h.configDir, '..', 'projects');
    mkdirSync(projects, { recursive: true });
  });
  afterEach(() => h.cleanup());

  it('show says nothing is configured, where that comes from, and the notes', async () => {
    const result = await h.cli(['launch-roots', 'show']);
    expect(result.code).toBe(0);
    expect(result.out).toContain('No launch root configured.');
    expect(result.out).toContain('default');
    expect(result.out).toContain('launch-roots add <path>');
    expect(result.out).toContain('never the home folder or a drive root');
  });

  it('add writes a block list, keeps the other keys of config.yml, and show lists the root (also as --json)', async () => {
    const before = text();
    const added = await h.cli(['launch-roots', 'add', projects]);
    expect(added.code).toBe(0);
    expect(added.out).toContain('Added to');
    expect(text()).toContain(before.trimEnd());
    expect(text()).toMatch(/^launchRoots:\n {2}- '.+projects'\n/m);
    const shown = JSON.parse((await h.cli(['launch-roots', 'show', '--json'])).out);
    expect(shown).toMatchObject({ source: 'config.yml', file: configFile() });
    expect(shown.roots).toHaveLength(1);
    expect(shown.roots[0]).toContain('projects');
  });

  it('add of a root already there writes nothing and says so', async () => {
    await h.cli(['launch-roots', 'add', projects]);
    const written = text();
    const again = await h.cli(['launch-roots', 'add', projects]);
    expect(again.code).toBe(0);
    expect(again.out).toContain('Already a launch root: nothing was written.');
    expect(text()).toBe(written);
  });

  it('add refuses a folder that does not exist, a file, a relative path and a path with ..', async () => {
    const missing = await h.cli(['launch-roots', 'add', join(projects, 'nope')]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('cannot be read');
    expect(missing.err).toContain('Fix: give the path of an existing folder');
    const file = join(projects, 'a.txt');
    writeFileSync(file, 'x');
    expect((await h.cli(['launch-roots', 'add', file])).err).toContain('is a file, not a folder');
    expect((await h.cli(['launch-roots', 'add', 'relative/dir'])).err).toContain('is not an absolute path');
    expect((await h.cli(['launch-roots', 'add', `${projects}/../x`])).err).toContain("contains a '..' segment");
    expect(text()).not.toContain('launchRoots');
  });

  it('remove takes a root out (a root that no longer exists included) and says when it was not one', async () => {
    const other = join(h.configDir, '..', 'other');
    mkdirSync(other);
    await h.cli(['launch-roots', 'add', projects]);
    await h.cli(['launch-roots', 'add', other]);
    expect((await h.cli(['launch-roots', 'remove', projects])).out).toContain('Removed from');
    expect(text()).not.toContain('projects');
    expect(text()).toContain('other');
    const absent = await h.cli(['launch-roots', 'remove', projects]);
    expect(absent.code).toBe(1);
    expect(absent.err).toContain('is not a launch root');
    expect(absent.err).toContain("Fix: run 'agent-manager launch-roots show'");
    expect((await h.cli(['launch-roots', 'remove', other])).out).toContain('No launch root configured.');
    expect(text()).toContain('launchRoots: []');
  });

  it('a malformed launchRoots is an error naming the file and the line, never an empty list', async () => {
    writeFileSync(configFile(), 'autoUpdate: false\nlaunchRoots: [a, b]\n');
    const result = await h.cli(['launch-roots', 'show']);
    expect(result.code).toBe(1);
    expect(result.err).toContain(configFile());
    expect(result.err).toContain('line 2');
    expect(result.err).toContain('must be a block list');
    expect(result.out).toBe('');
    expect((await h.cli(['launch-roots', 'add', projects])).code).toBe(1);
    expect(text()).toBe('autoUpdate: false\nlaunchRoots: [a, b]\n');
  });

  it('reads plain, single and double quoted items and a Windows path in single quotes', async () => {
    // In a double-quoted YAML text a backslash is written twice.
    const doubled = projects.split('\\').join('\\\\');
    writeFileSync(configFile(), `autoUpdate: false\nlaunchRoots:\n  - ${projects}\n  # a comment\n  - "${doubled}/two" # trailing\nreplyMarker: none\n`);
    const shown = JSON.parse((await h.cli(['launch-roots', 'show', '--json'])).out);
    expect(shown.roots).toHaveLength(2);
    expect(shown.roots[1]).toContain('two');
    // The key after the block is kept when a root is added.
    mkdirSync(join(projects, 'three'));
    await h.cli(['launch-roots', 'add', join(projects, 'three')]);
    expect(text()).toMatch(/replyMarker: none\n$/);
    expect(text().split('\n').filter((line) => line.startsWith('  - '))).toHaveLength(3);
  });

  it('refuses show with an argument', async () => {
    expect((await h.cli(['launch-roots', 'show', 'x'])).code).toBe(2);
    expect((await h.cli(['launch-roots', 'add'])).code).toBe(2);
  });
});
