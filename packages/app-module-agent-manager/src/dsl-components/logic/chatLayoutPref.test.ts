import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAT_LAYOUT_IDS, CHAT_LAYOUT_STORAGE_KEY, DEFAULT_CHAT_LAYOUT, isChatLayout, parseChatLayout, readChatLayout, saveChatLayout } from './chatLayoutPref.js';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('the chat layout setting', () => {
  it('four choices, the rule is the default, the four that were dropped are not valid any more', () => {
    expect([...CHAT_LAYOUT_IDS]).toEqual(['rule', 'bubbles', 'claude-ai', 'terminal']);
    expect(DEFAULT_CHAT_LAYOUT).toBe('rule');
    for (const dropped of ['slack', 'card', 'irc', 'doc']) {
      expect(isChatLayout(dropped)).toBe(false);
    }
  });

  it('nothing stored is the default and not a problem (a user of the old dock gets the rule without an error)', () => {
    expect(readChatLayout()).toEqual({ layout: 'rule', problem: '' });
    // The old dock key is simply not read.
    window.localStorage.setItem('ab.ui-chat-layout', 'slack');
    expect(readChatLayout()).toEqual({ layout: 'rule', problem: '' });
  });

  it('a saved choice is read back', () => {
    expect(saveChatLayout('terminal')).toBeUndefined();
    expect(window.localStorage.getItem(CHAT_LAYOUT_STORAGE_KEY)).toBe('terminal');
    expect(readChatLayout()).toEqual({ layout: 'terminal', problem: '' });
  });

  it('a stored value that is not a choice gives the default AND a sentence that names the key, the value and the fix', () => {
    const parsed = parseChatLayout('slack');
    expect(parsed.layout).toBe('rule');
    expect(parsed.problem).toContain(CHAT_LAYOUT_STORAGE_KEY);
    expect(parsed.problem).toContain('"slack"');
    expect(parsed.problem).toContain('rule, bubbles, claude-ai, terminal');
    expect(parsed.problem).toContain('Pick a layout');
  });

  it('a storage that cannot be read is said, never "nothing saved"', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const read = readChatLayout();
    expect(read.layout).toBe('rule');
    expect(read.problem).toContain('denied');
  });

  it('a storage that refuses the save returns a sentence with the fix', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(saveChatLayout('bubbles')).toContain('quota');
  });
});
