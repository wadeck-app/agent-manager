import { parseModelId } from './models.js';

/**
 * Price table of the models seen in Claude Code transcripts, and the cost of one assistant message. An ESTIMATE of what the Anthropic API would list for those
 * tokens, not a bill (Bedrock, Vertex and negotiated rates differ). Sources and how they were read: research/session-cost.md.
 *
 * Every row says where its numbers come from (`source`) and the day they were read (`asOf`); a test fails when one does not. A model that is not in the table
 * has NO price: `costOf` says so (`unknown-model`), it never falls back to another model's rates.
 */

/** USD per million tokens. */
export type Rates = {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
};

export type ModelPrice = {
  /** Display name of the row. */
  name: string;
  /** Canonical ids (see parseModelId: no provider, region, date, version or [1m] tag) the row applies to. Exact match, never a prefix. */
  ids: readonly string[];
  rates: Rates;
  /** Higher rates for a request whose prompt (input + cache read + cache write) is over `abovePromptTokens` (Haiku 5.5 only). */
  longPrompt?: { abovePromptTokens: number; rates: Rates };
  /** Rates of `speed: "fast"`; a model without them has no price for a fast message. */
  fast?: Rates;
  /** Where the numbers were read. */
  source: string;
  /** ISO day the source was read. */
  asOf: string;
};

/** The usage of ONE assistant message (counted once per message id). */
export type PricedUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheCreate: number;
  /** Part of `cacheCreate` with the 1 hour TTL; the rest is priced as 5 minutes. */
  cacheCreate1h?: number;
  webSearches?: number;
  /** `usage.speed` as written ('standard', 'fast'). Absent: standard (older transcripts do not write it). */
  speed?: string;
  /** `usage.inference_geo` as written ('' or 'global': standard, 'us': +10 %). */
  inferenceGeo?: string;
};

export type CostResult = { kind: 'known'; usd: number } | { kind: 'unknown-model'; model: string; reason: string } | { kind: 'no-usage' };

/** One web search request, USD (docs: $10 per 1,000 searches; the Claude Code catalog says 0.01 too). */
export const WEB_SEARCH_USD = 0.01;
/** Multiplier of `inference_geo: "us"` on every token price (docs, "Data residency pricing"; the Claude Code binary applies 1.1 too). */
export const US_GEO_MULTIPLIER = 1.1;

const DOCS = 'https://platform.claude.com/docs/en/about-claude/pricing (model pricing table) and the model catalog baked in Claude Code 2.1.331 (claude.exe, `pricing_tiers`), identical';
const AS_OF = '2026-11-27';

/** Cache writes are 1.25x (5 minutes) and 2x (1 hour) the input price on every row of the table; the read price is given by the table. */
const rates = (input: number, output: number, cacheRead: number): Rates => ({ input, output, cacheWrite5m: input * 1.25, cacheWrite1h: input * 2, cacheRead });

const price = (name: string, ids: string[], base: Rates, extra: Pick<ModelPrice, 'longPrompt' | 'fast'> = {}): ModelPrice => ({ name, ids, rates: base, ...extra, source: DOCS, asOf: AS_OF });

export const PRICE_TABLE: readonly ModelPrice[] = [
  price('Fable 5.2', ['claude-fable-5-2'], rates(8, 40, 0.2), { fast: rates(16, 80, 0.4) }),
  price('Mythos 5.2', ['claude-mythos-5-2'], rates(8, 40, 0.2), { fast: rates(16, 80, 0.4) }),
  price('Fable 5.1', ['claude-fable-5-1'], rates(10, 50, 0.25)),
  price('Mythos 5.1', ['claude-mythos-5-1'], rates(10, 50, 0.25)),
  price('Fable 5', ['claude-fable-5'], rates(10, 50, 1)),
  price('Mythos 5', ['claude-mythos-5'], rates(10, 50, 1)),
  price('Opus 5.5', ['claude-opus-5-5'], rates(4, 20, 0.2), { fast: rates(8, 40, 0.4) }),
  price('Opus 5', ['claude-opus-5'], rates(5, 25, 0.5), { fast: rates(10, 50, 1) }),
  price('Opus 4.8', ['claude-opus-4-8'], rates(5, 25, 0.5), { fast: rates(10, 50, 1) }),
  price('Opus 4.7', ['claude-opus-4-7'], rates(5, 25, 0.5)),
  price('Opus 4.6', ['claude-opus-4-6'], rates(5, 25, 0.5)),
  price('Opus 4.5', ['claude-opus-4-5'], rates(5, 25, 0.5)),
  price('Opus 4.1', ['claude-opus-4-1'], rates(15, 75, 1.5)),
  price('Opus 4', ['claude-opus-4'], rates(15, 75, 1.5)),
  price('Sonnet 5.5', ['claude-sonnet-5-5'], rates(2, 10, 0.1)),
  price('Sonnet 5', ['claude-sonnet-5'], rates(2, 10, 0.2)),
  price('Sonnet 4.6', ['claude-sonnet-4-6'], rates(3, 15, 0.3)),
  price('Sonnet 4.5', ['claude-sonnet-4-5'], rates(3, 15, 0.3)),
  price('Sonnet 4', ['claude-sonnet-4'], rates(3, 15, 0.3)),
  price('Haiku 5.5', ['claude-haiku-5-5'], rates(0.1, 0.5, 0.01), { longPrompt: { abovePromptTokens: 100_000, rates: rates(0.5, 2.5, 0.05) } }),
  price('Haiku 4.5', ['claude-haiku-4-5'], rates(1, 5, 0.1)),
];

/** The day of the oldest row: what the UI says the estimate rests on. */
export const PRICE_TABLE_AS_OF: string = PRICE_TABLE.map((row) => row.asOf).sort()[0]!;

const BY_ID: ReadonlyMap<string, ModelPrice> = new Map(PRICE_TABLE.flatMap((row) => row.ids.map((id): [string, ModelPrice] => [id, row])));

/** The row of a model id as written in a transcript (`anthropic.claude-haiku-4-5-20251001-v1:0`, `claude-opus-5-5[1m]`, ...); undefined when it has no price. */
export function priceOf(modelId: string): ModelPrice | undefined {
  return BY_ID.get(parseModelId(modelId).canonical);
}

const per = (tokens: number, usdPerMillion: number): number => (tokens / 1_000_000) * usdPerMillion;

/**
 * The cost of one assistant message, like Claude Code computes /cost (same formula, read in its binary): input, output, cache read, cache writes split 5m / 1h,
 * the long-prompt tier of Haiku 5.5 (per message), +10 % for `inference_geo: "us"`, plus web searches. A message of an unpriced model, or of a mode the table has
 * no price for (a `fast` message of a model without fast rates, a speed this code does not know), is `unknown-model` with the reason: never another model's price.
 */
export function costOf(model: string | undefined, usage: PricedUsage | undefined): CostResult {
  if (usage === undefined) {
    return { kind: 'no-usage' };
  }
  const id = model ?? '';
  const row = id === '' ? undefined : priceOf(id);
  if (row === undefined) {
    return { kind: 'unknown-model', model: id, reason: id === '' ? 'the message names no model' : `no price for ${id} in the table dated ${PRICE_TABLE_AS_OF}` };
  }
  const speed = usage.speed ?? 'standard';
  if (speed !== 'standard' && speed !== 'fast') {
    return { kind: 'unknown-model', model: id, reason: `no price for speed "${speed}" of ${row.name}` };
  }
  let table: Rates = row.rates;
  if (speed === 'fast') {
    if (row.fast === undefined) {
      return { kind: 'unknown-model', model: id, reason: `no fast-mode price for ${row.name}` };
    }
    table = row.fast;
  }
  const prompt = usage.inputTokens + usage.cacheRead + usage.cacheCreate;
  if (row.longPrompt !== undefined && prompt > row.longPrompt.abovePromptTokens) {
    table = row.longPrompt.rates;
  }
  const oneHour = Math.min(Math.max(usage.cacheCreate1h ?? 0, 0), usage.cacheCreate);
  const fiveMinutes = usage.cacheCreate - oneHour;
  const tokens = per(usage.inputTokens, table.input) + per(usage.outputTokens, table.output) + per(usage.cacheRead, table.cacheRead) + per(fiveMinutes, table.cacheWrite5m) + per(oneHour, table.cacheWrite1h);
  const geo = usage.inferenceGeo === 'us' ? US_GEO_MULTIPLIER : 1;
  return { kind: 'known', usd: tokens * geo + (usage.webSearches ?? 0) * WEB_SEARCH_USD };
}
