import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { TranscriptTailer } from './tailer.js';
import type { Entry, HookEntry, ToolCallEntry } from './types.js';
import { assistantLine, attachmentLine, jsonl, makeTempDir, removeDir, toolResultLine, toolUseBlock, writeText, type Obj } from './testFixtures.js';

// Shapes of tool_use inputs and toolUseResult come from real transcripts (poc/scripts/probe-tool-meta*.mjs, 2026-11-22); text is invented.
// MultiEdit was NOT seen in the sample: its fixture follows the documented tool input and is marked UNVERIFIED.

const dirs: string[] = [];
afterEach(() => {
  dirs.splice(0).forEach(removeDir);
});

async function readAll(lines: Obj[]): Promise<Entry[]> {
  const dir = makeTempDir();
  dirs.push(dir);
  const path = join(dir, 's.jsonl');
  writeText(path, jsonl(lines));
  const result = await new TranscriptTailer().readNew(path);
  expect(result.error).toBeUndefined();
  return result.entries;
}

/** One call and its result (`toolUseResult` is the sibling field of the result line). */
async function callOf(name: string, input: Obj, result?: { content?: unknown; isError?: boolean; toolUseResult?: unknown }): Promise<ToolCallEntry> {
  const lines: Obj[] = [assistantLine(1, 'm1', 0, toolUseBlock('t1', name, input))];
  if (result !== undefined) {
    lines.push(toolResultLine(3, [{ id: 't1', content: result.content ?? 'ok', ...(result.isError === true ? { isError: true } : {}) }], result.toolUseResult === undefined ? {} : { toolUseResult: result.toolUseResult }));
  }
  const calls = (await readAll(lines)).filter((entry): entry is ToolCallEntry => entry.kind === 'tool-call');
  expect(calls).toHaveLength(1);
  return calls[0]!;
}

describe('tool meta: Edit, MultiEdit, Write', () => {
  const patch = [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, lines: [' keep', '-old line', '+new line', ' keep', '+extra line'] }];

  it('counts the churn from the structured patch of the result (exact)', async () => {
    const call = await callOf('Edit', { file_path: '/work/a.ts', old_string: 'x', new_string: 'y' }, { toolUseResult: { filePath: '/work/a.ts', structuredPatch: patch, userModified: false } });
    expect(call.meta).toMatchObject({ file: '/work/a.ts', added: 2, removed: 1 });
    expect(call.meta?.churnApprox).toBeUndefined();
  });

  it('estimates the churn from the input while the call runs, trimming the common lines, and says it is an estimate', async () => {
    const call = await callOf('Edit', { file_path: '/work/a.ts', old_string: 'a\nb\nz', new_string: 'a\nB\nc\nz' });
    expect(call.status).toBe('running');
    expect(call.meta).toMatchObject({ file: '/work/a.ts', added: 2, removed: 1, churnApprox: true });
  });

  it('keeps the estimate when the result carries no usable patch', async () => {
    const call = await callOf('Edit', { file_path: '/work/a.ts', old_string: 'a', new_string: 'b' }, { toolUseResult: { filePath: '/work/a.ts', structuredPatch: 'not an array' } });
    expect(call.meta).toMatchObject({ added: 1, removed: 1, churnApprox: true });
  });

  it('omits the churn of an edit that failed (nothing was applied)', async () => {
    const call = await callOf('Edit', { file_path: '/work/a.ts', old_string: 'a', new_string: 'b' }, { content: 'String to replace not found', isError: true });
    expect(call.status).toBe('error');
    expect(call.meta?.file).toBe('/work/a.ts');
    expect(call.meta?.added).toBeUndefined();
    expect(call.meta?.removed).toBeUndefined();
  });

  it('computes the churn from the whole input even when the kept input is cut', async () => {
    const big = Array.from({ length: 2000 }, (_, i) => `line number ${i}`).join('\n');
    const call = await callOf('Edit', { file_path: '/work/a.ts', old_string: big, new_string: `${big}\nappended` });
    expect(call.inputTruncated).toBe(true);
    expect(call.meta).toMatchObject({ added: 1, removed: 0 });
  });

  it('Write of a new file: lines added, created', async () => {
    const call = await callOf('Write', { file_path: '/work/new.ts', content: 'one\ntwo\nthree\n' }, { toolUseResult: { type: 'create', filePath: '/work/new.ts', content: 'one\ntwo\nthree\n', structuredPatch: [], originalFile: null } });
    expect(call.meta).toMatchObject({ file: '/work/new.ts', added: 3, removed: 0, created: true });
    expect(call.meta?.churnApprox).toBeUndefined();
  });

  it('Write over a file: the patch of the result gives the churn', async () => {
    const call = await callOf('Write', { file_path: '/work/a.ts', content: 'x' }, { toolUseResult: { type: 'update', filePath: '/work/a.ts', structuredPatch: patch, originalFile: 'o' } });
    expect(call.meta).toMatchObject({ added: 2, removed: 1 });
    expect(call.meta?.created).toBeUndefined();
  });

  it('MultiEdit (UNVERIFIED input shape): the edits are counted and summed', async () => {
    const call = await callOf('MultiEdit', {
      file_path: '/work/a.ts',
      edits: [
        { old_string: 'a', new_string: 'b' },
        { old_string: 'c\nd', new_string: 'c' },
      ],
    });
    expect(call.meta).toMatchObject({ file: '/work/a.ts', edits: 2, added: 1, removed: 2, churnApprox: true });
  });

  it('gives no number for an input of another shape', async () => {
    const call = await callOf('Edit', { file_path: 12, old_string: ['a'], new_string: null });
    expect(call.meta?.added).toBeUndefined();
    expect(call.meta?.file).toBeUndefined();
  });
});

describe('tool meta: Bash', () => {
  it('flags a background call and keeps the timeout', async () => {
    const call = await callOf('Bash', { command: 'npm run dev', run_in_background: true, timeout: 120000 });
    expect(call.meta).toMatchObject({ background: true, timeoutMs: 120000 });
  });

  it('counts the lines of the output and reads the exit code of a failed call', async () => {
    const ok = await callOf('Bash', { command: 'ls' }, { content: 'a\nb\nc', toolUseResult: { stdout: 'a\nb\nc', stderr: '', interrupted: false } });
    expect(ok.meta).toMatchObject({ outputLines: 3 });
    expect(ok.meta?.exitCode).toBeUndefined();
    const failed = await callOf('Bash', { command: 'false' }, { content: 'Exit code 2\nboom', isError: true });
    expect(failed.meta).toMatchObject({ exitCode: 2, outputLines: 2 });
  });

  it('does not invent an exit code when the error is not one (a hook blocked the call)', async () => {
    const call = await callOf('Bash', { command: 'rm x' }, { content: 'PreToolUse:Bash hook error: [guard] blocked', isError: true });
    expect(call.meta?.exitCode).toBeUndefined();
  });

  it('reads interrupted and the background task id of the result', async () => {
    const call = await callOf('Bash', { command: 'sleep 99', run_in_background: true }, { content: 'started', toolUseResult: { stdout: '', stderr: '', interrupted: true, backgroundTaskId: 'bg1' } });
    expect(call.meta).toMatchObject({ interrupted: true, backgroundTaskId: 'bg1', background: true });
  });

  it('an empty output has 0 lines', async () => {
    const call = await callOf('Bash', { command: 'true' }, { content: '' });
    expect(call.meta?.outputLines).toBe(0);
  });
});

describe('tool meta: Read, Grep, Glob, web, agents, MCP', () => {
  it('Read: the lines returned, where they start, the total', async () => {
    const call = await callOf('Read', { file_path: '/work/a.ts', offset: 10, limit: 50 }, { toolUseResult: { type: 'text', file: { filePath: '/work/a.ts', content: 'x', numLines: 50, startLine: 10, totalLines: 400 } } });
    expect(call.meta).toMatchObject({ file: '/work/a.ts', readLines: 50, readFrom: 10, readTotal: 400 });
  });

  it('Read of an image: the file only, flagged image', async () => {
    const call = await callOf('Read', { file_path: '/work/a.png' }, { toolUseResult: { type: 'image', file: { base64: 'AAAA', type: 'image/png', originalSize: 2048 } } });
    expect(call.meta).toMatchObject({ file: '/work/a.png', image: true });
    expect(call.meta?.readLines).toBeUndefined();
  });

  it('Grep content mode: the lines and the files; the limit that cut the answer', async () => {
    const call = await callOf('Grep', { pattern: 'todo', output_mode: 'content', head_limit: 20 }, { toolUseResult: { mode: 'content', numFiles: 0, filenames: [], content: 'x', numLines: 20, totalLines: 57, appliedLimit: 20 } });
    expect(call.meta).toMatchObject({ mode: 'content', lines: 20, limited: true });
  });

  it('Grep files mode: the files; count mode: the matches', async () => {
    const files = await callOf('Grep', { pattern: 'a' }, { toolUseResult: { mode: 'files_with_matches', filenames: ['a', 'b'], numFiles: 2, totalFiles: 2 } });
    expect(files.meta).toMatchObject({ mode: 'files_with_matches', files: 2 });
    const count = await callOf('Grep', { pattern: 'a', output_mode: 'count' }, { toolUseResult: { mode: 'count', numFiles: 0, filenames: [], content: 'x', numMatches: 31 } });
    expect(count.meta).toMatchObject({ mode: 'count', matches: 31 });
  });

  it('Glob: the files found and whether the list was cut', async () => {
    const call = await callOf('Glob', { pattern: '**/*.ts' }, { toolUseResult: { filenames: ['a'], durationMs: 12, numFiles: 100, truncated: true } });
    expect(call.meta).toMatchObject({ files: 100, truncated: true });
  });

  it('WebFetch: the host of the url, the status code and the bytes', async () => {
    const call = await callOf('WebFetch', { url: 'https://docs.example.com/a/b?q=1', prompt: 'p' }, { toolUseResult: { bytes: 5120, code: 200, codeText: 'OK', result: 'r', durationMs: 300, url: 'https://docs.example.com/a/b?q=1' } });
    expect(call.meta).toMatchObject({ host: 'docs.example.com', httpCode: 200, fetchedBytes: 5120 });
  });

  it('WebFetch with an url that is not one: no host, no guess', async () => {
    const call = await callOf('WebFetch', { url: 'not a url', prompt: 'p' });
    expect(call.meta?.host).toBeUndefined();
  });

  it('Agent: the type and the background flag (the sync result shape, with a duration or a tool count, was not seen: nothing is read from it)', async () => {
    const call = await callOf('Agent', { description: 'd', prompt: 'p', subagent_type: 'Explore', run_in_background: true }, { toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'a1', resolvedModel: 'claude-test-1' } });
    expect(call.meta).toEqual({ subagentType: 'Explore', background: true });
  });

  it('Agent without a type: no type is invented', async () => {
    const call = await callOf('Agent', { description: 'd', prompt: 'p' });
    expect(call.meta?.subagentType).toBeUndefined();
  });

  it('MCP: the server and the tool of mcp__<server>__<tool>', async () => {
    const call = await callOf('mcp__github-wadeck-app__actions_list', { method: 'list_workflow_runs' });
    expect(call.meta).toMatchObject({ mcpServer: 'github-wadeck-app', mcpTool: 'actions_list' });
  });

  it('a result with several tool_result blocks does not lend its toolUseResult to any of them', async () => {
    const lines: Obj[] = [
      assistantLine(1, 'm1', 0, toolUseBlock('t1', 'Glob', { pattern: '*' })),
      assistantLine(1, 'm1', 1, toolUseBlock('t2', 'Glob', { pattern: '*.md' })),
      toolResultLine(3, [{ id: 't1', content: 'a' }, { id: 't2', content: 'b' }], { toolUseResult: { filenames: ['a'], numFiles: 1, truncated: false } }),
    ];
    const calls = (await readAll(lines)).filter((entry): entry is ToolCallEntry => entry.kind === 'tool-call');
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.meta?.files).toBeUndefined();
    }
  });

  it('a result field of the wrong type is left out, never turned into a number', async () => {
    const call = await callOf('Glob', { pattern: '*' }, { toolUseResult: { numFiles: '12', truncated: 'yes' } });
    expect(call.meta?.files).toBeUndefined();
    expect(call.meta?.truncated).toBeUndefined();
  });

  it('a tool with nothing to say has no meta', async () => {
    const call = await callOf('ListAgents', {});
    expect(call.meta).toBeUndefined();
  });
});

describe('hook entries', () => {
  const hookLines = (): Obj[] => [
    attachmentLine(1, { type: 'hook_success', hookName: 'PreToolUse:Bash', toolUseID: 'toolu_1', hookEvent: 'PreToolUse', content: '', stdout: '{"ok":true}', stderr: '', exitCode: 0, command: 'node pre.js', durationMs: 108 }),
    attachmentLine(2, { type: 'hook_non_blocking_error', hookName: 'SessionStart:clear', toolUseID: 'u2', hookEvent: 'SessionStart', stderr: 'bad json', stdout: 'x', exitCode: 1, command: 'node start.js', durationMs: 165 }),
    attachmentLine(3, { type: 'hook_cancelled', hookName: 'UserPromptSubmit', toolUseID: 'u3', hookEvent: 'UserPromptSubmit', command: 'node p.js', durationMs: 141049, timedOut: true, timeoutMs: 30000 }),
    attachmentLine(4, { type: 'hook_system_message', content: 'a notice', hookName: 'SessionStart:clear', toolUseID: 'u4', hookEvent: 'SessionStart' }),
    attachmentLine(5, { type: 'async_hook_response', processId: 'p1', hookName: 'SessionStart:startup', hookEvent: 'SessionStart', command: 'node s.js', response: {}, stdout: 'out', stderr: '', exitCode: 0 }),
    attachmentLine(6, { type: 'total_tokens_reminder', text: 'not a hook' }),
  ];

  it('the hook attachments become hook entries; every other attachment stays skipped', async () => {
    const entries = await readAll(hookLines());
    const hooks = entries.filter((entry): entry is HookEntry => entry.kind === 'hook');
    expect(entries).toHaveLength(5);
    expect(hooks.map((hook) => hook.outcome)).toEqual(['success', 'error', 'cancelled', 'message', 'async']);
    expect(hooks[0]).toMatchObject({ hookEvent: 'PreToolUse', hookName: 'PreToolUse:Bash', toolUseId: 'toolu_1', command: 'node pre.js', durationMs: 108, exitCode: 0, output: '{"ok":true}' });
    expect(hooks[1]).toMatchObject({ outcome: 'error', exitCode: 1, stderr: 'bad json' });
    expect(hooks[2]).toMatchObject({ outcome: 'cancelled', timedOut: true, timeoutMs: 30000, durationMs: 141049 });
    expect(hooks[3]).toMatchObject({ outcome: 'message', output: 'a notice' });
  });

  it('counts the skipped attachments that are not hooks, parses no other attachment', async () => {
    const dir = makeTempDir();
    dirs.push(dir);
    const path = join(dir, 's.jsonl');
    writeText(path, jsonl(hookLines()));
    const result = await new TranscriptTailer().readNew(path);
    expect(result.state.counts.skipped).toEqual({ attachment: 1 });
    expect(result.state.counts.lines).toBe(6);
  });

  it('bounds the output of a hook', async () => {
    const entries = await readAll([attachmentLine(1, { type: 'hook_success', hookName: 'Stop', hookEvent: 'Stop', content: '', stdout: 'x'.repeat(5000), stderr: '', exitCode: 0, command: 'c', durationMs: 1 })]);
    const hook = entries[0] as HookEntry;
    expect(hook.output!.length).toBeLessThanOrEqual(500);
    expect(hook.outputTruncated).toBe(true);
  });

  it('a hook attachment of a type this model does not know is kept as outcome other', async () => {
    const entries = await readAll([attachmentLine(1, { type: 'hook_something_new', hookName: 'Stop', hookEvent: 'Stop' })]);
    expect(entries[0]).toMatchObject({ kind: 'hook', outcome: 'other', attachmentType: 'hook_something_new' });
  });
});
