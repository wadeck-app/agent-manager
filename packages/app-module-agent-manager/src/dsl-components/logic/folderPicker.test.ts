import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAVORITES_STORAGE_KEY, MAX_FAVORITES, completed, folderName, pickOf, readFavorites, samePath, saveFavorites, separatorOf, splitTyped, startingWith, toggleFavorite } from './folderPicker.js';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('splitTyped', () => {
  it('splits at the last separator, with the folder to list and what to complete', () => {
    expect(splitTyped('/work/sh')).toEqual({ dir: '/work', partial: 'sh', head: '/work/' });
    expect(splitTyped('/work/')).toEqual({ dir: '/work', partial: '', head: '/work/' });
    // violations-suppress: shared/no-out-of-repo-path a path as a plain value (an example or a test input), never read from disk
    expect(splitTyped('C:\\Projects\\sh')).toEqual({ dir: 'C:\\Projects', partial: 'sh', head: 'C:\\Projects\\' });
  });

  it('keeps a root as a folder (its separator is part of the path)', () => {
    expect(splitTyped('/w')).toEqual({ dir: '/', partial: 'w', head: '/' });
    // violations-suppress: shared/no-out-of-repo-path a path as a plain value (an example or a test input), never read from disk
    expect(splitTyped('C:\\Pr')).toEqual({ dir: 'C:\\', partial: 'Pr', head: 'C:\\' });
    // violations-suppress: shared/no-out-of-repo-path a path as a plain value (an example or a test input), never read from disk
    expect(splitTyped('C:/Pr')).toEqual({ dir: 'C:\\', partial: 'Pr', head: 'C:/' });
  });

  it('a word without a separator is not a path yet', () => {
    expect(splitTyped('shop')).toBeUndefined();
    expect(splitTyped('C:')).toBeUndefined();
    expect(splitTyped('')).toBeUndefined();
  });
});

describe('completion', () => {
  it('filters by the start of the name, whatever the case, and writes the folder with the separator of the text', () => {
    const entries = [{ name: 'Alpha' }, { name: 'alps' }, { name: 'beta' }];
    expect(startingWith(entries, 'AL').map((entry) => entry.name)).toEqual(['Alpha', 'alps']);
    expect(startingWith(entries, '')).toHaveLength(3);
    // violations-suppress: shared/no-out-of-repo-path a path as a plain value (an example or a test input), never read from disk
    const typed = splitTyped('C:\\Work\\al')!;
    // violations-suppress: shared/no-out-of-repo-path a path as a plain value (an example or a test input), never read from disk
    expect(completed(typed, { name: 'Alpha' })).toBe('C:\\Work\\Alpha\\');
    expect(completed(splitTyped('/work/al')!, { name: 'Alpha' })).toBe('/work/Alpha/');
  });
});

describe('paths', () => {
  it('names, separators and sameness', () => {
    // violations-suppress: shared/no-out-of-repo-path a path as a plain value (an example or a test input), never read from disk
    expect(folderName('C:\\Projects\\shop\\')).toBe('shop');
    expect(folderName('/')).toBe('/');
    // violations-suppress: shared/no-out-of-repo-path a path as a plain value (an example or a test input), never read from disk
    expect(separatorOf('C:\\x')).toBe('\\');
    expect(separatorOf('/x')).toBe('/');
    // violations-suppress: shared/no-out-of-repo-path a path as a plain value (an example or a test input), never read from disk
    expect(samePath('C:\\Work\\Shop\\', 'c:\\work\\shop')).toBe(true);
    expect(samePath('/a', '/b')).toBe(false);
    expect(pickOf({ path: '/a', name: 'a', hasGit: true, branch: 'main' })).toEqual({ path: '/a', name: 'a', hasGit: true, branch: 'main' });
    expect(pickOf({ path: '/a', name: 'a', hasGit: false })).toEqual({ path: '/a', name: 'a', hasGit: false });
  });
});

describe('favorites', () => {
  it('start empty, are saved and read back without duplicates', () => {
    expect(readFavorites()).toEqual({ folders: [], problem: '' });
    expect(saveFavorites(['/a', '/b'])).toBe('');
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(['/a', '/b', '/a']));
    expect(readFavorites().folders).toEqual(['/a', '/b']);
  });

  it('a corrupt value is ignored with the reason, never half read', () => {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, '{"a":1}');
    expect(readFavorites()).toMatchObject({ folders: [], problem: expect.stringContaining('were ignored') });
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, 'not json');
    expect(readFavorites().problem).toContain('cannot be read');
  });

  it('a browser that refuses storage is said, not forgotten silently', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(saveFavorites(['/a'])).toContain('could not be remembered');
  });

  it('toggles by path (case and trailing separator ignored) and refuses a pin past the limit', () => {
    expect(toggleFavorite([], '/a')).toEqual({ folders: ['/a'], problem: '' });
    expect(toggleFavorite(['/a'], '/A/')).toEqual({ folders: [], problem: '' });
    const full = Array.from({ length: MAX_FAVORITES }, (_, index) => `/f${index}`);
    expect(toggleFavorite(full, '/new')).toEqual({ folders: full, problem: expect.stringContaining(`At most ${MAX_FAVORITES}`) });
  });
});
