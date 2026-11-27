import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SubagentUsageAnswer } from './subagentUsage.js';
import { clearSubagentUsageCache } from './subagentUsage.js';
import { sessionCostOf } from './sessionCost.js';

const cost = (usd: number, pricedMessages = 1) => ({ usd, pricedMessages, unpriced: [], asOf: '2026-11-27' });
const answer = (usd: number): SubagentUsageAnswer => ({ usage: { cost: cost(usd) } });
const mainLine = (model: string, input: number): string =>
  `${JSON.stringify({ type: 'assistant', uuid: `u-${model}`, timestamp: '2026-11-26T10:00:00.000Z', message: { id: `m-${model}`, model, role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: input, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 } } })}\n`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'am-sesscost-'));
  clearSubagentUsageCache();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('sessionCostOf', () => {
  it('gives the main session, the sum of the sub-agents and the total', async () => {
    const path = join(dir, 'main.jsonl');
    // Sonnet 5.5: $2 per million input tokens.
    writeFileSync(path, mainLine('claude-sonnet-5-5', 1_000_000));
    const result = await sessionCostOf(path, new Map([['a', answer(0.5)], ['b', answer(0.25)]]));
    expect(result.main?.usd).toBeCloseTo(2, 9);
    expect(result.subagents).toMatchObject({ agents: 2, withoutUsage: 0 });
    expect(result.subagents.usd).toBeCloseTo(0.75, 9);
    expect(result.total.usd).toBeCloseTo(2.75, 9);
  });

  it('counts a sub-agent without usage as such, not as zero dollars', async () => {
    const path = join(dir, 'main.jsonl');
    writeFileSync(path, mainLine('claude-sonnet-5-5', 1_000_000));
    const result = await sessionCostOf(path, new Map<string, SubagentUsageAnswer>([['a', answer(0.5)], ['b', { note: 'No transcript yet' }]]));
    expect(result.subagents).toMatchObject({ agents: 1, withoutUsage: 1 });
  });

  it('says why the main session has no figure and keeps the sub-agents in the total', async () => {
    const result = await sessionCostOf(join(dir, 'missing.jsonl'), new Map([['a', answer(0.5)]]));
    expect(result.main).toBeUndefined();
    expect(result.mainNote).toMatch(/no transcript yet/i);
    expect(result.total.usd).toBeCloseTo(0.5, 9);
  });

  it('carries the models without a price of the main session into the total', async () => {
    const path = join(dir, 'main.jsonl');
    writeFileSync(path, mainLine('claude-future-9', 1000));
    const result = await sessionCostOf(path, new Map());
    expect(result.main).toMatchObject({ usd: 0, pricedMessages: 0, unpriced: [{ model: 'claude-future-9' }] });
    expect(result.total.unpriced).toEqual([expect.objectContaining({ model: 'claude-future-9', messages: 1 })]);
  });
});
