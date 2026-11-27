import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearSubagentUsageCache, subagentUsageOf, subagentUsageStats } from './subagentUsage.js';

// The shape of a real sub-agent transcript (research/subagent-usage-in-transcripts.md): sidechain lines carrying `agentId`, the usage of a message in message.usage.
const AGENT = 'a1b2c3';
const line = (id: string, usage: Record<string, number>, model = 'claude-sonnet-4-6', agentId = AGENT): string =>
  `${JSON.stringify({ isSidechain: true, agentId, type: 'assistant', uuid: `u-${id}-${JSON.stringify(usage)}`, timestamp: '2026-11-26T10:00:00.000Z', message: { id, model, role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage } })}\n`;
const usage = (input: number, create: number, read: number, output: number) => ({ input_tokens: input, cache_creation_input_tokens: create, cache_read_input_tokens: read, output_tokens: output });

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'am-subusage-'));
  path = join(dir, `agent-${AGENT}.jsonl`);
  clearSubagentUsageCache();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const read = () => subagentUsageOf({ agentId: AGENT, transcriptPath: path });

describe('subagentUsageOf', () => {
  it('gives the model, the tokens of the last call and the context share with the formulas of the session header', async () => {
    writeFileSync(path, line('m1', usage(3, 1000, 4000, 50)) + line('m2', usage(5, 0, 100_000, 200)));
    const answer = await read();
    expect(answer.note).toBeUndefined();
    expect(answer.usage).toMatchObject({ model: { id: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6' }, tokensIn: 100_005, tokensOut: 200 });
    // 100 005 of the assumed auto-compact point (200k window - 33k): 60 %
    expect(answer.usage?.contextUsedPct).toMatchObject({ value: 60, usedTokens: 100_005, windowTokens: 200_000, compactAtTokens: 167_000, basis: 'estimate' });
  });

  it('ignores the lines of another agent and the synthetic messages', async () => {
    writeFileSync(path, line('m1', usage(1, 0, 10, 5)) + line('x', usage(9, 9, 9, 9), 'claude-opus-4-6', 'other') + line('s', usage(0, 0, 0, 0), '<synthetic>'));
    expect((await read()).usage).toMatchObject({ tokensIn: 11, tokensOut: 5, model: { displayName: 'Sonnet 4.6' } });
  });

  it('reads only what was appended since the last call, and nothing when the file did not change', async () => {
    writeFileSync(path, line('m1', usage(1, 0, 10, 5)));
    await read();
    const first = subagentUsageStats().bytesRead;
    expect(first).toBeGreaterThan(0);
    await read();
    expect(subagentUsageStats().bytesRead).toBe(first);
    const added = line('m2', usage(2, 0, 20, 7));
    appendFileSync(path, added);
    const answer = await read();
    expect(subagentUsageStats().bytesRead).toBe(first + Buffer.byteLength(added));
    expect(answer.usage).toMatchObject({ tokensIn: 22, tokensOut: 7 });
  });

  it('starts again when the file was replaced by a shorter one', async () => {
    writeFileSync(path, line('m1', usage(1, 0, 10, 5)) + line('m2', usage(2, 0, 20, 7)));
    await read();
    writeFileSync(path, line('n1', usage(4, 0, 6, 1)));
    expect((await read()).usage).toMatchObject({ tokensIn: 10, tokensOut: 1 });
  });

  it('says why when there is nothing to show: no transcript yet, no usage line yet, unreadable', async () => {
    expect((await read()).note).toMatch(/no transcript yet/i);
    writeFileSync(path, `${JSON.stringify({ isSidechain: true, agentId: AGENT, type: 'user', uuid: 'u', timestamp: '2026-11-26T10:00:00.000Z', message: { role: 'user', content: 'hi' } })}\n`);
    expect((await read()).note).toMatch(/no assistant message with usage/i);
    expect(await subagentUsageOf({ agentId: AGENT, transcriptPath: path, readError: 'EACCES: denied' })).toEqual({ note: expect.stringContaining('EACCES: denied') });
  });

  it('estimates the cost per message with the price table, once per message id even when its lines repeat', async () => {
    // Sonnet 4.6: $3 input, $15 output, $0.30 cache read, $3.75 cache write (5m) per million tokens. m1 is written twice (streaming): counted once, largest counts.
    writeFileSync(path, line('m1', usage(1_000_000, 0, 0, 1000)) + line('m1', usage(1_000_000, 0, 0, 2_000_000)) + line('m2', usage(0, 1_000_000, 1_000_000, 0)));
    const { usage: answer } = await read();
    expect(answer?.cost).toMatchObject({ pricedMessages: 2, unpriced: [] });
    expect(answer?.cost?.usd).toBeCloseTo(3 + 30 + 3.75 + 0.3, 9);
    expect(answer?.cost?.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('names a model without a price instead of pricing it, and still prices the others', async () => {
    writeFileSync(path, line('m1', usage(1_000_000, 0, 0, 0)) + line('m2', usage(1_000_000, 0, 0, 0), 'claude-future-9'));
    const { usage: answer } = await read();
    expect(answer?.cost?.usd).toBeCloseTo(3, 9);
    expect(answer?.cost).toMatchObject({ pricedMessages: 1, unpriced: [{ model: 'claude-future-9', messages: 1 }] });
  });

  it('keeps the cost across incremental reads (new bytes only) and gives the main transcript the same reader (no agent id)', async () => {
    writeFileSync(path, line('m1', usage(1_000_000, 0, 0, 0)));
    expect((await read()).usage?.cost?.usd).toBeCloseTo(3, 9);
    appendFileSync(path, line('m2', usage(1_000_000, 0, 0, 0)));
    expect((await read()).usage?.cost?.usd).toBeCloseTo(6, 9);
    // The main session: lines without agentId count, the lines of a sub-agent do not.
    const main = join(dir, 'main.jsonl');
    const mainLine = JSON.stringify({ type: 'assistant', uuid: 'mu1', timestamp: '2026-11-26T10:00:00.000Z', message: { id: 'mm1', model: 'claude-sonnet-4-6', role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: usage(2_000_000, 0, 0, 0) } });
    writeFileSync(main, `${mainLine}
${line('x1', usage(9_000_000, 0, 0, 0))}`);
    expect((await subagentUsageOf({ transcriptPath: main })).usage?.cost?.usd).toBeCloseTo(6, 9);
  });

  it('keeps the cache bounded', async () => {
    writeFileSync(path, line('m1', usage(1, 0, 10, 5)));
    for (let i = 0; i < 5; i += 1) {
      await subagentUsageOf({ agentId: `a${i}`, transcriptPath: path }, 3);
    }
    expect(subagentUsageStats().entries).toBeLessThanOrEqual(3);
  });
});
