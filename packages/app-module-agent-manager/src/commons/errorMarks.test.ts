import { describe, expect, it } from 'vitest';
import { MARKED_ERROR_CODES, markMessage, unmarkMessage } from './errorMarks.js';

/*
 * The shell fetcher of app-core throws only the text of an error body, so a sensitive route cannot send its machine code to the page. The few codes the page
 * must act on (not "show the text": ask the user to confirm) travel as a prefix of that text, "[code] ", and are taken off again before the user reads it.
 */

describe('error marks', () => {
  it('marks only the codes the page acts on, and leaves every other message as it was', () => {
    expect(MARKED_ERROR_CODES).toEqual(['switch-not-ready', 'switch-draft']);
    expect(markMessage('switch-not-ready', 'The session is not free')).toBe('[switch-not-ready] The session is not free');
    expect(markMessage('invalid-id', 'not an id')).toBe('not an id');
    expect(markMessage(undefined, 'plain')).toBe('plain');
  });

  it('takes the mark off and says which code it was', () => {
    expect(unmarkMessage('[switch-not-ready] The session is not free')).toEqual({ text: 'The session is not free', code: 'switch-not-ready' });
  });

  it('a text without a known mark is returned as it is (a "[x]" in a message of another route is not a code)', () => {
    expect(unmarkMessage('The session is not free')).toEqual({ text: 'The session is not free' });
    expect(unmarkMessage('[something-else] text')).toEqual({ text: '[something-else] text' });
  });
});
