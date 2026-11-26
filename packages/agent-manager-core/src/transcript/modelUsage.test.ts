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

async function entriesOf(agentId: string | undefined): Promise<Entry[]> {
  const dir = makeTempDir();
  dirs.push(dir);
  const path = join(dir, 't.jsonl');
  writeText(path, jsonl([withModel(assistantLine(1, 'm1', 0, textBlock('a'), { input: 10, output: 4 }), 'claude-sonnet-4-6')]));
  return (await new TranscriptTailer(agentId === undefined ? {} : { agentId }).readNew(path)).entries;
}

describe('ModelUsageAccumulator owner', () => {
  it('counts the main session by default and ignores the lines of a sub-agent', async () => {
    const accumulator = new ModelUsageAccumulator(true);
    accumulator.add(await entriesOf('ag1'));
    expect(accumulator.rollup().lastUsage).toBeUndefined();
    accumulator.add(await entriesOf(undefined));
    expect(accumulator.rollup().lastUsage?.outputTokens).toBe(4);
  });

  it('counts only the lines of the agent it was made for, with the same figures', async () => {
    const accumulator = new ModelUsageAccumulator(true, 'ag1');
    accumulator.add(await entriesOf(undefined));
    accumulator.add(await entriesOf('other'));
    expect(accumulator.rollup().lastUsage).toBeUndefined();
    accumulator.add(await entriesOf('ag1'));
    expect(accumulator.rollup()).toMatchObject({ lastUsage: { outputTokens: 4 }, currentModel: { displayName: 'Sonnet 4.6' }, usedPct: expect.any(Number) });
  });
});
