import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { readTail } from './windows.js';
import { join } from 'node:path';
import { readInFlight, readSubagentActivity } from './readInFlight.js';
import { classifyReadiness } from './readiness.js';
import type { InFlightFacts } from './inFlight.js';
import { assistantLine, humanPrompt, jsonl, makeTempDir, removeDir, textBlock, toolResultLine, toolUseBlock, writeMeta, writeText } from './testFixtures.js';
import type { Obj } from './testFixtures.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    removeDir(dir);
  }
});

function transcript(lines: Obj[]): string {
  const dir = makeTempDir('am-readinflight-');
  dirs.push(dir);
  const file = join(dir, 'session.jsonl');
  writeText(file, jsonl(lines));
  return file;
}

describe('readInFlight', () => {
  it('reads an open call from a small file', async () => {
    const file = transcript([humanPrompt(1, 'go'), assistantLine(2, 'm1', 0, toolUseBlock('t1', 'Bash', { command: 'node wait.mjs' }))]);
    const result = await readInFlight(file);
    expect(result).toMatchObject({ ok: true, facts: { coversLastTurn: true } });
    expect(result.ok && result.facts.openCalls).toHaveLength(1);
  });

  it('a missing file is a reason, not an empty success', async () => {
    const dir = makeTempDir('am-readinflight-');
    dirs.push(dir);
    const result = await readInFlight(join(dir, 'nope.jsonl'));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/does not exist|cannot be read/i);
  });

  it('pages backwards past a big tool result until the last user message is in the window', async () => {
    const big = 'x'.repeat(200_000);
    const file = transcript([
      humanPrompt(1, 'go'),
      assistantLine(2, 'm1', 0, toolUseBlock('t1', 'Bash', { command: 'cat big' })),
      toolResultLine(3, [{ id: 't1', content: big }]),
      assistantLine(4, 'm2', 0, textBlock('done')),
    ]);
    const result = await readInFlight(file, { windowBytes: 16 * 1024, maxBytes: 1024 * 1024 });
    expect(result).toMatchObject({ ok: true, facts: { coversLastTurn: true, openCalls: [] } });
  });

  it('gives up at maxBytes and says the window does not cover the last turn', async () => {
    const big = 'x'.repeat(200_000);
    const file = transcript([
      humanPrompt(1, 'go'),
      assistantLine(2, 'm1', 0, toolUseBlock('t1', 'Bash', { command: 'cat big' })),
      toolResultLine(3, [{ id: 't1', content: big }]),
      assistantLine(4, 'm2', 0, textBlock('done')),
    ]);
    const result = await readInFlight(file, { windowBytes: 16 * 1024, maxBytes: 64 * 1024 });
    expect(result).toMatchObject({ ok: true, facts: { coversLastTurn: false } });
  });
});

describe('readInFlight: a first window already read by the caller', () => {
  it('is used instead of reading the file again when it holds the whole file (same facts); the file is not touched', async () => {
    const file = transcript([humanPrompt(1, 'go'), assistantLine(2, 'm1', 0, toolUseBlock('t1', 'Bash', { command: 'node wait.mjs' }))]);
    const direct = await readInFlight(file);
    const tail = await readTail(file, { bytes: 64 * 1024 });
    expect(tail.startOffset).toBe(0);
    // The file is gone: a second read would fail, so an ok result proves none happened.
    rmSync(file);
    const reused = await readInFlight(file, { firstWindow: { entries: tail.entries, startOffset: tail.startOffset, endOffset: tail.endOffset } });
    expect(reused).toEqual(direct);
  });

  it('is ignored when it does not start at the beginning of the file (the 128K window would hold more): the file is read', async () => {
    const file = transcript([humanPrompt(1, 'go'), assistantLine(2, 'm1', 0, textBlock('hi'))]);
    const result = await readInFlight(file, { firstWindow: { entries: [], startOffset: 10, endOffset: 20 } });
    expect(result).toMatchObject({ ok: true, facts: { reachedStart: true, coversLastTurn: true } });
  });
});

describe('readInFlight: background tasks older than the window', () => {
  const turns = (): Obj[] => [
    humanPrompt(1, 'start'),
    assistantLine(2, 'm1', 0, toolUseBlock('bg1', 'Bash', { command: 'node server.mjs', run_in_background: true })),
    toolResultLine(3, [{ id: 'bg1', content: 'x'.repeat(100_000) }]),
    assistantLine(4, 'm2', 0, textBlock('ok')),
    humanPrompt(5, 'next'),
    assistantLine(6, 'm3', 0, toolUseBlock('t2', 'Bash', { command: 'cat big' })),
    toolResultLine(7, [{ id: 't2', content: 'small' }]),
    assistantLine(8, 'm4', 0, textBlock('done')),
  ];
  const readinessOf = (facts: InFlightFacts) => classifyReadiness({ now: 1, turn: { status: 'idle', ageMs: 60_000, alive: true }, transcript: { ok: true, facts }, subagents: { ok: true, infos: [] } });

  it('a window that stops before the start of the file did not check older background tasks', async () => {
    const result = await readInFlight(transcript(turns()), { windowBytes: 16 * 1024, maxBytes: 64 * 1024 });
    expect(result).toMatchObject({ ok: true, facts: { coversLastTurn: true, reachedStart: false, backgroundOpen: [] } });
    if (!result.ok) {
      throw new Error('read failed');
    }
    const readiness = readinessOf(result.facts);
    expect(readiness.state).toBe('unknown');
    expect(readiness.reasons.join(' ')).toContain('older background tasks could not be checked');
  });

  it('a file bigger than the first window but within maxBytes is read back to its start: a quiet session stays free, a background task of the first turn is seen', async () => {
    const quietTurns = turns().map((line) => JSON.parse(JSON.stringify(line).replace(',"run_in_background":true', '')) as Obj);
    const quiet = await readInFlight(transcript(quietTurns), { windowBytes: 16 * 1024, maxBytes: 1024 * 1024 });
    if (!quiet.ok) {
      throw new Error('read failed');
    }
    expect(quiet.facts.reachedStart).toBe(true);
    expect(readinessOf(quiet.facts)).toEqual({ state: 'free', reasons: [] });
    const withTask = await readInFlight(transcript([humanPrompt(0, 'go'), assistantLine(0.5, 'm0', 0, toolUseBlock('bg1', 'Bash', { command: 'node server.mjs', run_in_background: true })), ...turns()]), { windowBytes: 16 * 1024, maxBytes: 1024 * 1024 });
    if (!withTask.ok) {
      throw new Error('read failed');
    }
    expect(withTask.facts.backgroundOpen.length).toBeGreaterThan(0);
    expect(readinessOf(withTask.facts).state).toBe('busy');
  });

  it('a small file (the window reaches the start) with no background task stays free', async () => {
    const small = await readInFlight(transcript([humanPrompt(1, 'go'), assistantLine(2, 'm1', 0, textBlock('hi'))]));
    if (!small.ok) {
      throw new Error('read failed');
    }
    expect(small.facts.reachedStart).toBe(true);
    expect(readinessOf(small.facts)).toEqual({ state: 'free', reasons: [] });
  });
});

describe('readSubagentActivity', () => {
  it('lists the sub-agents with what the rule needs', async () => {
    const projectDir = makeTempDir('am-readsub-');
    dirs.push(projectDir);
    mkdirSync(join(projectDir, 'sess', 'subagents'), { recursive: true });
    writeMeta(join(projectDir, 'sess', 'subagents'), 'a1', { agentType: 'general-purpose', description: 'research', finished: false });
    writeMeta(join(projectDir, 'sess', 'subagents'), 'a2', { agentType: 'Explore', finished: true });
    const result = await readSubagentActivity(projectDir, 'sess');
    expect(result.ok).toBe(true);
    expect(result.ok && result.infos.map((info) => [info.agentId, info.finished])).toEqual([
      ['a1', false],
      ['a2', true],
    ]);
  });

  it('a session without a sub-agents folder has none (said by the listing, not an error)', async () => {
    const projectDir = makeTempDir('am-readsub-');
    dirs.push(projectDir);
    expect(await readSubagentActivity(projectDir, 'sess')).toEqual({ ok: true, infos: [] });
  });
});
