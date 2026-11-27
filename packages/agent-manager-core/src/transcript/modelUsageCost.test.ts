import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ModelUsageAccumulator } from './modelUsage.js';
import { TranscriptTailer } from './tailer.js';
import { assistantLine, jsonl, makeTempDir, removeDir, textBlock, withModel, writeText } from './testFixtures.js';
import type { Entry } from './types.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    removeDir(dir);
  }
});

type Line = ReturnType<typeof assistantLine>;

async function read(lines: Line[]): Promise<Entry[]> {
  const dir = makeTempDir();
  dirs.push(dir);
  const path = join(dir, 't.jsonl');
  writeText(path, jsonl(lines));
  return (await new TranscriptTailer().readNew(path)).entries;
}

const message = (seconds: number, id: string, model: string, usage: { input?: number; output?: number; cacheRead?: number; cacheCreate?: number }, block = 0): Line => withModel(assistantLine(seconds, id, block, textBlock('a'), usage), model);

describe('cost of the accumulator', () => {
  it('counts a streamed message once, with the largest counts (no double counting of its lines)', async () => {
    const lines = [
      message(1, 'm1', 'claude-sonnet-5-5', { input: 0, cacheRead: 0, cacheCreate: 0, output: 100_000 }, 0),
      message(2, 'm1', 'claude-sonnet-5-5', { input: 0, cacheRead: 0, cacheCreate: 0, output: 500_000 }, 1),
      message(3, 'm1', 'claude-sonnet-5-5', { input: 0, cacheRead: 0, cacheCreate: 0, output: 1_000_000 }, 2),
    ];
    const accumulator = new ModelUsageAccumulator(true);
    accumulator.add(await read(lines));
    const { cost, messages } = accumulator.rollup();
    expect(messages).toBe(1);
    expect(cost.pricedMessages).toBe(1);
    // Sonnet 5.5: $10 per million output tokens.
    expect(cost.usd).toBeCloseTo(10, 9);
    expect(cost.unpriced).toEqual([]);
  });

  it('prices each message with the rates of its own model', async () => {
    const accumulator = new ModelUsageAccumulator(true);
    accumulator.add(
      await read([
        message(1, 'a', 'claude-sonnet-5-5', { input: 1_000_000, output: 0, cacheRead: 0, cacheCreate: 0 }),
        message(2, 'b', 'claude-opus-5-5', { input: 1_000_000, output: 0, cacheRead: 0, cacheCreate: 0 }),
      ]),
    );
    expect(accumulator.rollup().cost.usd).toBeCloseTo(2 + 4, 9);
  });

  it('keeps the cost of messages folded out of the recent window (more than 64 messages)', async () => {
    const lines = Array.from({ length: 100 }, (_, index) => message(index + 1, `m${index}`, 'claude-sonnet-5-5', { input: 1_000_000, output: 0, cacheRead: 0, cacheCreate: 0 }));
    const accumulator = new ModelUsageAccumulator(true);
    accumulator.add(await read(lines));
    const { cost, messages } = accumulator.rollup();
    expect(messages).toBe(100);
    expect(cost.pricedMessages).toBe(100);
    expect(cost.usd).toBeCloseTo(200, 6);
  });

  it('keeps an unpriced model out of the sum and names it with its message count', async () => {
    const accumulator = new ModelUsageAccumulator(true);
    accumulator.add(
      await read([
        message(1, 'a', 'claude-sonnet-5-5', { input: 1_000_000, output: 0, cacheRead: 0, cacheCreate: 0 }),
        message(2, 'b', 'claude-future-9', { input: 5_000_000 }),
        message(3, 'c', 'claude-future-9', { input: 5_000_000 }),
      ]),
    );
    const { cost } = accumulator.rollup();
    expect(cost.usd).toBeCloseTo(2, 9);
    expect(cost.pricedMessages).toBe(1);
    expect(cost.unpriced).toEqual([{ model: 'claude-future-9', messages: 2, reason: expect.stringContaining('claude-future-9') }]);
  });

  it('splits the cache writes by TTL from the usage of the line', async () => {
    const line = message(1, 'a', 'claude-sonnet-5-5', { input: 0, output: 0, cacheRead: 0, cacheCreate: 1_000_000 });
    const usage = (line.message as { usage: Record<string, unknown> }).usage;
    usage.cache_creation = { ephemeral_1h_input_tokens: 1_000_000, ephemeral_5m_input_tokens: 0 };
    const accumulator = new ModelUsageAccumulator(true);
    accumulator.add(await read([line]));
    // Sonnet 5.5: 1h cache write is $4 per million.
    expect(accumulator.rollup().cost.usd).toBeCloseTo(4, 9);
  });

  it('has a zero cost and no unpriced model for an empty session', () => {
    expect(new ModelUsageAccumulator(true).rollup().cost).toEqual({ usd: 0, pricedMessages: 0, unpriced: [] });
  });
});
