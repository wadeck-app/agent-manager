import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { agentCallOwners, buildAgentTree, clearHeadCache, HEAD_CACHE_LIMIT, headCacheSize, linkSubagents, listSubagents, SubagentTailer } from './subagents.js';
import { TranscriptTailer } from './tailer.js';
import type { Entry, SubagentInfo, ToolCallEntry } from './types.js';
import {
  appendText,
  assistantLine,
  forkRefLine,
  jsonl,
  makeTempDir,
  removeDir,
  SESSION_ID,
  ts,
  subagentPrompt,
  textBlock,
  toolResultLine,
  toolUseBlock,
  writeMeta,
  writeText,
} from './testFixtures.js';

const dirs: string[] = [];
function project(): { projectDir: string; subDir: string } {
  const projectDir = makeTempDir();
  dirs.push(projectDir);
  const subDir = join(projectDir, SESSION_ID, 'subagents');
  mkdirSync(subDir, { recursive: true });
  return { projectDir, subDir };
}
afterEach(() => {
  clearHeadCache();
  dirs.splice(0).forEach(removeDir);
});

describe('listSubagents', () => {
  it('lists meta files with the observed fields, a fork reference, and ignores other files', async () => {
    const { projectDir, subDir } = project();
    writeMeta(subDir, 'a111', { agentType: 'general-purpose', isBuiltIn: true, description: 'Look around', toolUseId: 'toolu_1', spawnDepth: 1, requestShape: 'background', requestNonInteractive: true, finished: true });
    writeText(join(subDir, 'agent-a111.jsonl'), jsonl([subagentPrompt(1, 'a111', 'neutral task')]));
    writeMeta(subDir, 'f222', { agentType: 'fork', isFork: true, isBuiltIn: false, description: 'Forked work', toolUseId: 'toolu_2', spawnDepth: 1, requestShape: 'background', model: 'inherit' });
    writeText(join(subDir, 'agent-f222.jsonl'), jsonl([forkRefLine('f222'), subagentPrompt(2, 'f222', 'neutral fork task')]));
    // A named agent has no toolUseId and no `finished`.
    writeMeta(subDir, 'n333', { agentType: 'general-purpose', description: 'Named', name: 'helper', spawnDepth: 1 });
    writeText(join(subDir, 'agent-a111.forked-skill.json'), '{}');
    writeText(join(subDir, 'agent-a111.forked-skill.marker.json'), '{}');
    const result = await listSubagents(projectDir, SESSION_ID);
    if (!result.ok) {
      throw new Error(JSON.stringify(result.error));
    }
    expect(result.present).toBe(true);
    expect(result.unreadable).toEqual([]);
    expect(result.subagents.map(s => s.agentId)).toEqual(['a111', 'f222', 'n333']);
    expect(result.subagents[0]).toMatchObject({ agentType: 'general-purpose', description: 'Look around', toolUseId: 'toolu_1', finished: true, spawnDepth: 1, isFork: false, requestShape: 'background' });
    expect(result.subagents[0]!.transcriptPath).toBe(join(subDir, 'agent-a111.jsonl'));
    expect(result.subagents[1]).toMatchObject({ isFork: true, model: 'inherit', finished: false, parentSessionId: SESSION_ID, contextLength: 12 });
    expect(result.subagents[2]).toMatchObject({ name: 'helper', finished: false });
    expect(result.subagents[2]!.toolUseId).toBeUndefined();
  });

  it('reads the start time from the first timestamped line (after a fork reference), the last write from the file time, and stoppedByUser from the meta', async () => {
    const { projectDir, subDir } = project();
    writeMeta(subDir, 'a111', { agentType: 'general-purpose', toolUseId: 'toolu_1', stoppedByUser: true });
    writeText(join(subDir, 'agent-a111.jsonl'), jsonl([subagentPrompt(7, 'a111', 'task')]));
    writeMeta(subDir, 'f222', { agentType: 'fork', isFork: true, toolUseId: 'toolu_2', finished: true });
    writeText(join(subDir, 'agent-f222.jsonl'), jsonl([forkRefLine('f222'), subagentPrompt(9, 'f222', 'task')]));
    // No transcript written yet: no times, nothing invented.
    writeMeta(subDir, 'n333', { agentType: 'Explore' });
    const result = await listSubagents(projectDir, SESSION_ID);
    if (!result.ok) {
      throw new Error('expected ok');
    }
    const [a, f, n] = result.subagents;
    expect(a).toMatchObject({ stoppedByUser: true, finished: false, startedAt: Date.parse(ts(7)) });
    expect(f).toMatchObject({ stoppedByUser: false, finished: true, startedAt: Date.parse(ts(9)) });
    expect(a!.lastWriteAt).toBeGreaterThan(Date.now() - 60_000);
    expect(n).toMatchObject({ stoppedByUser: false });
    expect(n!.startedAt).toBeUndefined();
    expect(n!.lastWriteAt).toBeUndefined();
  });

  it('falls back to the creation time of the file when no line of the first bytes has a timestamp', async () => {
    const { projectDir, subDir } = project();
    writeMeta(subDir, 'big1', { agentType: 'Explore' });
    // One first line longer than the head window, without a timestamp in it.
    writeText(join(subDir, 'agent-big1.jsonl'), JSON.stringify({ type: 'user', pad: 'x'.repeat(40_000) }) + '\n');
    const result = await listSubagents(projectDir, SESSION_ID);
    if (!result.ok) {
      throw new Error('expected ok');
    }
    const [one] = result.subagents;
    expect(one!.startedAt).toBeGreaterThan(Date.now() - 60_000);
  });

  it('reads the head once per transcript: a settled start time is cached while the last write time follows the file', async () => {
    const { projectDir, subDir } = project();
    writeMeta(subDir, 'c111', { agentType: 'Explore' });
    const file = join(subDir, 'agent-c111.jsonl');
    writeText(file, jsonl([subagentPrompt(3, 'c111', 'task')]));
    const first = await listSubagents(projectDir, SESSION_ID);
    // The file is rewritten with another first timestamp and touched later: a re-read would change startedAt, the cache keeps it; lastWriteAt is read every time.
    writeText(file, jsonl([subagentPrompt(8, 'c111', 'task')]));
    const later = new Date(Date.now() + 60_000);
    utimesSync(file, later, later);
    const second = await listSubagents(projectDir, SESSION_ID);
    if (!first.ok || !second.ok) {
      throw new Error('expected ok');
    }
    expect(second.subagents[0]!.startedAt).toBe(Date.parse(ts(3)));
    expect(second.subagents[0]!.lastWriteAt).toBeGreaterThan(first.subagents[0]!.lastWriteAt! + 30_000);
  });

  it('bounds the cache of heads', async () => {
    const { projectDir, subDir } = project();
    for (let index = 0; index < 3; index += 1) {
      writeMeta(subDir, `b${index}`, { agentType: 'Explore' });
      writeText(join(subDir, `agent-b${index}.jsonl`), jsonl([subagentPrompt(1, `b${index}`, 'task')]));
    }
    await listSubagents(projectDir, SESSION_ID);
    expect(headCacheSize()).toBe(3);
    expect(HEAD_CACHE_LIMIT).toBeGreaterThanOrEqual(3);
  });

  it('keeps a complete last line when the file is exactly the size of the head window', async () => {
    const { projectDir, subDir } = project();
    writeMeta(subDir, 'e111', { agentType: 'Explore' });
    // First line without a timestamp, the second (the last, no line break) has one; together exactly 16 KiB.
    const second = JSON.stringify({ type: 'user', timestamp: ts(5), pad: '' });
    const pad = 16 * 1024 - 1 - second.length - JSON.stringify({ type: 'user', pad: '' }).length;
    const text = JSON.stringify({ type: 'user', pad: 'x'.repeat(pad) }) + '\n' + second;
    expect(Buffer.byteLength(text)).toBe(16 * 1024);
    writeText(join(subDir, 'agent-e111.jsonl'), text);
    const result = await listSubagents(projectDir, SESSION_ID);
    if (!result.ok) {
      throw new Error('expected ok');
    }
    expect(result.subagents[0]!.startedAt).toBe(Date.parse(ts(5)));
  });

  it('reports a transcript that exists but cannot be read, instead of treating it as just started', async () => {
    const { projectDir, subDir } = project();
    writeMeta(subDir, 'd111', { agentType: 'Explore' });
    // A folder where the transcript should be: opening or reading it fails with something other than "no such file".
    mkdirSync(join(subDir, 'agent-d111.jsonl'));
    const result = await listSubagents(projectDir, SESSION_ID);
    if (!result.ok) {
      throw new Error('expected ok');
    }
    expect(result.subagents[0]!.readError).toMatch(/could not be (opened|read)/);
    expect(result.subagents[0]!.lastWriteAt).toBeUndefined();
  });

  it('says so when the folder does not exist, and reports a broken meta instead of dropping it', async () => {
    const empty = makeTempDir();
    dirs.push(empty);
    expect(await listSubagents(empty, SESSION_ID)).toMatchObject({ ok: true, present: false, subagents: [] });
    const { projectDir, subDir } = project();
    writeText(join(subDir, 'agent-bad1.meta.json'), '{not json');
    writeText(join(subDir, 'agent-arr.meta.json'), '[]');
    writeMeta(subDir, 'good', { agentType: 'Explore' });
    const result = await listSubagents(projectDir, SESSION_ID);
    if (!result.ok) {
      throw new Error('expected ok');
    }
    expect(result.subagents.map(s => s.agentId)).toEqual(['good']);
    expect(result.unreadable.map(u => u.file).sort()).toEqual(['agent-arr.meta.json', 'agent-bad1.meta.json']);
  });
});

const info = (agentId: string, toolUseId?: string): SubagentInfo => ({ agentId, ...(toolUseId !== undefined ? { toolUseId } : {}), finished: false, stoppedByUser: false, isFork: false, transcriptPath: `${agentId}.jsonl`, metaPath: `${agentId}.meta.json` });

describe('buildAgentTree', () => {
  it('makes roots of agents spawned by the main session and children of agents spawned inside another agent', () => {
    const main = assistantLine(1, 'm', 0, toolUseBlock('toolu_root', 'Agent', { description: 'd' }));
    const nested = { ...assistantLine(2, 'n', 0, toolUseBlock('toolu_child', 'Agent', { description: 'd2' })), agentId: 'a1', isSidechain: true };
    const calls: Entry[] = [];
    return Promise.all([parse(main, undefined), parse(nested, 'a1')]).then(([a, b]) => {
      calls.push(...a, ...b);
      const owners = agentCallOwners(calls);
      expect([...owners]).toEqual([
        ['toolu_root', undefined],
        ['toolu_child', 'a1'],
      ]);
      const tree = buildAgentTree([info('a1', 'toolu_root'), info('a2', 'toolu_child'), info('a3', 'toolu_unknown'), info('a4')], owners);
      expect(tree.map(n => n.info.agentId)).toEqual(['a1', 'a3', 'a4']);
      expect(tree[0]!.children.map(n => [n.info.agentId, n.parentAgentId])).toEqual([['a2', 'a1']]);
    });
  });

  it('does not loop on a corrupt owner map', () => {
    const owners = new Map<string, string | undefined>([
      ['t1', 'b'],
      ['t2', 'a'],
    ]);
    const tree = buildAgentTree([info('a', 't1'), info('b', 't2')], owners);
    expect(tree.map(n => n.info.agentId).sort()).toEqual(['a', 'b']);
  });
});

async function parse(line: Record<string, unknown>, agentId: string | undefined): Promise<Entry[]> {
  const dir = makeTempDir();
  dirs.push(dir);
  const path = join(dir, 'x.jsonl');
  writeFileSync(path, jsonl([line]));
  return (await new TranscriptTailer({ agentId }).readNew(path)).entries;
}

describe('linkSubagents and SubagentTailer', () => {
  it('sets subagentId on the Agent call matched by toolUseId (or by the agentId of its result) and leaves the rest', async () => {
    const entries = await parseMany([
      assistantLine(1, 'm', 0, toolUseBlock('toolu_a', 'Agent', { description: 'one' })),
      assistantLine(2, 'm', 1, toolUseBlock('toolu_b', 'Agent', { description: 'two' })),
      assistantLine(3, 'm', 2, toolUseBlock('toolu_c', 'Bash', { command: 'ls' })),
      toolResultLine(4, [{ id: 'toolu_b', content: 'launched' }], { toolUseResult: { agentId: 'bbb' } }),
    ]);
    const linked = linkSubagents(entries, [info('aaa', 'toolu_a'), info('bbb')]);
    const calls = linked.filter((e): e is ToolCallEntry => e.kind === 'tool-call');
    expect(calls.map(c => [c.id, c.subagentId])).toEqual([
      ['toolu_a', 'aaa'],
      ['toolu_b', 'bbb'],
      ['toolu_c', undefined],
    ]);
    // Pure: the input entries were not changed.
    expect((entries.find(e => e.kind === 'tool-call') as ToolCallEntry).subagentId).toBeUndefined();
  });

  it('tails agent-<id>.jsonl incrementally and stamps the owner; a transcript not written yet is a retryable error', async () => {
    const { subDir } = project();
    const sub = { ...info('s1'), transcriptPath: join(subDir, 'agent-s1.jsonl') };
    const tailer = new SubagentTailer(sub);
    const none = await tailer.readNew();
    expect(none.error).toMatchObject({ code: 'missing', retry: true });
    writeText(sub.transcriptPath, jsonl([subagentPrompt(1, 's1', 'neutral'), assistantLine(2, 'm', 0, toolUseBlock('t1', 'Read', { file_path: '/work/a' }))]));
    const first = await tailer.readNew();
    expect(first.entries.map(e => [e.kind, e.ownerAgentId])).toEqual([
      ['user-prompt', 's1'],
      ['tool-call', 's1'],
      ['usage', 's1'],
    ]);
    appendText(sub.transcriptPath, jsonl([toolResultLine(3, [{ id: 't1', content: 'x' }]), assistantLine(4, 'm2', 0, textBlock('done'))]));
    const second = await tailer.readNew(first.state);
    expect(second.entries.map(e => e.kind)).toEqual(['tool-call', 'assistant-text', 'usage']);
    expect(second.entries[0]).toMatchObject({ status: 'ok', ownerAgentId: 's1' });
  });
});

async function parseMany(lines: Record<string, unknown>[]): Promise<Entry[]> {
  const dir = makeTempDir();
  dirs.push(dir);
  const path = join(dir, 'x.jsonl');
  writeFileSync(path, jsonl(lines));
  return (await new TranscriptTailer().readNew(path)).entries;
}
