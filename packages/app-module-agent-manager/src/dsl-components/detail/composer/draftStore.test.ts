import { beforeEach, describe, expect, it } from 'vitest';
import { getDraft, resetDrafts, setDraft } from './draftStore.js';

beforeEach(() => {
  resetDrafts();
  sessionStorage.clear();
});

describe('draftStore', () => {
  it('keeps one draft per session, case-insensitive', () => {
    setDraft('AAA', { text: 'one', images: [] });
    setDraft('bbb', { text: 'two', images: [] });
    expect(getDraft('aaa').text).toBe('one');
    expect(getDraft('BBB').text).toBe('two');
  });

  it('restores the text from sessionStorage after the memory is gone, images do not survive', () => {
    setDraft('aaa', { text: 'kept', images: [{ id: '1', name: 'a.png', mime: 'image/png', bytes: 1, dataBase64: 'AA==' }] });
    resetDrafts();
    expect(getDraft('aaa')).toEqual({ text: 'kept', images: [] });
  });

  it('forgets an emptied draft', () => {
    setDraft('aaa', { text: 'x', images: [] });
    setDraft('aaa', { text: '', images: [] });
    expect(sessionStorage.getItem('agent-manager.draft.aaa')).toBeNull();
    expect(getDraft('aaa').text).toBe('');
  });
});
