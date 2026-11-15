import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { insertModelChanges } from './modelChanges.js';
import { ModelUsageAccumulator, rollupModelUsage } from './modelUsage.js';
import { TranscriptTailer } from './tailer.js';
import { readTail } from './windows.js';
import type { AssistantTextEntry, Entry, ModelChangeEntry } from './types.js';
import { assistantLine, attachmentLine, withModel, type Obj, humanPrompt, injectedPrompt, jsonl, makeTempDir, removeDir, textBlock, thinkingBlock, writeText } from './testFixtures.js';

// Shapes trimmed from real transcripts: the model attachment (identity), the /model command and its stdout, assistant message.model without region/tag.
const modelAttachment = (seconds: number, modelId: string, marketingName: string) =>
  attachmentLine(seconds, { type: 'model', identity: { modelId, marketingName, knowledgeCutoff: 'June 2026' } });

const COMMAND = '<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args></command-args>';
const stdout = (text: string) => `<local-command-stdout>${text}</local-command-stdout>`;

function assistant(seconds: number, id: string, model: string, text = 'Done.', usage = {}) {
  const line = assistantLine(seconds, id, 0, textBlock(text), usage);
  return withModel(line, model);
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    removeDir(dir);
  }
});

async function entriesOf(lines: Obj[]): Promise<Entry[]> {
  const dir = makeTempDir();
  dirs.push(dir);
  const path = join(dir, 's.jsonl');
  writeText(path, jsonl(lines));
  return (await new TranscriptTailer().readNew(path)).entries;
}

const notices = (entries: readonly Entry[]): ModelChangeEntry[] => entries.filter((entry): entry is ModelChangeEntry => entry.kind === 'model-change');

describe('model attachment', () => {
  it('is parsed in its real key order, other attachments stay skipped without a parse', async () => {
    const dir = makeTempDir();
    dirs.push(dir);
    const path = join(dir, 's.jsonl');
    writeText(path, jsonl([attachmentLine(0), modelAttachment(1, 'us.anthropic.claude-opus-5-5[1m]', 'Opus 5.5 (1M context)'), attachmentLine(2)]));
    const result = await new TranscriptTailer().readNew(path);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ kind: 'model-info', modelId: 'us.anthropic.claude-opus-5-5[1m]', displayName: 'Opus 5.5 (1M context)', knowledgeCutoff: 'June 2026' });
    expect(result.state.counts.skipped).toEqual({ attachment: 2 });
  });
});

describe('insertModelChanges', () => {
  it('no notice for the first model, nor while the model stays the same (region and date spellings included)', async () => {
    const entries = await entriesOf([modelAttachment(0, 'us.anthropic.claude-sonnet-5', 'Sonnet 5'), assistant(1, 'm1', 'claude-sonnet-5'), assistant(2, 'm2', 'claude-sonnet-5')]);
    expect(notices(insertModelChanges(entries).entries)).toEqual([]);
  });

  it('an assistant model change gets a notice before its message (thinking of the message included), with the names of the attachments', async () => {
    const thinking = assistantLine(3, 'm2', 0, thinkingBlock('Neutral.'));
    withModel(thinking, 'claude-opus-5-5');
    const entries = await entriesOf([
      modelAttachment(0, 'us.anthropic.claude-sonnet-5', 'Sonnet 5'),
      assistant(1, 'm1', 'claude-sonnet-5'),
      thinking,
      assistant(4, 'm2', 'claude-opus-5-5'),
      modelAttachment(5, 'us.anthropic.claude-opus-5-5[1m]', 'Opus 5.5 (1M context)'),
    ]);
    const result = insertModelChanges(entries);
    const found = notices(result.entries);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ source: 'assistant', from: { displayName: 'Sonnet 5' }, to: { displayName: 'Opus 5.5', known: true }, text: 'Model changed: Sonnet 5 -> Opus 5.5' });
    // Before the thinking block of the same message, after the previous message.
    const kinds = result.entries.map((entry) => entry.kind);
    expect(kinds.indexOf('model-change')).toBe(kinds.indexOf('thinking') - 1);
    // Ordered by offset, so the log cursors keep working.
    const offsets = result.entries.map((entry) => entry.offset);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(new Set(result.entries.map((entry) => entry.key)).size).toBe(result.entries.length);
    // The attachment that follows names the current model exactly.
    expect(result.state.current).toMatchObject({ id: 'us.anthropic.claude-opus-5-5[1m]', displayName: 'Opus 5.5 (1M context)' });
  });

  it('a /model command gives one notice at the command, and the assistant change that follows is not noticed again (dedupe)', async () => {
    const entries = await entriesOf([
      assistant(1, 'm1', 'claude-sonnet-4-6'),
      humanPrompt(2, COMMAND, { isMeta: undefined }),
      injectedPrompt(2, stdout('Set model to `Haiku 5.5` for this session only')),
      assistant(5, 'm2', 'claude-haiku-5-5'),
    ]);
    const result = insertModelChanges(entries);
    const found = notices(result.entries);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ source: 'command', scope: 'session', from: { displayName: 'Sonnet 4.6' }, to: { displayName: 'Haiku 5.5', known: true }, text: 'Model changed: Sonnet 4.6 -> Haiku 5.5' });
    const kinds = result.entries.map((entry) => `${entry.kind}`);
    expect(kinds.indexOf('model-change')).toBe(kinds.lastIndexOf('user-prompt') + 1);
    // The state knows the real model now: a later change is noticed again.
    expect(result.state.current).toMatchObject({ id: 'claude-haiku-5-5', displayName: 'Haiku 5.5' });
    const later = insertModelChanges(await entriesOf([assistant(9, 'm3', 'claude-sonnet-5-5')]), result.state);
    expect(notices(later.entries)).toMatchObject([{ source: 'assistant', from: { displayName: 'Haiku 5.5' }, to: { displayName: 'Sonnet 5.5' } }]);
  });

  it('"saved as your default" gives the default scope; "Kept model" and the same model again give no notice', async () => {
    const entries = await entriesOf([
      assistant(1, 'm1', 'claude-sonnet-5-5'),
      injectedPrompt(2, stdout('Set model to `Opus 5 (1M context)` and saved as your default for new sessions')),
      injectedPrompt(3, stdout('Kept model as `Opus 5 (1M context)`')),
      injectedPrompt(4, stdout('Set model to `Opus 5 (1M context)` for this session only')),
    ]);
    expect(notices(insertModelChanges(entries).entries)).toMatchObject([{ source: 'command', scope: 'default', to: { displayName: 'Opus 5 (1M context)', known: true } }]);
  });

  it('a command whose model is not used (the next message keeps the old one) leaves no stale pending flag', async () => {
    const entries = await entriesOf([
      assistant(1, 'm1', 'claude-sonnet-5-5'),
      injectedPrompt(2, stdout('Set model to `Haiku 4.5` for this session only')),
      assistant(3, 'm2', 'claude-sonnet-5-5'),
      assistant(4, 'm3', 'claude-opus-5'),
    ]);
    const found = notices(insertModelChanges(entries).entries);
    expect(found.map((entry) => entry.source)).toEqual(['command', 'assistant']);
  });

  it('a window that starts after the previous model has no notice for its first model; the first model of a list with unknown name is raw and flagged', async () => {
    const entries = await entriesOf([assistant(1, 'm1', 'claude-sonnet-9-9')]);
    const result = insertModelChanges(entries);
    expect(notices(result.entries)).toEqual([]);
    expect(result.state.current).toEqual({ id: 'claude-sonnet-9-9', displayName: 'claude-sonnet-9-9', known: false });
  });

  it('ignores <synthetic> messages and sub-agent entries', async () => {
    const sub = assistant(2, 'm2', 'claude-haiku-4-5-20251001');
    sub.agentId = 'a1';
    const entries = await entriesOf([assistant(1, 'm1', 'claude-sonnet-5-5'), assistant(2, 'ms', '<synthetic>'), sub]);
    expect(notices(insertModelChanges(entries).entries)).toEqual([]);
  });

  it('is pure: the input list is not changed', async () => {
    const entries = await entriesOf([assistant(1, 'm1', 'claude-sonnet-5-5'), assistant(2, 'm2', 'claude-opus-5')]);
    const before = entries.length;
    insertModelChanges(entries);
    expect(entries).toHaveLength(before);
  });
});

describe('rollupModelUsage', () => {
  it('current model, previous ones, the last usage and the percentage with the estimated window', async () => {
    const entries = await entriesOf([
      modelAttachment(0, 'claude-sonnet-5-5', 'Sonnet 5.5'),
      assistant(1, 'm1', 'claude-sonnet-4-6', 'a', { input: 5, cacheRead: 1000, cacheCreate: 100, output: 20 }),
      assistant(2, 'm2', 'claude-sonnet-5-5', 'b', { input: 3, cacheRead: 367_000, cacheCreate: 797, output: 816 }),
    ]);
    const rollup = rollupModelUsage(entries);
    expect(rollup.currentModel).toMatchObject({ id: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5' });
    expect(rollup.previousModels).toMatchObject([{ displayName: 'Sonnet 4.6' }]);
    // The status line's "total_input_tokens" is input + cache creation + cache read of the LAST call; "total_output_tokens" its output.
    expect(rollup.lastUsage).toMatchObject({ messageId: 'm2', contextTokens: 367_800, outputTokens: 816 });
    expect(rollup.window).toMatchObject({ tokens: 1_000_000, source: 'table-proven' });
    expect(rollup.usedPct).toBe(37);
    expect(rollup.cumulativeInput).toBe(1105 + 367_800);
    expect(rollup.cumulativeOutput).toBe(836);
    expect(rollup.cumulativeComplete).toBe(false);
    expect(rollupModelUsage(entries, true).cumulativeComplete).toBe(true);
  });

  it('the percentage is clamped to 100 and absent without usage', async () => {
    const big = rollupModelUsage(await entriesOf([assistant(1, 'm1', 'claude-haiku-4-5-20251001', 'a', { cacheRead: 150_000, cacheCreate: 100_000 })]));
    // 250k > 200k: the window cannot be 200k, so 1M is assumed and the note says why.
    expect(big.window).toMatchObject({ tokens: 1_000_000, source: 'observed-over-default' });
    expect(big.usedPct).toBe(25);
    expect(rollupModelUsage([]).usedPct).toBeUndefined();
    expect(rollupModelUsage([]).currentModel).toBeUndefined();
  });

  it('a message written as several lines is counted once and takes the largest output (upsert by key)', async () => {
    const first = assistantLine(1, 'm1', 0, thinkingBlock('x'), { output: 10 });
    const second = assistantLine(2, 'm1', 1, textBlock('y'), { output: 90 });
    for (const line of [first, second]) {
      withModel(line, 'claude-sonnet-5-5');
    }
    const rollup = rollupModelUsage(await entriesOf([first, second]));
    expect(rollup.messages).toBe(1);
    expect(rollup.lastUsage?.outputTokens).toBe(90);
  });

  it('stays bounded over a long transcript and sums everything', async () => {
    const accumulator = new ModelUsageAccumulator(true);
    const lines = Array.from({ length: 300 }, (_, i) => assistant(i, `m${i}`, 'claude-sonnet-5-5', 'x', { input: 1, cacheRead: 0, cacheCreate: 0, output: 2 }));
    accumulator.add(await entriesOf(lines));
    const rollup = accumulator.rollup();
    expect(rollup.messages).toBe(300);
    expect(rollup.cumulativeInput).toBe(300);
    expect(rollup.cumulativeOutput).toBe(600);
  });

  it('works on a tail window read from a file', async () => {
    const dir = makeTempDir();
    dirs.push(dir);
    const path = join(dir, 's.jsonl');
    writeText(path, jsonl([assistant(1, 'm1', 'claude-opus-4-8', 'a', { cacheRead: 40_000 })]));
    const tail = await readTail(path, { bytes: 64 * 1024 });
    expect(rollupModelUsage(tail.entries)).toMatchObject({ currentModel: { displayName: 'Opus 4.8' }, usedPct: 20 });
  });
});

describe('types', () => {
  it('the assistant entry keeps the raw model id', async () => {
    const entries = await entriesOf([assistant(1, 'm1', 'us.anthropic.claude-sonnet-5-5')]);
    expect((entries.find((entry) => entry.kind === 'assistant-text') as AssistantTextEntry).model).toBe('us.anthropic.claude-sonnet-5-5');
  });
});
