import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { pageBackwards, readRange, readTail } from './windows.js';
import { TranscriptTailer } from './tailer.js';
import { mergeToolCallEntries } from './merge.js';
import type { Entry, ToolCallEntry } from './types.js';
import { appendText, assistantLine, humanPrompt, jsonl, makeTempDir, removeDir, toolResultLine, toolUseBlock, writeText } from './testFixtures.js';

const dirs: string[] = [];
function tempFile(text: string): string {
  const dir = makeTempDir();
  dirs.push(dir);
  const path = join(dir, 's.jsonl');
  writeText(path, text);
  return path;
}
afterEach(() => {
  dirs.splice(0).forEach(removeDir);
});

const prompts = (entries: Entry[]): string[] => entries.flatMap(e => (e.kind === 'user-prompt' ? [e.text] : []));
const sixty = Array.from({ length: 60 }, (_, i) => humanPrompt(i, `prompt number ${String(i).padStart(2, '0')}`));

describe('readTail / pageBackwards / readRange', () => {
  it('reads the last window, drops the partial first line and pages backwards to the start without gaps or overlaps', async () => {
    const path = tempFile(jsonl(sixty));
    const tail = await readTail(path, { bytes: 8192 });
    expect(tail.error).toBeUndefined();
    expect(tail.hasMoreBefore).toBe(true);
    expect(prompts(tail.entries).at(-1)).toBe('prompt number 59');
    expect(tail.startOffset).toBeGreaterThan(0);
    // Every window starts on a line boundary: the first entry of the window sits exactly at startOffset.
    expect(tail.entries[0]!.offset).toBe(tail.startOffset);

    const seen: string[] = [...prompts(tail.entries)];
    let before = tail.startOffset;
    let pages = 0;
    for (;;) {
      const page = await pageBackwards(path, before, { bytes: 8192 });
      expect(page.error).toBeUndefined();
      expect(page.endOffset).toBe(before);
      seen.unshift(...prompts(page.entries));
      before = page.startOffset;
      pages += 1;
      if (!page.hasMoreBefore) {
        break;
      }
    }
    expect(pages).toBeGreaterThan(1);
    expect(before).toBe(0);
    expect(seen).toEqual(sixty.map((_, i) => `prompt number ${String(i).padStart(2, '0')}`));
  });

  it('returns the whole file when the window is larger, and leaves a partial last line out', async () => {
    const text = jsonl(sixty.slice(0, 3)) + '{"type":"user","message":{"content":"being writ';
    const path = tempFile(text);
    const tail = await readTail(path, { bytes: 1_000_000 });
    expect(prompts(tail.entries)).toHaveLength(3);
    expect(tail.startOffset).toBe(0);
    expect(tail.hasMoreBefore).toBe(false);
    expect(tail.endOffset).toBe(Buffer.byteLength(jsonl(sixty.slice(0, 3))));
    // The tail state continues exactly after the last whole line.
    appendText(path, 'ing"}}\n');
    const next = await new TranscriptTailer().readNew(path, tail.state);
    expect(next.entries.map(e => e.kind)).toEqual(['user-prompt']);
  });

  it('widens the window when it holds no line boundary (a line longer than the window)', async () => {
    const path = tempFile(jsonl([humanPrompt(1, 'a'), humanPrompt(2, 'b'.repeat(30_000)), humanPrompt(3, 'c')]));
    const tail = await readTail(path, { bytes: 4096 });
    expect(tail.error).toBeUndefined();
    expect(prompts(tail.entries).at(-1)).toBe('c');
    expect(tail.entries.every(e => e.offset >= tail.startOffset)).toBe(true);
  });

  it('continues with readNew from a tail state and pairs a result whose call is in the window', async () => {
    const path = tempFile(jsonl([humanPrompt(1, 'go'), assistantLine(2, 'm', 0, toolUseBlock('t1', 'Bash', { command: 'sleep 1' }))]));
    const tail = await readTail(path);
    expect(Object.keys(tail.state.pending)).toEqual(['t1']);
    appendText(path, jsonl([toolResultLine(4, [{ id: 't1', content: 'done' }])]));
    const next = await new TranscriptTailer().readNew(path, tail.state);
    expect(next.entries[0]).toMatchObject({ kind: 'tool-call', id: 't1', status: 'ok', durationMs: 2000 });
  });

  it('pairs across pages: the result is an orphan on its page, mergeToolCallEntries completes the call', async () => {
    const filler = Array.from({ length: 30 }, (_, i) => humanPrompt(10 + i, `filler ${i}`));
    const lines = [assistantLine(1, 'm', 0, toolUseBlock('t_far', 'Read', { file_path: '/work/shop/far.txt' })), ...filler, toolResultLine(50, [{ id: 't_far', content: 'far result' }])];
    const path = tempFile(jsonl(lines));
    const tail = await readTail(path, { bytes: 4096 });
    expect(tail.hasMoreBefore).toBe(true);
    const orphan = tail.entries.find((e): e is ToolCallEntry => e.kind === 'tool-call');
    expect(orphan).toMatchObject({ id: 't_far', orphan: true, status: 'ok' });
    let all = tail.entries;
    let before = tail.startOffset;
    while (before > 0) {
      const page = await pageBackwards(path, before, { bytes: 4096 });
      all = [...page.entries, ...all];
      before = page.startOffset;
    }
    const merged = mergeToolCallEntries(all).filter((e): e is ToolCallEntry => e.kind === 'tool-call');
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 't_far', name: 'Read', inputSummary: '/work/shop/far.txt', status: 'ok', resultPreview: 'far result', durationMs: 49_000 });
    expect(merged[0]!.orphan).toBeUndefined();
  });

  it('readRange returns exactly the lines between two line offsets and refuses a misaligned or invalid range', async () => {
    const path = tempFile(jsonl(sixty.slice(0, 10)));
    const all = await readRange(path, 0, 1_000_000);
    expect(all.entries).toHaveLength(10);
    const from = all.entries[3]!.offset;
    const to = all.entries[6]!.offset;
    const middle = await readRange(path, from, to);
    expect(prompts(middle.entries)).toEqual(['prompt number 03', 'prompt number 04', 'prompt number 05']);
    expect(middle.endOffset).toBe(to);
    expect((await readRange(path, from + 5, to)).error).toMatchObject({ code: 'misaligned', retry: false });
    expect((await readRange(path, 10, 5)).error).toMatchObject({ code: 'invalid-range' });
    expect((await pageBackwards(path, 7)).error).toMatchObject({ code: 'misaligned' });
    expect((await pageBackwards(path, 999_999_999)).error).toMatchObject({ code: 'invalid-range' });
  });

  it('gives an explicit error for a missing file', async () => {
    const dir = makeTempDir();
    dirs.push(dir);
    const tail = await readTail(join(dir, 'none.jsonl'));
    expect(tail.error).toMatchObject({ code: 'missing', retry: true });
    expect(tail.entries).toEqual([]);
  });
});
