import { describe, expect, it } from 'vitest';
import { modelModeSummary } from './modelMode.js';

describe('the closed summary of the Model and mode options', () => {
  it('says the options follow the session when they are known, Claude Code default when not, and that the user changed them', () => {
    expect(modelModeSummary({ known: true, changed: false })).toBe('Model and mode: same as the session');
    expect(modelModeSummary({ known: false, changed: false })).toBe('Model and mode: Claude Code default');
    expect(modelModeSummary({ known: true, changed: true })).toBe('Model and mode: changed');
    expect(modelModeSummary({ known: false, changed: true })).toBe('Model and mode: changed');
  });
});
