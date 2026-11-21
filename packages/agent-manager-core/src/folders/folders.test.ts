import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderError } from './errors.js';
import { addLaunchRoot, readLaunchRoots, removeLaunchRoot } from './launchRoots.js';
import { checkAbsolutePath, isFilesystemRoot, isInside, parentOf, pathKey } from './paths.js';

const WIN = process.platform === 'win32';
const codeOf = (work: () => unknown): string | undefined => {
  try {
    work();
  } catch (error) {
    return error instanceof FolderError ? error.code : `other:${String(error)}`;
  }
  return undefined;
};

describe('checkAbsolutePath', () => {
  // violations-suppress: shared/no-out-of-repo-path a path as a plain value (an example or a test input), never read from disk
  const root = WIN ? 'C:\\work\\shop' : '/work/shop';

  it('normalizes an absolute path and strips the trailing separator', () => {
    expect(checkAbsolutePath(`${root}${WIN ? '\\' : '/'}`)).toBe(root);
    expect(checkAbsolutePath(`  ${root}  `)).toBe(root);
  });

  it.each([
    ['empty', '   ', 'path-missing'],
    ['not a string', 42, 'path-missing'],
    ['relative', 'work/shop', 'path-not-absolute'],
    ['traversal with a slash', `${root}/../x`, 'path-traversal'],
    ['traversal with a backslash', `${root}\\..\\x`, 'path-traversal'],
    ['UNC', '\\\\server\\share\\x', 'path-unc'],
    ['control character', `${root}\u0007`, 'path-invalid'],
    ['too long', `${root}/${'a'.repeat(1100)}`, 'path-invalid'],
  ])('refuses %s', (_name, input, code) => {
    expect(codeOf(() => checkAbsolutePath(input))).toBe(code);
  });

  it.runIf(WIN)('refuses a rooted path without a drive and a drive-relative one', () => {
    expect(codeOf(() => checkAbsolutePath('\\work\\shop'))).toBe('path-not-absolute');
    expect(codeOf(() => checkAbsolutePath('C:shop'))).toBe('path-not-absolute');
  });

  it('every error says what to do', () => {
    expect(() => checkAbsolutePath('relative')).toThrow(/Fix: start from the root/);
  });
});

describe('path helpers', () => {
  // violations-suppress: shared/no-out-of-repo-path a path as a plain value (an example or a test input), never read from disk
  const a = WIN ? 'C:\\Work' : '/work';
  // violations-suppress: shared/no-out-of-repo-path a path as a plain value (an example or a test input), never read from disk
  const child = WIN ? 'C:\\Work\\shop\\src' : '/work/shop/src';
  // violations-suppress: shared/no-out-of-repo-path a path as a plain value (an example or a test input), never read from disk
  const sibling = WIN ? 'C:\\Work2\\shop' : '/work2/shop';

  it('isInside is by segment, not by prefix', () => {
    expect(isInside(a, child)).toBe(true);
    expect(isInside(a, a)).toBe(true);
    expect(isInside(a, sibling)).toBe(false);
    expect(isInside(child, a)).toBe(false);
  });

  it.runIf(WIN)('compares case-insensitively on Windows', () => {
    // violations-suppress: shared/no-out-of-repo-path a path as a plain value (an example or a test input), never read from disk
    expect(pathKey('C:\\Work\\Shop')).toBe(pathKey('c:\\work\\shop'));
    // violations-suppress: shared/no-out-of-repo-path a path as a plain value (an example or a test input), never read from disk
    expect(isInside('c:\\work', 'C:\\WORK\\shop')).toBe(true);
  });

  it('knows the root and the parent', () => {
    // violations-suppress: shared/no-out-of-repo-path a path as a plain value (an example or a test input), never read from disk
    const top = WIN ? 'C:\\' : '/';
    expect(isFilesystemRoot(top)).toBe(true);
    expect(isFilesystemRoot(a)).toBe(false);
    expect(parentOf(top)).toBeNull();
    // violations-suppress: shared/no-out-of-repo-path a path as a plain value (an example or a test input), never read from disk
    expect(parentOf(child)).toBe(WIN ? 'C:\\Work\\shop' : '/work/shop');
  });
});

describe('launchRoots in config.yml', () => {
  let dir: string;
  let folder: string;
  const file = (): string => join(dir, 'config.yml');
  beforeEach(() => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-manager-roots-')));
    folder = join(dir, 'projects');
    mkdirSync(folder);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

  it('reads a missing file or key as no root, with its source', async () => {
    expect(await readLaunchRoots(dir)).toEqual({ roots: [], source: 'default', file: file() });
    writeFileSync(file(), 'autoUpdate: false\n');
    expect((await readLaunchRoots(dir)).source).toBe('default');
  });

  it('adds then removes a root, byte for byte for the other lines (BOM and CRLF kept)', async () => {
    writeFileSync(file(), '\uFEFFautoUpdate: false\r\nreplyMarker: none\r\n');
    const added = await addLaunchRoot(dir, folder);
    expect(added).toMatchObject({ changed: true, roots: [folder] });
    const text = readFileSync(file(), 'utf8');
    expect(text.startsWith('\uFEFFautoUpdate: false\r\nreplyMarker: none\r\nlaunchRoots:\r\n')).toBe(true);
    expect(text).toContain(`  - '${folder}'\r\n`);
    expect(await removeLaunchRoot(dir, folder)).toMatchObject({ changed: true, roots: [] });
    expect(readFileSync(file(), 'utf8')).toBe('\uFEFFautoUpdate: false\r\nreplyMarker: none\r\nlaunchRoots: []\r\n');
  });

  it('quotes a path with an apostrophe and reads it back', async () => {
    const odd = join(dir, "it's");
    mkdirSync(odd);
    await addLaunchRoot(dir, odd);
    expect(readFileSync(file(), 'utf8')).toContain("it''s'");
    expect((await readLaunchRoots(dir)).roots).toEqual([odd]);
  });

  it('adding the same folder twice writes once', async () => {
    await addLaunchRoot(dir, folder);
    const written = readFileSync(file(), 'utf8');
    expect(await addLaunchRoot(dir, folder)).toMatchObject({ changed: false });
    expect(readFileSync(file(), 'utf8')).toBe(written);
  });

  it.each([
    ['a flow list', 'launchRoots: [a]\n', /must be a block list.*line 1|line 1.*must be a block list/],
    ['a scalar', 'launchRoots: /x\n', /must be a block list/],
    ['an indented key', 'outer:\n  launchRoots:\n    - /x\n', /line 2: launchRoots is indented/],
    ['a repeated key', 'launchRoots:\n  - /x\nlaunchRoots:\n  - /y\n', /set 2 times/],
    ['[] with items', 'launchRoots: []\n  - /x\n', /is \[\] but items follow/],
    ['a relative item', 'launchRoots:\n  - rel/dir\n', /line 2: .*not an absolute path/],
    ['an unclosed quote', "launchRoots:\n  - 'abc\n", /not closed/],
    // violations-suppress: shared/no-out-of-repo-path a path as a plain value (an example or a test input), never read from disk
    ['a bad double-quoted escape', 'launchRoots:\n  - "C:\\Projects"\n', /not a valid double-quoted text/],
  ])('refuses %s with the file, the line and a fix', async (_name, content, message) => {
    writeFileSync(file(), content);
    await expect(readLaunchRoots(dir)).rejects.toThrow(message);
    await expect(readLaunchRoots(dir)).rejects.toThrow(/Fix: /);
    // Nothing is written over a file that cannot be understood.
    await expect(addLaunchRoot(dir, folder)).rejects.toThrow();
    expect(readFileSync(file(), 'utf8')).toBe(content);
  });

  it('reads an unindented list (items at the column of the key), and a rewrite replaces those lines instead of orphaning them', async () => {
    writeFileSync(file(), `autoUpdate: false\nlaunchRoots:\n- '${folder}'\nreplyMarker: none\n`);
    expect((await readLaunchRoots(dir)).roots).toEqual([folder]);
    const other = join(dir, 'other');
    mkdirSync(other);
    await addLaunchRoot(dir, other);
    const added = readFileSync(file(), 'utf8');
    expect(added.match(/^\s*- /gm)).toHaveLength(2);
    expect(added).toContain('replyMarker: none');
    expect((await readLaunchRoots(dir)).roots).toEqual([folder, other]);
    await removeLaunchRoot(dir, folder);
    await removeLaunchRoot(dir, other);
    expect(readFileSync(file(), 'utf8')).toBe('autoUpdate: false\nlaunchRoots: []\nreplyMarker: none\n');
  });

  it('refuses a line under the key that is not an item, so a rewrite can never orphan it', async () => {
    const content = `launchRoots:\n  - '${folder}'\n    continued: text\n`;
    writeFileSync(file(), content);
    await expect(readLaunchRoots(dir)).rejects.toThrow(/line 3: this line belongs to launchRoots but is not a '- folder' item/);
    await expect(removeLaunchRoot(dir, folder)).rejects.toThrow(/line 3/);
    expect(readFileSync(file(), 'utf8')).toBe(content);
  });

  it('a # inside quotes is part of the folder; after the closing quote or after a plain value it starts a comment', async () => {
    const hash = join(dir, 'My #1');
    mkdirSync(hash);
    await addLaunchRoot(dir, hash);
    expect((await readLaunchRoots(dir)).roots).toEqual([hash]);
    writeFileSync(file(), `launchRoots:\n  - '${hash}' # my projects\n  - "${folder.split('\\').join('\\\\')}" # second\n`);
    expect((await readLaunchRoots(dir)).roots).toEqual([hash, folder]);
    writeFileSync(file(), `launchRoots:\n  - ${folder} # plain\n`);
    expect((await readLaunchRoots(dir)).roots).toEqual([folder]);
  });

  it('refuses to add a missing folder, a file and a traversal', async () => {
    await expect(addLaunchRoot(dir, join(dir, 'nope'))).rejects.toMatchObject({ code: 'root-missing' });
    writeFileSync(join(dir, 'f.txt'), '');
    await expect(addLaunchRoot(dir, join(dir, 'f.txt'))).rejects.toMatchObject({ code: 'root-not-a-folder' });
    await expect(addLaunchRoot(dir, `${folder}/../x`)).rejects.toMatchObject({ code: 'path-traversal' });
  });
});
