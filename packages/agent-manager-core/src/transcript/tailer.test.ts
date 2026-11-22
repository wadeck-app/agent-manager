import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { truncateSync, writeFileSync } from 'node:fs';
import { TranscriptTailer } from './tailer.js';
import { createTailerState } from './lines.js';
import { LIMITS, type Entry, type ToolCallEntry } from './types.js';
import {
  appendText,
  assistantLine,
  assistantMulti,
  attachmentLine,
  humanPrompt,
  imagePrompt,
  injectedPrompt,
  jsonl,
  makeTempDir,
  peerPrompt,
  queueLine,
  raw,
  removeDir,
  sampleConversation,
  skippedLines,
  systemLine,
  taskNotificationPrompt,
  textBlock,
  thinkingBlock,
  toolResultLine,
  toolUseBlock,
  writeText,
} from './testFixtures.js';

const dirs: string[] = [];
function tempFile(text = ''): string {
  const dir = makeTempDir();
  dirs.push(dir);
  const path = join(dir, 's.jsonl');
  writeText(path, text);
  return path;
}
afterEach(() => {
  dirs.splice(0).forEach(removeDir);
});

async function readAll(text: string): Promise<Entry[]> {
  const result = await new TranscriptTailer().readNew(tempFile(text));
  expect(result.error).toBeUndefined();
  return result.entries;
}
const of = <K extends Entry['kind']>(entries: Entry[], kind: K) => entries.filter((e): e is Extract<Entry, { kind: K }> => e.kind === kind);

describe('TranscriptTailer: kinds', () => {
  it('normalises a whole conversation: prompt, thinking, tool call with its result, text, usage, notices', async () => {
    const entries = await readAll(jsonl(sampleConversation()));
    expect(entries.map(e => e.kind)).toEqual(['user-prompt', 'thinking', 'usage', 'tool-call', 'assistant-text', 'usage', 'system-notice', 'system-notice']);
    const [prompt] = of(entries, 'user-prompt');
    expect(prompt).toMatchObject({ source: 'human', queued: false, isMeta: false, text: 'Please list the project files.', images: [] });
    const [thinking] = of(entries, 'thinking');
    expect(thinking).toMatchObject({ collapsible: true, text: 'Neutral reasoning.', durationMs: 1200 });
    const [call] = of(entries, 'tool-call');
    expect(call).toMatchObject({
      id: 'toolu_1',
      key: 'call:toolu_1',
      name: 'Bash',
      inputSummary: 'ls -la',
      status: 'ok',
      durationMs: 2000,
      resultPreview: 'file-a\nfile-b',
      resultPreviewTruncated: false,
      resultBytes: Buffer.byteLength('\u001b[32mfile-a\u001b[0m\nfile-b'),
    });
    const [notice, turn] = of(entries, 'system-notice');
    expect(notice).toMatchObject({ noticeKind: 'stop-hook', hookCount: 2, hookErrorCount: 0, preventedContinuation: false });
    expect(turn).toMatchObject({ noticeKind: 'turn-duration', durationMs: 7000, messageCount: 5 });
  });

  it('counts the usage of a message once although it is written as one line per content block', async () => {
    const entries = await readAll(
      jsonl([
        assistantLine(1, 'msg_x', 0, thinkingBlock('t'), { input: 3, output: 20, cacheRead: 500, cacheCreate: 40 }),
        assistantLine(2, 'msg_x', 1, textBlock('hello'), { input: 3, output: 20, cacheRead: 500, cacheCreate: 40 }),
        assistantLine(3, 'msg_y', 0, textBlock('again'), { input: 4, output: 5, cacheRead: 600, cacheCreate: 0 }),
      ]),
    );
    const usage = of(entries, 'usage');
    expect(usage).toHaveLength(2);
    expect(usage[0]).toMatchObject({ messageId: 'msg_x', model: 'claude-test-1', inputTokens: 3, outputTokens: 20, cacheRead: 500, cacheCreate: 40, contextEstimate: 563 });
    expect(usage[1]).toMatchObject({ messageId: 'msg_y', contextEstimate: 609 });
  });

  it('keeps the field-wise maximum usage of a message whose lines differ (output_tokens grows while streaming), in one batch', async () => {
    const entries = await readAll(
      jsonl([
        assistantLine(1, 'msg_g', 0, thinkingBlock('t'), { input: 3, output: 2, cacheRead: 500, cacheCreate: 40 }),
        assistantLine(2, 'msg_g', 1, textBlock('hello'), { input: 3, output: 30, cacheRead: 500, cacheCreate: 40 }),
        assistantLine(3, 'msg_g', 2, textBlock('again'), { input: 3, output: 10, cacheRead: 500, cacheCreate: 40 }),
      ]),
    );
    const usage = of(entries, 'usage');
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ messageId: 'msg_g', outputTokens: 30, inputTokens: 3, contextEstimate: 3 + 500 + 40 + 30 });
  });

  it('emits an update with the same key and the maximum when a later read raises the usage of a message', async () => {
    const dir = makeTempDir();
    dirs.push(dir);
    const path = join(dir, 's.jsonl');
    const first = assistantLine(1, 'msg_h', 0, thinkingBlock('t'), { input: 3, output: 2, cacheRead: 500, cacheCreate: 40 });
    writeText(path, jsonl([first]));
    const tailer = new TranscriptTailer();
    const r1 = await tailer.readNew(path);
    appendText(path, jsonl([assistantLine(2, 'msg_h', 1, textBlock('hello'), { input: 3, output: 25, cacheRead: 500, cacheCreate: 40 })]));
    const r2 = await tailer.readNew(path, r1.state);
    const before = of(r1.entries, 'usage')[0];
    const after = of(r2.entries, 'usage');
    expect(after).toHaveLength(1);
    expect(after[0]?.key).toBe(before?.key);
    expect(after[0]).toMatchObject({ outputTokens: 25, contextEstimate: 3 + 500 + 40 + 25 });
    // the entry given to the caller before is not changed
    expect(before?.outputTokens).toBe(2);
    // a third read with a lower count emits nothing
    appendText(path, jsonl([assistantLine(3, 'msg_h', 2, textBlock('x'), { input: 3, output: 5, cacheRead: 500, cacheCreate: 40 })]));
    expect(of((await tailer.readNew(path, r2.state)).entries, 'usage')).toHaveLength(0);
  });

  it('keeps every block of a message and every parallel tool call, not only content[0]', async () => {
    const entries = await readAll(
      jsonl([
        assistantMulti(1, 'msg_p', [
          thinkingBlock('plan'),
          textBlock('Running three things.'),
          toolUseBlock('toolu_a', 'Read', { file_path: '/work/shop/a.txt' }),
          toolUseBlock('toolu_b', 'Grep', { pattern: 'needle' }),
          toolUseBlock('toolu_c', 'WebFetch', { url: 'https://example.invalid/page' }),
        ]),
        toolResultLine(4, [
          { id: 'toolu_b', content: 'b-out' },
          { id: 'toolu_a', content: [{ type: 'text', text: 'a-out' }] },
          { id: 'toolu_c', content: 'failed', isError: true },
        ]),
      ]),
    );
    expect(entries.map(e => e.kind)).toEqual(['thinking', 'assistant-text', 'tool-call', 'tool-call', 'tool-call', 'usage']);
    const calls = of(entries, 'tool-call');
    expect(calls.map(c => [c.id, c.status, c.inputSummary, c.resultPreview])).toEqual([
      ['toolu_a', 'ok', '/work/shop/a.txt', 'a-out'],
      ['toolu_b', 'ok', 'needle', 'b-out'],
      ['toolu_c', 'error', 'https://example.invalid/page', 'failed'],
    ]);
  });

  it('classifies who wrote a user line: human, queued human, peer, task notification, injected, other', async () => {
    const entries = await readAll(
      jsonl([
        humanPrompt(1, 'typed'),
        humanPrompt(2, 'queued while busy', { promptSource: 'queued' }),
        peerPrompt(3, 'from another session'),
        taskNotificationPrompt(4, '<task-notification>done</task-notification>'),
        injectedPrompt(5, 'hook output'),
        injectedPrompt(6, 'caveat block', true),
        humanPrompt(7, 'no marker at all', { origin: undefined, promptSource: undefined, turnOrigin: undefined }),
      ]),
    );
    expect(of(entries, 'user-prompt').map(p => [p.source, p.queued, p.isMeta])).toEqual([
      ['human', false, false],
      ['human', true, false],
      ['peer', false, true],
      ['task-notification', false, false],
      ['injected', false, true],
      ['injected', false, true],
      ['other', false, false],
    ]);
    expect(of(entries, 'user-prompt')[2]!.peer).toEqual({ name: 'other-session', from: 'peer-session-id' });
  });

  it('records an image as type, media type and decoded size, never the base64', async () => {
    const text = jsonl([imagePrompt(1, 'look at this', 3000)]);
    const entries = await readAll(text);
    const [prompt] = of(entries, 'user-prompt');
    expect(prompt!.images).toEqual([{ type: 'image', mediaType: 'image/png', bytes: 3000 }]);
    expect(prompt!.text).toBe('look at this');
    expect(JSON.stringify(entries)).not.toContain('QUFB');
    // An image inside a tool result too.
    const withResultImage = await readAll(
      jsonl([
        assistantLine(1, 'm', 0, toolUseBlock('t_img', 'Read', { file_path: '/work/shop/shot.png' })),
        toolResultLine(2, [{ id: 't_img', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.alloc(30).toString('base64') } }] }]),
      ]),
    );
    expect(of(withResultImage, 'tool-call')[0]).toMatchObject({ status: 'ok', resultBytes: 0, resultImages: [{ type: 'image', mediaType: 'image/jpeg', bytes: 30 }] });
  });

  it('reads queue operations as the delivery signal', async () => {
    const entries = await readAll(
      jsonl([
        queueLine(1, 'enqueue', { content: '<task-notification>\nneutral\n</task-notification>' }),
        queueLine(2, 'enqueue', { content: 'plain queued text' }),
        queueLine(3, 'dequeue'),
        queueLine(4, 'remove', { content: '<cross-session-message from="x">hi</cross-session-message>', reason: 'absorbed_mid_turn', commandUuid: 'c1', deliveryId: 'd1' }),
      ]),
    );
    expect(of(entries, 'queue-operation').map(q => [q.operation, q.contentKind, q.reason, q.deliveryId])).toEqual([
      ['enqueue', 'task-notification', undefined, undefined],
      ['enqueue', 'text', undefined, undefined],
      ['dequeue', undefined, undefined, undefined],
      ['remove', 'cross-session-message', 'absorbed_mid_turn', 'd1'],
    ]);
  });

  it('reads system notices: local command, away summary, compact boundary, unknown subtype', async () => {
    const entries = await readAll(
      jsonl([
        systemLine(1, 'local_command', { content: '<local-command-stdout>ok</local-command-stdout>', level: 'info', isMeta: true, commandRun: 'ls' }),
        systemLine(2, 'away_summary', { content: 'Neutral recap.', isMeta: true }),
        systemLine(3, 'compact_boundary', { content: 'Conversation compacted', level: 'info', compactMetadata: { trigger: 'auto', preTokens: 150000 } }),
        systemLine(4, 'something_new', { level: 'error' }),
      ]),
    );
    expect(of(entries, 'system-notice').map(n => [n.noticeKind, n.subtype, n.level, n.compactTrigger, n.compactPreTokens])).toEqual([
      ['local-command', 'local_command', 'info', undefined, undefined],
      ['away-summary', 'away_summary', undefined, undefined, undefined],
      ['compact-boundary', 'compact_boundary', 'info', 'auto', 150000],
      ['other', 'something_new', 'error', undefined, undefined],
    ]);
  });

  it('bounds text, input and result, and flags every cut', async () => {
    const big = 'x'.repeat(LIMITS.textChars + 500);
    const bigInput = { command: 'run', payload: 'y'.repeat(20_000), nested: { deep: 'z'.repeat(5000) } };
    const entries = await readAll(
      jsonl([
        humanPrompt(1, big),
        assistantLine(2, 'm', 0, toolUseBlock('t1', 'Bash', bigInput)),
        toolResultLine(3, [{ id: 't1', content: 'r'.repeat(5000) }]),
      ]),
    );
    const [prompt] = of(entries, 'user-prompt');
    expect(prompt).toMatchObject({ textTruncated: true, textBytes: big.length });
    expect(prompt!.text).toHaveLength(LIMITS.textChars);
    const [call] = of(entries, 'tool-call');
    expect(call!.inputTruncated).toBe(true);
    expect(JSON.stringify(call!.input).length).toBeLessThanOrEqual(LIMITS.inputChars + 200);
    expect(call).toMatchObject({ resultPreviewTruncated: true, resultBytes: 5000 });
    expect(call!.resultPreview).toHaveLength(LIMITS.resultPreviewChars);
  });

  it('summarises the input on one line of at most 200 characters, in the order of preference', async () => {
    const entries = await readAll(
      jsonl([
        assistantLine(1, 'm', 0, toolUseBlock('a', 'Bash', { command: 'line one\nline two   with  gaps', description: 'ignored' })),
        assistantLine(2, 'm', 1, toolUseBlock('b', 'Read', { file_path: 'f'.repeat(300) })),
        assistantLine(3, 'm', 2, toolUseBlock('c', 'TodoWrite', { todos: [{ content: 'x' }] })),
        assistantLine(4, 'm', 3, toolUseBlock('d', 'Agent', { description: 'Explore the code', prompt: 'long prompt', subagent_type: 'Explore' })),
      ]),
    );
    const summaries = of(entries, 'tool-call').map(c => c.inputSummary);
    expect(summaries[0]).toBe('line one line two with gaps');
    expect(summaries[1]).toHaveLength(LIMITS.inputSummaryChars);
    expect(summaries[1]!.endsWith('...')).toBe(true);
    expect(summaries[2]).toBe('');
    expect(summaries[3]).toBe('Explore the code');
  });

  it('keeps an Agent call and exposes the agentId of its result', async () => {
    const entries = await readAll(
      jsonl([
        assistantLine(1, 'm', 0, toolUseBlock('toolu_agent', 'Agent', { description: 'Look around', prompt: 'p', subagent_type: 'Explore' })),
        toolResultLine(2, [{ id: 'toolu_agent', content: 'Async agent launched' }], { toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'a123' } }),
      ]),
    );
    expect(of(entries, 'tool-call')[0]).toMatchObject({ name: 'Agent', status: 'ok', agentId: 'a123' });
  });

  it('marks a result with is_error and keeps the denial kind', async () => {
    const entries = await readAll(
      jsonl([
        assistantLine(1, 'm', 0, toolUseBlock('t1', 'Bash', { command: 'rm x' })),
        toolResultLine(2, [{ id: 't1', content: 'Permission denied', isError: true }], { toolDenialKind: 'permission-rule' }),
      ]),
    );
    expect(of(entries, 'tool-call')[0]).toMatchObject({ status: 'error', denialKind: 'permission-rule' });
  });

  it('keeps unknown line types visible (keys only) and unknown assistant blocks', async () => {
    const entries = await readAll(
      jsonl([
        { type: 'cost-state', sessionId: 's', totalCostUSD: 1.5 },
        assistantLine(1, 'm', 0, { type: 'server_tool_use', id: 's1', name: 'web_search', input: {} }),
      ]),
    );
    const unknown = of(entries, 'unknown');
    expect(unknown.map(u => u.lineType)).toEqual(['cost-state', 'assistant.block:server_tool_use']);
    expect(unknown[0]!.keys).toEqual(['type', 'sessionId', 'totalCostUSD']);
  });

  it('reads the fork reference of a sub-agent transcript', async () => {
    const entries = await readAll(jsonl([{ type: 'fork-context-ref', agentId: 'af1', parentSessionId: 'p', parentLastUuid: 'u', contextLength: 7 }]));
    expect(entries[0]).toMatchObject({ kind: 'fork-ref', parentSessionId: 'p', parentLastUuid: 'u', contextLength: 7 });
  });
});

describe('TranscriptTailer: skipping', () => {
  it('skips the listed types without parsing and counts them per type', async () => {
    // Lines that are NOT valid JSON but start like a skipped type prove that no JSON.parse happens.
    const poisoned = ['{"type":"api-request-blob","message":{"broken', '{"parentUuid":null,"isSidechain":false,"attachment":{"broken'];
    const text = jsonl([...skippedLines(), humanPrompt(1, 'kept')]) + poisoned.join('\n') + '\n';
    const result = await new TranscriptTailer().readNew(tempFile(text));
    expect(result.entries.map(e => e.kind)).toEqual(['user-prompt']);
    expect(result.state.counts.parseErrors).toBe(0);
    expect(result.state.counts.skipped).toEqual({
      'api-request': 1,
      'api-request-blob': 2,
      'api-request-shape': 1,
      'file-history-snapshot': 1,
      'file-history-delta': 1,
      'last-prompt': 1,
      'atis-latch': 1,
      'permission-mode': 1,
      mode: 1,
      'custom-title': 1,
      'agent-name': 1,
      'ai-title': 1,
      'tools-used': 1,
      attachment: 2,
    });
    expect(result.state.counts.lines).toBe(17);
  });

  it('still counts an attachment whose key order differs (parsed, then skipped)', async () => {
    const line = { uuid: 'u', type: 'attachment', attachment: { type: 'total_tokens_reminder' } };
    const result = await new TranscriptTailer().readNew(tempFile(jsonl([line])));
    expect(result.entries).toEqual([]);
    expect(result.state.counts).toMatchObject({ lines: 1, skipped: { attachment: 1 }, unknown: 0 });
    const real = await new TranscriptTailer().readNew(tempFile(jsonl([attachmentLine(1)])));
    expect(real.state.counts.skipped).toEqual({ attachment: 1 });
  });
});

describe('TranscriptTailer: incremental reads', () => {
  it('reads only what was appended, from the stored offset', async () => {
    const path = tempFile(jsonl([humanPrompt(1, 'first')]));
    const tailer = new TranscriptTailer();
    const first = await tailer.readNew(path);
    expect(first.entries).toHaveLength(1);
    expect(first.more).toBe(false);
    const idle = await tailer.readNew(path, first.state);
    expect(idle.entries).toEqual([]);
    appendText(path, jsonl([humanPrompt(2, 'second')]));
    const second = await tailer.readNew(path, first.state);
    expect(of(second.entries, 'user-prompt').map(p => p.text)).toEqual(['second']);
    // The state passed in is not changed.
    expect(first.state.offset).toBeLessThan(second.state.offset);
  });

  it('keeps a partial last line unread and reads it once complete (also with a split multi-byte character)', async () => {
    const word = 'caf\u00e9 \u4e2d\u6587 done';
    const line = JSON.stringify(humanPrompt(1, word));
    const bytes = Buffer.from(line + '\n');
    const cut = bytes.indexOf(Buffer.from('\u4e2d')) + 1;
    const path = tempFile('');
    writeFileSync(path, bytes.subarray(0, cut));
    const tailer = new TranscriptTailer();
    const partial = await tailer.readNew(path);
    expect(partial.entries).toEqual([]);
    expect(partial.state.offset).toBe(0);
    expect(partial.more).toBe(false);
    appendText(path, bytes.subarray(cut));
    const done = await tailer.readNew(path, partial.state);
    expect(of(done.entries, 'user-prompt')[0]!.text).toBe(word);
    expect(done.entries[0]!.offset).toBe(0);
  });

  it('reads CRLF files and gives the byte offset of each line', async () => {
    const lines = [humanPrompt(1, 'one'), humanPrompt(2, 'two')];
    const text = jsonl(lines, '\r\n');
    const entries = await readAll(text);
    expect(of(entries, 'user-prompt').map(p => p.text)).toEqual(['one', 'two']);
    expect(entries[1]!.offset).toBe(Buffer.byteLength(JSON.stringify(lines[0]) + '\r\n'));
  });

  it('reads in windows with more=true until the end, whatever the window size', async () => {
    const lines = Array.from({ length: 40 }, (_, i) => humanPrompt(i, `prompt number ${i}`));
    const path = tempFile(jsonl(lines));
    const tailer = new TranscriptTailer();
    let state = createTailerState();
    const seen: string[] = [];
    let calls = 0;
    for (;;) {
      const r = await tailer.readNew(path, state, { maxBytes: 4096 });
      seen.push(...of(r.entries, 'user-prompt').map(p => p.text));
      state = r.state;
      calls += 1;
      if (!r.more) {
        break;
      }
    }
    expect(calls).toBeGreaterThan(2);
    expect(seen).toEqual(lines.map((_, i) => `prompt number ${i}`));
  });

  it('restarts and flags truncated when the file is shorter than the offset', async () => {
    const path = tempFile(jsonl([humanPrompt(1, 'a long first prompt'), humanPrompt(2, 'another long prompt')]));
    const tailer = new TranscriptTailer();
    const first = await tailer.readNew(path);
    truncateSync(path, 0);
    writeFileSync(path, jsonl([humanPrompt(3, 'new')]));
    const again = await tailer.readNew(path, first.state);
    expect(again.truncated).toBe(true);
    expect(of(again.entries, 'user-prompt').map(p => p.text)).toEqual(['new']);
    expect(again.state.counts.lines).toBe(1);
  });

  it('returns an explicit retryable error for a missing file, the state unchanged, no throw', async () => {
    const dir = makeTempDir();
    dirs.push(dir);
    const state = createTailerState();
    const result = await new TranscriptTailer().readNew(join(dir, 'nope.jsonl'), state);
    expect(result.entries).toEqual([]);
    expect(result.state).toBe(state);
    expect(result.error).toMatchObject({ code: 'missing', retry: true });
    expect(result.error!.hint).toContain('transcriptPath');
  });

  it('reports a directory read as an io error, not a throw', async () => {
    const dir = makeTempDir();
    dirs.push(dir);
    const result = await new TranscriptTailer().readNew(dir);
    expect(result.error).toBeDefined();
    expect(result.entries).toEqual([]);
  });

  it('counts a line that is not JSON and goes on', async () => {
    const entries = await readAll(jsonl([humanPrompt(1, 'a'), raw('not json at all'), raw('[1,2]'), humanPrompt(2, 'b')]));
    expect(entries.map(e => e.kind)).toEqual(['user-prompt', 'unparsable', 'unparsable', 'user-prompt']);
    expect(of(entries, 'unparsable')[1]!.reason).toContain('not an object');
  });
});

describe('TranscriptTailer: oversize lines', () => {
  it('skips a line over the limit with a marker and counts it, then reads on', async () => {
    const big = humanPrompt(2, 'z'.repeat(5000));
    const path = tempFile(jsonl([humanPrompt(1, 'before'), big, humanPrompt(3, 'after')]));
    const result = await new TranscriptTailer({ maxLineBytes: 2000 }).readNew(path);
    expect(result.entries.map(e => e.kind)).toEqual(['user-prompt', 'oversize', 'user-prompt']);
    const marker = of(result.entries, 'oversize')[0]!;
    expect(marker.bytes).toBe(Buffer.byteLength(JSON.stringify(big)));
    expect(marker.limit).toBe(2000);
    expect(result.state.counts.oversize).toBe(1);
  });

  it('skips an oversize line even when it spans several read windows, and does not count a big skipped-type line as oversize', async () => {
    const big = humanPrompt(2, 'z'.repeat(20_000));
    const blob = { type: 'api-request-blob', sessionId: 's', hash: 'h', message: { content: 'b'.repeat(20_000) } };
    const path = tempFile(jsonl([humanPrompt(1, 'before'), big, blob, humanPrompt(3, 'after')]));
    const tailer = new TranscriptTailer({ maxLineBytes: 5000 });
    let state = createTailerState();
    const kinds: string[] = [];
    for (let i = 0; i < 50; i++) {
      const r = await tailer.readNew(path, state, { maxBytes: 4096 });
      kinds.push(...r.entries.map(e => e.kind));
      state = r.state;
      if (!r.more) {
        break;
      }
    }
    expect(kinds).toEqual(['user-prompt', 'oversize', 'user-prompt']);
    expect(state.counts).toMatchObject({ oversize: 1, skipped: { 'api-request-blob': 1 } });
    expect(state.discarding).toBeUndefined();
  });

  it('keeps discarding across reads when an oversize line is still being written', async () => {
    const path = tempFile(jsonl([humanPrompt(1, 'before')]) + '{"parentUuid":null,"type":"user","message":{"content":"' + 'q'.repeat(9000));
    const tailer = new TranscriptTailer({ maxLineBytes: 3000 });
    const first = await tailer.readNew(path, undefined, { maxBytes: 4096 });
    let state = first.state;
    let guard = 0;
    while (guard++ < 10) {
      const r = await tailer.readNew(path, state, { maxBytes: 4096 });
      state = r.state;
      if (!r.more) {
        break;
      }
    }
    expect(state.discarding).toBeDefined();
    appendText(path, 'q'.repeat(10) + '"}}\n' + jsonl([humanPrompt(2, 'after')]));
    const done = await tailer.readNew(path, state);
    expect(done.entries.map(e => e.kind)).toEqual(['oversize', 'user-prompt']);
    expect(done.state.discarding).toBeUndefined();
  });
});

describe('TranscriptTailer: pairing across reads', () => {
  it('completes a call in a later read with an update entry of the same key, without touching the earlier entry', async () => {
    const path = tempFile(jsonl([humanPrompt(1, 'go'), assistantLine(2, 'm', 0, toolUseBlock('toolu_late', 'Bash', { command: 'sleep 5' }))]));
    const tailer = new TranscriptTailer();
    const first = await tailer.readNew(path);
    const running = of(first.entries, 'tool-call')[0] as ToolCallEntry;
    expect(running).toMatchObject({ status: 'running', startedAt: Date.UTC(2026, 10, 15, 10, 0, 2) });
    expect(Object.keys(first.state.pending)).toEqual(['toolu_late']);
    appendText(path, jsonl([toolResultLine(8, [{ id: 'toolu_late', content: 'done' }])]));
    const second = await tailer.readNew(path, first.state);
    const update = of(second.entries, 'tool-call')[0] as ToolCallEntry;
    expect(update).toMatchObject({ key: running.key, status: 'ok', durationMs: 6000, resultPreview: 'done' });
    expect(running.status).toBe('running');
    expect(second.state.pending).toEqual({});
  });

  it('survives a state persisted as JSON between reads', async () => {
    const path = tempFile(jsonl([assistantLine(1, 'm', 0, toolUseBlock('toolu_j', 'Read', { file_path: '/work/shop/a' }))]));
    const tailer = new TranscriptTailer();
    const first = await tailer.readNew(path);
    const revived = JSON.parse(JSON.stringify(first.state));
    appendText(path, jsonl([toolResultLine(3, [{ id: 'toolu_j', content: 'ok' }])]));
    const second = await tailer.readNew(path, revived);
    expect(of(second.entries, 'tool-call')[0]).toMatchObject({ id: 'toolu_j', status: 'ok', inputSummary: '/work/shop/a' });
  });

  it('emits a result whose call was never seen as an orphan', async () => {
    const entries = await readAll(jsonl([toolResultLine(3, [{ id: 'toolu_gone', content: 'late' }])]));
    expect(of(entries, 'tool-call')[0]).toMatchObject({ id: 'toolu_gone', name: '(unknown)', orphan: true, status: 'ok', resultPreview: 'late' });
  });

  it('bounds the pending list: the oldest calls become unknown', async () => {
    const lines = Array.from({ length: LIMITS.maxPendingCalls + 3 }, (_, i) => assistantLine(i, `m${i}`, 0, toolUseBlock(`t${i}`, 'Bash', { command: `c${i}` })));
    const path = tempFile(jsonl(lines));
    const tailer = new TranscriptTailer();
    const first = await tailer.readNew(path);
    expect(Object.keys(first.state.pending)).toHaveLength(LIMITS.maxPendingCalls);
    expect(of(first.entries, 'tool-call').filter(c => c.status === 'unknown').map(c => c.id)).toEqual(['t0', 't1', 't2']);
  });

  it('stamps ownerAgentId on the entries of a sub-agent tailer', async () => {
    const path = tempFile(jsonl([assistantLine(1, 'm', 0, textBlock('hi'))]));
    const result = await new TranscriptTailer({ agentId: 'a1' }).readNew(path);
    expect(result.entries[0]).toMatchObject({ kind: 'assistant-text', ownerAgentId: 'a1' });
  });
});
