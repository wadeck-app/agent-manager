import { describe, expect, it } from 'vitest';
import { shortenPath } from './shortenPath.js';

describe('shortenPath: a folder path shortened in the middle, never at the end', () => {
  it('keeps a path that fits', () => {
    // violations-suppress: shared/no-out-of-repo-path a Windows path is the data of the shortening, it is never opened
    expect(shortenPath('C:\\work\\shop', 40)).toBe('C:\\work\\shop');
    expect(shortenPath('/home/me/shop', 40)).toBe('/home/me/shop');
  });

  it('keeps the first segment and the last ones, and says what is left out with three dots', () => {
    // violations-suppress: shared/no-out-of-repo-path a Windows path is the data of the shortening, it is never opened
    expect(shortenPath('C:\\Workspace_Tooling\\agent-manager\\packages\\app-module', 36)).toBe('C:\\...\\packages\\app-module');
    expect(shortenPath('/home/wadeck/projects/client/shop', 24)).toBe('/home/.../client/shop');
  });

  it('keeps as many last segments as fit', () => {
    // violations-suppress: shared/no-out-of-repo-path a Windows path is the data of the shortening, it is never opened
    expect(shortenPath('C:\\aaa\\bbb\\cc\\dd\\ee', 16)).toBe('C:\\...\\cc\\dd\\ee');
  });

  it('a last segment longer than the room is cut in the middle (the name is what matters, and its ending)', () => {
    // violations-suppress: shared/no-out-of-repo-path a Windows path is the data of the shortening, it is never opened
    const shortened = shortenPath('C:\\a\\b\\' + 'x'.repeat(60), 20);
    expect(shortened.length).toBeLessThanOrEqual(20);
    expect(shortened).toContain('...');
    expect(shortened.endsWith('xxxx')).toBe(true);
  });

  it('a path without separator is cut in the middle', () => {
    expect(shortenPath('y'.repeat(50), 20)).toBe(`${'y'.repeat(8)}...${'y'.repeat(9)}`);
  });
});
