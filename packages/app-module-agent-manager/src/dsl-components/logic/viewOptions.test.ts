import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VIEW_OPTIONS, parseViewOptions, saveViewOptions, VIEW_OPTIONS_STORAGE_KEY } from './viewOptions.js';

describe('the sub-agents view option', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('is off by default', () => {
    expect(DEFAULT_VIEW_OPTIONS.subagents.show).toBe(false);
    expect(parseViewOptions(null).subagents.show).toBe(false);
  });

  it('reads a stored true, and falls back to off for a value that is not a boolean without touching the other options', () => {
    expect(parseViewOptions(JSON.stringify({ subagents: { show: true } })).subagents.show).toBe(true);
    const wrong = parseViewOptions(JSON.stringify({ subagents: { show: 'yes' }, groups: { preview: false } }));
    expect(wrong.subagents.show).toBe(false);
    expect(wrong.groups.preview).toBe(false);
  });

  it('save returns nothing when the options are stored', () => {
    const next = { ...DEFAULT_VIEW_OPTIONS, subagents: { show: true } };
    expect(saveViewOptions(next)).toBeUndefined();
    expect(JSON.parse(window.localStorage.getItem(VIEW_OPTIONS_STORAGE_KEY) ?? '{}').subagents).toEqual({ show: true });
  });

  it('save says why and what to do when the storage refuses, never silently', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    const message = saveViewOptions(DEFAULT_VIEW_OPTIONS);
    expect(message).toMatch(/quota exceeded/);
    expect(message).toMatch(/reload/i);
  });
});
