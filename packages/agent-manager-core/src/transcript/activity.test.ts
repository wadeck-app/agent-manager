import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ActivityAccumulator, summarizeActivity, toolSummary } from './activity.js';
import { applyOrphanResult, mergeToolCallEntries } from './merge.js';
import { TranscriptTailer } from './tailer.js';
import { base64Bytes, boundValue, oneLine, stripAnsi, truncateText } from './text.js';
import type { Entry } from './types.js';
import {
  assistantLine,
  humanPrompt,
  injectedPrompt,
  jsonl,
  makeTempDir,
  peerPrompt,
  removeDir,
  systemLine,
  textBlock,
  toolResultLine,
  toolUseBlock,
  ts,
  writeText,
} from './testFixtures.js';

type ToolCall = Extract<Entry, { kind: 'tool-call' }>;

const dirs: string[] = [];
async function entriesOf(lines: Record<string, unknown>[]): Promise<Entry[]> {
  const dir = makeTempDir();
  dirs.push(dir);
  const path = join(dir, 's.jsonl');
  writeText(path, jsonl(lines));
  return (await new TranscriptTailer().readNew(path)).entries;
}
afterEach(() => {
  dirs.splice(0).forEach(removeDir);
});

describe('summarizeActivity', () => {
  it('summarises prompts, tools, tokens, context, turns and errors', async () => {
    const entries = await entriesOf([
      humanPrompt(1, 'first'),
      injectedPrompt(2, 'hook noise'),
      assistantLine(3, 'm1', 0, toolUseBlock('t1', 'Bash', { command: 'npm test' }), { input: 5, output: 10, cacheRead: 1000, cacheCreate: 100 }),
      assistantLine(4, 'm1', 1, toolUseBlock('t2', 'Read', { file_path: '/work/shop/a.ts' })),
      toolResultLine(6, [{ id: 't1', content: 'boom', isError: true }]),
      peerPrompt(7, 'a message from another session'),
      assistantLine(8, 'm2', 0, textBlock('ok'), { input: 6, output: 20, cacheRead: 1200, cacheCreate: 0 }),
      humanPrompt(9, 'second'),
      systemLine(10, 'api_error', { level: 'error' }),
    ]);
    const s = summarizeActivity(entries);
    expect(s.lastPromptAt).toBe(Date.parse(ts(9)));
    expect(s.lastAssistantAt).toBe(Date.parse(ts(8)));
    expect(s.runningToolCalls.map(c => c.id)).toEqual(['t2']);
    expect(s.lastToolSummary).toBe('Read: /work/shop/a.ts');
    // m1: its second line (fixture default usage 10/50/1000/100) is larger field by field than the first (5/10/1000/100): the maximum counts
    expect(s.tokensTotal).toBe(10 + 50 + 100 + 6 + 20 + 0);
    expect(s.cacheReadTotal).toBe(2200);
    expect(s.contextEstimate).toBe(6 + 1200 + 0 + 20);
    expect(s.turnsCount).toBe(3);
    expect(s.errorsCount).toBe(2);
  });

  it('follows updates of a call: a call that finished in a later read stops running', async () => {
    const dir = makeTempDir();
    dirs.push(dir);
    const path = join(dir, 's.jsonl');
    writeText(path, jsonl([assistantLine(1, 'm', 0, toolUseBlock('t1', 'Bash', { command: 'sleep 1' }))]));
    const tailer = new TranscriptTailer();
    const r1 = await tailer.readNew(path);
    writeText(path, jsonl([assistantLine(1, 'm', 0, toolUseBlock('t1', 'Bash', { command: 'sleep 1' })), toolResultLine(3, [{ id: 't1', content: 'ok' }])]));
    const r2 = await tailer.readNew(path, r1.state);
    const acc2 = new ActivityAccumulator();
    [...r1.entries, ...r2.entries].forEach(e => acc2.add(e));
    expect(acc2.summary().runningToolCalls).toEqual([]);
    expect(acc2.summary().lastToolSummary).toBe('Bash: sleep 1');
  });

  it('an orphan result completes a running call with the same fields as mergeToolCallEntries', async () => {
    const [running] = await entriesOf([assistantLine(2, 'm', 0, toolUseBlock('t1', 'Bash', { command: 'x' }))]);
    const [orphan] = await entriesOf([toolResultLine(5, [{ id: 't1', content: 'result text' }])]);
    expect(orphan).toMatchObject({ kind: 'tool-call', orphan: true });
    const acc = new ActivityAccumulator();
    acc.add(running!);
    acc.add(orphan!);
    const summary = acc.summary();
    expect(summary.runningToolCalls).toEqual([]);
    const [fromMerge] = mergeToolCallEntries([running!, orphan!]);
    expect(fromMerge).toMatchObject({ status: 'ok', finishedAt: Date.parse(ts(5)), durationMs: 3000, resultPreview: 'result text', resultBytes: 11 });
    expect(summary.lastToolSummary).toBe('Bash: x');
    // the accumulator and the merge share one function
    expect(applyOrphanResult(running as ToolCall, orphan as ToolCall)).toEqual(fromMerge);
    // a call that already has its result is not changed by a late orphan
    const done = applyOrphanResult(running as ToolCall, orphan as ToolCall);
    expect(applyOrphanResult(done, { ...(orphan as ToolCall), resultPreview: 'other' })).toBe(done);
  });

  it('counts a message once and replaces its usage when a later entry with the same key raises it', () => {
    const base = { kind: 'usage' as const, key: '1.0', offset: 1, messageId: 'm', inputTokens: 3, outputTokens: 2, cacheRead: 100, cacheCreate: 10, contextEstimate: 115 };
    const acc = new ActivityAccumulator();
    acc.add(base);
    acc.add({ ...base, outputTokens: 40, contextEstimate: 153 });
    const s = acc.summary();
    expect(s.tokensTotal).toBe(3 + 40 + 10);
    expect(s.cacheReadTotal).toBe(100);
    expect(s.contextEstimate).toBe(153);
  });

  it('is empty-safe', () => {
    expect(summarizeActivity([])).toEqual({ runningToolCalls: [], tokensTotal: 0, cacheReadTotal: 0, contextEstimate: 0, turnsCount: 0, errorsCount: 0 });
    expect(toolSummary({ name: 'TodoWrite', inputSummary: '' })).toBe('TodoWrite');
  });
});

describe('mergeToolCallEntries', () => {
  it('keeps the order, folds updates of one call and leaves other entries and the input untouched', async () => {
    const [prompt, running] = await entriesOf([humanPrompt(1, 'go'), assistantLine(2, 'm', 0, toolUseBlock('t1', 'Bash', { command: 'x' }))]);
    const done = { ...(running as Extract<Entry, { kind: 'tool-call' }>), status: 'ok' as const };
    const merged = mergeToolCallEntries([prompt!, running!, done]);
    expect(merged.map(e => e.kind)).toEqual(['user-prompt', 'tool-call']);
    expect(merged[1]).toMatchObject({ status: 'ok' });
    expect((running as Extract<Entry, { kind: 'tool-call' }>).status).toBe('running');
  });
});

describe('text helpers', () => {
  it('strips CSI, OSC and lone escapes', () => {
    expect(stripAnsi('\u001b[1;31mred\u001b[0m \u001b]8;;http://x\u0007link\u001b]8;;\u0007 \u001b[2K\u001bMend')).toBe('red link end');
    expect(stripAnsi('plain')).toBe('plain');
  });

  it('truncates without splitting a surrogate pair and collapses lines', () => {
    const emoji = '\u{1F600}'.repeat(3);
    expect(truncateText(emoji, 3)).toEqual({ text: '\u{1F600}', truncated: true });
    expect(oneLine('a\n  b\t c', 50)).toBe('a b c');
    expect(oneLine('x'.repeat(10), 8)).toBe('xxxxx...');
  });

  it('computes the decoded size of a base64 string', () => {
    for (const n of [0, 1, 2, 3, 4, 100, 3001]) {
      expect(base64Bytes(Buffer.alloc(n, 1).toString('base64'))).toBe(n);
    }
  });

  it('bounds a value by serialised size, flagging what was cut', () => {
    expect(boundValue({ a: 'short', n: 1 }, 1000)).toEqual({ value: { a: 'short', n: 1 }, truncated: false });
    const big = boundValue({ a: 'x'.repeat(100), b: 'y'.repeat(100), list: [1, 2, 3] }, 150);
    expect(big.truncated).toBe(true);
    expect(JSON.stringify(big.value).length).toBeLessThan(260);
    expect(boundValue('not an object', 100)).toEqual({ value: {}, truncated: false });
  });
});
