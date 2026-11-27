import { describe, expect, it } from 'vitest';
import { prose } from './prose.js';

describe('prose: a daemon text as a sentence', () => {
  it('turns backticks into double quotes, so no raw backtick is shown', () => {
    expect(prose('A sub-agent call is running (Agent `Write the migration`)')).toBe('A sub-agent call is running (Agent "Write the migration")');
    expect(prose('Tool Bash `npm run build:all` is running')).not.toContain('`');
  });

  it('starts every sentence with a capital: the text and what follows a full stop', () => {
    expect(prose('the claude process ended. resume the session; the conversation continues')).toBe('The claude process ended. Resume the session; the conversation continues');
  });

  it('leaves a file name, a command or a path at the start of a sentence as it is', () => {
    expect(prose('agents-user-state.json is not valid JSON. Fix or delete it.')).toBe('agents-user-state.json is not valid JSON. Fix or delete it.');
    expect(prose('agent-manager start --detach')).toBe('agent-manager start --detach');
    expect(prose('broken-1.json (the name is not <pid>.json). open the file')).toBe('broken-1.json (the name is not <pid>.json). Open the file');
  });

  it('keeps a text that is already a sentence', () => {
    expect(prose('Daemon not running: agent-manager start --detach')).toBe('Daemon not running: agent-manager start --detach');
  });
});
