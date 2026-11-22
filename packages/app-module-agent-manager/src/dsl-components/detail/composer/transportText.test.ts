import { describe, expect, it } from 'vitest';
import { firstCommand, shortText, SHORT_MAX } from './transportText.js';

describe('shortText', () => {
  it('keeps the cause and drops the detail after ":", ";", a parenthesis or a sentence end', () => {
    expect(shortText('the agent-manager daemon cannot be asked: connect ECONNREFUSED 127.0.0.1:47930')).toBe('the agent-manager daemon cannot be asked');
    expect(shortText('the daemon owns this session (idle) and writes into its stdin')).toBe('the daemon owns this session');
    expect(shortText('a dialog is open in its terminal. answer it there')).toBe('a dialog is open in its terminal');
  });

  it('never returns more than the limit, with an ellipsis when it had to cut', () => {
    const long = 'x'.repeat(200);
    const short = shortText(long);
    expect(short.length).toBe(SHORT_MAX);
    expect(short.endsWith('...')).toBe(true);
    expect(shortText('short')).toBe('short');
  });

  it('a text that starts with a separator is not emptied', () => {
    expect(shortText(': oops')).toBe(': oops');
  });
});

describe('firstCommand', () => {
  it('finds the command between backticks', () => {
    expect(firstCommand('start the session with `hc run --bg claude` (a terminal), or select socket')).toBe('hc run --bg claude');
  });
  it('is undefined for a fix without a command', () => {
    expect(firstCommand('answer it there first')).toBeUndefined();
  });
});
