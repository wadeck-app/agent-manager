import { describe, expect, it } from 'vitest';
import { costOf, PRICE_TABLE, PRICE_TABLE_AS_OF, priceOf, US_GEO_MULTIPLIER, WEB_SEARCH_USD, type PricedUsage } from './prices.js';

const usage = (extra: Partial<PricedUsage> = {}): PricedUsage => ({ inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreate: 0, ...extra });
const usdOf = (model: string, u: PricedUsage): number => {
  const result = costOf(model, u);
  if (result.kind !== 'known') {
    throw new Error(`expected a known cost for ${model}, got ${JSON.stringify(result)}`);
  }
  return result.usd;
};

describe('price table integrity', () => {
  it('every row has a source and an ISO asOf date (fails loudly when one is missing)', () => {
    for (const row of PRICE_TABLE) {
      expect(row.source.trim(), `${row.name} has no source`).not.toBe('');
      expect(row.asOf, `${row.name} has no valid asOf`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.ids.length, `${row.name} has no model id`).toBeGreaterThan(0);
    }
    expect(PRICE_TABLE_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('no id is claimed by two rows', () => {
    const ids = PRICE_TABLE.flatMap((row) => row.ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every rate is positive and the cache writes are 1.25x and 2x the input', () => {
    for (const row of PRICE_TABLE) {
      for (const rates of [row.rates, row.fast, row.longPrompt?.rates]) {
        if (rates === undefined) {
          continue;
        }
        expect(Object.values(rates).every((value) => value > 0), row.name).toBe(true);
        expect(rates.cacheWrite5m).toBeCloseTo(rates.input * 1.25, 9);
        expect(rates.cacheWrite1h).toBeCloseTo(rates.input * 2, 9);
      }
    }
  });

  // Typed from the table of https://platform.claude.com/docs/en/about-claude/pricing (read 2026-11-27), independent of the code above.
  it.each([
    ['claude-fable-5-2', 8, 10, 16, 0.2, 40],
    ['claude-fable-5-1', 10, 12.5, 20, 0.25, 50],
    ['claude-fable-5', 10, 12.5, 20, 1, 50],
    ['claude-opus-5-5', 4, 5, 8, 0.2, 20],
    ['claude-opus-5', 5, 6.25, 10, 0.5, 25],
    ['claude-opus-4-8', 5, 6.25, 10, 0.5, 25],
    ['claude-opus-4-1', 15, 18.75, 30, 1.5, 75],
    ['claude-sonnet-5-5', 2, 2.5, 4, 0.1, 10],
    ['claude-sonnet-5', 2, 2.5, 4, 0.2, 10],
    ['claude-sonnet-4-6', 3, 3.75, 6, 0.3, 15],
    ['claude-haiku-5-5', 0.1, 0.125, 0.2, 0.01, 0.5],
    ['claude-haiku-4-5', 1, 1.25, 2, 0.1, 5],
  ])('%s matches the documented table', (id, input, write5m, write1h, read, output) => {
    expect(priceOf(id)?.rates).toEqual({ input, output, cacheWrite5m: write5m, cacheWrite1h: write1h, cacheRead: read });
  });
});

describe('priceOf (lookup)', () => {
  it('finds a model by its exact id', () => {
    expect(priceOf('claude-sonnet-5-5')?.name).toBe('Sonnet 5.5');
  });

  it('ignores the date, the Bedrock prefix and version, the Vertex date and the 1M tag', () => {
    expect(priceOf('claude-haiku-4-5-20251001')?.name).toBe('Haiku 4.5');
    expect(priceOf('anthropic.claude-haiku-4-5-20251001-v1:0')?.name).toBe('Haiku 4.5');
    expect(priceOf('us.anthropic.claude-opus-5-5[1m]')?.name).toBe('Opus 5.5');
    expect(priceOf('claude-sonnet-4-5@20250929')?.name).toBe('Sonnet 4.5');
  });

  it('never matches by prefix: claude-sonnet-5 is not claude-sonnet-5-5, claude-opus-4 is not claude-opus-4-9', () => {
    expect(priceOf('claude-sonnet-5')?.name).toBe('Sonnet 5');
    expect(priceOf('claude-sonnet-5-5')?.name).toBe('Sonnet 5.5');
    expect(priceOf('claude-opus-4-9')).toBeUndefined();
    expect(priceOf('claude-sonnet-5-6')).toBeUndefined();
  });

  it('is undefined for an unknown model and for the synthetic one', () => {
    expect(priceOf('claude-future-9')).toBeUndefined();
    expect(priceOf('<synthetic>')).toBeUndefined();
  });
});

describe('costOf', () => {
  it('has no cost without usage', () => {
    expect(costOf('claude-sonnet-5-5', undefined)).toEqual({ kind: 'no-usage' });
  });

  it('says why a model has no price and never borrows another one', () => {
    const result = costOf('claude-future-9', usage({ inputTokens: 1000 }));
    expect(result).toEqual({ kind: 'unknown-model', model: 'claude-future-9', reason: expect.stringContaining('claude-future-9') });
    expect(costOf(undefined, usage({ inputTokens: 1 })).kind).toBe('unknown-model');
  });

  it('prices each token class on its own (Sonnet 5.5: 2 / 10 / read 0.1 / write 2.5 and 4)', () => {
    expect(usdOf('claude-sonnet-5-5', usage({ inputTokens: 1_000_000 }))).toBeCloseTo(2, 9);
    expect(usdOf('claude-sonnet-5-5', usage({ outputTokens: 1_000_000 }))).toBeCloseTo(10, 9);
    expect(usdOf('claude-sonnet-5-5', usage({ cacheRead: 1_000_000 }))).toBeCloseTo(0.1, 9);
    // No 1h split: all the cache write is 5 minutes.
    expect(usdOf('claude-sonnet-5-5', usage({ cacheCreate: 1_000_000 }))).toBeCloseTo(2.5, 9);
    expect(usdOf('claude-sonnet-5-5', usage({ cacheCreate: 1_000_000, cacheCreate1h: 1_000_000 }))).toBeCloseTo(4, 9);
  });

  it('splits the cache write between 1h and 5m, and clamps a 1h share larger than the write', () => {
    expect(usdOf('claude-sonnet-5-5', usage({ cacheCreate: 1_000_000, cacheCreate1h: 400_000 }))).toBeCloseTo(0.4 * 4 + 0.6 * 2.5, 9);
    expect(usdOf('claude-sonnet-5-5', usage({ cacheCreate: 100, cacheCreate1h: 5_000_000 }))).toBeCloseTo((100 / 1e6) * 4, 12);
  });

  it('adds the classes of one message (Opus 5.5)', () => {
    const total = usdOf('claude-opus-5-5', usage({ inputTokens: 1000, outputTokens: 2000, cacheRead: 30_000, cacheCreate: 4000, cacheCreate1h: 1000 }));
    expect(total).toBeCloseTo((1000 * 4 + 2000 * 20 + 30_000 * 0.2 + 3000 * 5 + 1000 * 8) / 1e6, 12);
  });

  it('charges Haiku 5.5 the long-prompt rates when the prompt is over 100k tokens, on the prompt of that message only', () => {
    expect(usdOf('claude-haiku-5-5', usage({ inputTokens: 100_000, outputTokens: 1_000_000 }))).toBeCloseTo(0.01 + 0.5, 9);
    expect(usdOf('claude-haiku-5-5', usage({ inputTokens: 1, cacheRead: 100_000, outputTokens: 1_000_000 }))).toBeCloseTo(0.5 * (1 / 1e6) + 0.05 * 0.1 + 2.5, 9);
  });

  it('prices a fast message with the fast rates, and refuses one the table has no fast price for', () => {
    expect(usdOf('claude-opus-5-5', usage({ outputTokens: 1_000_000, speed: 'fast' }))).toBeCloseTo(40, 9);
    const refused = costOf('claude-sonnet-5-5', usage({ outputTokens: 1000, speed: 'fast' }));
    expect(refused).toMatchObject({ kind: 'unknown-model', reason: expect.stringContaining('fast') });
    expect(costOf('claude-sonnet-5-5', usage({ outputTokens: 1000, speed: 'turbo' }))).toMatchObject({ kind: 'unknown-model', reason: expect.stringContaining('turbo') });
  });

  it('applies the us inference geo to tokens only, and adds web searches', () => {
    const base = usdOf('claude-sonnet-5-5', usage({ outputTokens: 1_000_000 }));
    expect(usdOf('claude-sonnet-5-5', usage({ outputTokens: 1_000_000, inferenceGeo: 'us' }))).toBeCloseTo(base * US_GEO_MULTIPLIER, 9);
    expect(usdOf('claude-sonnet-5-5', usage({ outputTokens: 1_000_000, inferenceGeo: '' }))).toBeCloseTo(base, 9);
    expect(usdOf('claude-sonnet-5-5', usage({ webSearches: 3, inferenceGeo: 'us' }))).toBeCloseTo(3 * WEB_SEARCH_USD, 9);
  });
});
