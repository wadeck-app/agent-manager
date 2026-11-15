import { describe, expect, it } from 'vitest';
import { contextWindowOf, describeModel, describeModelName, MODEL_TABLE, parseModelId, sameModel } from './models.js';

// Every id spelling below was observed on real transcripts (research/statusline-data-in-transcripts.md).
describe('parseModelId', () => {
  it.each([
    ['claude-sonnet-5-5', 'claude-sonnet-5-5', undefined],
    ['us.anthropic.claude-sonnet-5-5', 'claude-sonnet-5-5', undefined],
    ['us.anthropic.claude-opus-5-5[1m]', 'claude-opus-5-5', '1m'],
    ['claude-haiku-4-5-20251001', 'claude-haiku-4-5', undefined],
    ['anthropic.claude-haiku-4-5-20251001-v1:0', 'claude-haiku-4-5', undefined],
    ['us.anthropic.claude-haiku-4-5-20251001-v1:0', 'claude-haiku-4-5', undefined],
    ['us.anthropic.claude-sonnet-4-20250514-v1:0', 'claude-sonnet-4', undefined],
    ['claude-sonnet-4-6[1m]', 'claude-sonnet-4-6', '1m'],
    ['claude-3-5-haiku@20241022', 'claude-3-5-haiku', undefined],
  ])('%s', (raw, canonical, tag) => {
    expect(parseModelId(raw)).toEqual(tag === undefined ? { canonical } : { canonical, tag });
  });

  it('compares models without the region, the date and the tag', () => {
    expect(sameModel('claude-sonnet-5', 'us.anthropic.claude-sonnet-5')).toBe(true);
    expect(sameModel('claude-sonnet-5', 'claude-sonnet-5-5')).toBe(false);
    expect(sameModel('claude-opus-5-5', 'us.anthropic.claude-opus-5-5[1m]')).toBe(true);
  });
});

describe('describeModel', () => {
  it('every row of the table gives its name for every spelling of its id', () => {
    for (const row of MODEL_TABLE) {
      expect(describeModel(row.canonical)).toEqual({ id: row.canonical, displayName: row.name, known: true });
      expect(describeModel(`us.anthropic.${row.canonical}`).displayName).toBe(row.name);
    }
  });

  it('the name Claude Code wrote wins, and a [1m] id without it gets the 1M suffix', () => {
    expect(describeModel('us.anthropic.claude-opus-5-5[1m]', 'Opus 5.5 (1M context)')).toEqual({ id: 'us.anthropic.claude-opus-5-5[1m]', displayName: 'Opus 5.5 (1M context)', known: true });
    expect(describeModel('claude-opus-5-5[1m]').displayName).toBe('Opus 5.5 (1M context)');
  });

  it('an id that is not in the table is shown raw with known: false (an alias, a future model)', () => {
    expect(describeModel('claude-sonnet-9-9')).toEqual({ id: 'claude-sonnet-9-9', displayName: 'claude-sonnet-9-9', known: false });
    expect(describeModel('haiku')).toEqual({ id: 'haiku', displayName: 'haiku', known: false });
    // A name from Claude Code for a model the table does not know is kept, still flagged.
    expect(describeModel('claude-sonnet-9-9', 'Sonnet 9.9')).toEqual({ id: 'claude-sonnet-9-9', displayName: 'Sonnet 9.9', known: false });
  });

  it('a model known by name only (the /model stdout)', () => {
    expect(describeModelName('Haiku 5.5')).toEqual({ displayName: 'Haiku 5.5', known: true });
    expect(describeModelName('Opus 5 (1M context)')).toEqual({ displayName: 'Opus 5 (1M context)', known: true });
    expect(describeModelName('Mystery 1')).toEqual({ displayName: 'Mystery 1', known: false });
  });
});

describe('contextWindowOf', () => {
  it('the [1m] tag and the "(1M context)" name mean 1M', () => {
    expect(contextWindowOf({ id: 'us.anthropic.claude-opus-5-5[1m]' }, 10)).toMatchObject({ tokens: 1_000_000, source: 'id-tag' });
    expect(contextWindowOf({ id: 'claude-opus-5-5', displayName: 'Opus 5.5 (1M context)' }, 10)).toMatchObject({ tokens: 1_000_000, source: 'marketing-name' });
  });

  it('a model proven above 200k without the tag (Sonnet 5.5) is 1M, the others default to 200k', () => {
    expect(contextWindowOf({ id: 'claude-sonnet-5-5' }, 10)).toMatchObject({ tokens: 1_000_000, source: 'table-proven' });
    expect(contextWindowOf({ id: 'claude-haiku-4-5-20251001' }, 10)).toMatchObject({ tokens: 200_000, source: 'default' });
    expect(contextWindowOf(undefined, undefined)).toMatchObject({ tokens: 200_000, source: 'default' });
  });

  it('a context above 200k cannot be a 200k window: 1M, with the reason', () => {
    const window = contextWindowOf({ id: 'claude-opus-4-8' }, 300_000);
    expect(window).toMatchObject({ tokens: 1_000_000, source: 'observed-over-default' });
    expect(window.note).toContain('300000');
  });
});
