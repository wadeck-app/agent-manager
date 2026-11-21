import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { TranscriptTailer } from './tailer.js';
import type { Entry } from './types.js';
import { assistantLine, humanPrompt, jsonl, makeTempDir, raw, removeDir, textBlock, thinkingBlock, toolResultLine, toolUseBlock, writeText } from './testFixtures.js';

const dirs: string[] = [];
afterEach(() => {
  dirs.splice(0).forEach(removeDir);
});

async function readAll(text: string): Promise<Entry[]> {
  const dir = makeTempDir();
  dirs.push(dir);
  const path = join(dir, 's.jsonl');
  writeText(path, text);
  const result = await new TranscriptTailer().readNew(path);
  expect(result.error).toBeUndefined();
  return result.entries;
}

describe('entries carry the uuid of their transcript line (anchor of a thread)', () => {
  it('a user prompt, an assistant text and a thinking block carry the uuid of their own line', async () => {
    const prompt = humanPrompt(1, 'hello');
    const thinking = assistantLine(2, 'msg_1', 0, thinkingBlock('hmm'));
    const answer = assistantLine(3, 'msg_1', 1, textBlock('hi'));
    const entries = await readAll(jsonl([prompt, thinking, answer]));
    expect(entries.find((e) => e.kind === 'user-prompt')?.uuid).toBe(prompt.uuid);
    expect(entries.find((e) => e.kind === 'thinking')?.uuid).toBe(thinking.uuid);
    expect(entries.find((e) => e.kind === 'assistant-text')?.uuid).toBe(answer.uuid);
  });

  it('a tool call carries the uuid of the line that called it, not the one of its result', async () => {
    const call = assistantLine(2, 'msg_2', 0, toolUseBlock('toolu_1', 'Bash', { command: 'ls' }));
    const result = toolResultLine(3, [{ id: 'toolu_1', content: 'ok' }]);
    const entries = await readAll(jsonl([call, result]));
    const tool = entries.filter((e) => e.kind === 'tool-call').at(-1);
    expect(tool?.uuid).toBe(call.uuid);
  });

  it('a line without a uuid gives an entry without the field (never an invented one)', async () => {
    const prompt = humanPrompt(1, 'old');
    delete prompt.uuid;
    const entries = await readAll(jsonl([prompt]));
    expect(entries[0]).toBeDefined();
    expect('uuid' in entries[0]!).toBe(false);
  });

  it('a uuid that is not a string is ignored', async () => {
    const prompt = humanPrompt(1, 'weird');
    prompt.uuid = 42;
    const entries = await readAll(jsonl([prompt]));
    expect('uuid' in entries[0]!).toBe(false);
  });

  it('an unparsable line has no uuid and keeps its place', async () => {
    const entries = await readAll(jsonl([raw('{not json')]));
    expect(entries[0]?.kind).toBe('unparsable');
    expect('uuid' in entries[0]!).toBe(false);
  });
});
