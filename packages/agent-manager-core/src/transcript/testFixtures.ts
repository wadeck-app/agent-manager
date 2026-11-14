import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Test-only (excluded from the build). Builds transcript lines with the SHAPES observed on real Claude Code 2.1.3xx transcripts (key order included,
 * the prefix skip depends on it) and neutral invented text: no real user text is copied here.
 */

export const SESSION_ID = '11111111-2222-4333-8444-555555555555';

let counter = 0;

/** Deterministic uuid-like ids, unique per call. */
export function uid(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

/** ISO timestamp `seconds` after a fixed start (so durations are exact). */
export function ts(seconds: number): string {
  return new Date(Date.UTC(2026, 10, 15, 10, 0, 0) + seconds * 1000).toISOString();
}

type Obj = Record<string, unknown>;

function common(seconds: number, sidechain = false): Obj {
  return {
    uuid: uid(),
    timestamp: ts(seconds),
    userType: 'external',
    entrypoint: 'cli',
    cwd: '/work/shop',
    sessionId: SESSION_ID,
    version: '2.1.999',
    gitBranch: 'main',
    isSidechain: sidechain,
  };
}

export function humanPrompt(seconds: number, text: string, extra: Obj = {}): Obj {
  return {
    parentUuid: null,
    isSidechain: false,
    promptId: uid(),
    type: 'user',
    message: { role: 'user', content: text },
    uuid: uid(),
    timestamp: ts(seconds),
    userType: 'external',
    entrypoint: 'cli',
    cwd: '/work/shop',
    sessionId: SESSION_ID,
    version: '2.1.999',
    gitBranch: 'main',
    permissionMode: 'default',
    promptSource: 'typed',
    origin: { kind: 'human' },
    turnOrigin: 'human',
    turnPosition: { promptIndex: 1, turnIndex: 0 },
    ...extra,
  };
}

export function peerPrompt(seconds: number, text: string): Obj {
  return humanPrompt(seconds, text, {
    promptSource: 'system',
    origin: { kind: 'peer', from: 'peer-session-id', msg_id: 'm1', name: 'other-session', fromMode: 'interactive', body: text },
    turnOrigin: 'peer',
    isMeta: true,
  });
}

export function taskNotificationPrompt(seconds: number, text: string): Obj {
  return humanPrompt(seconds, text, {
    promptSource: 'system',
    origin: { kind: 'task-notification', producer: 'bash', runId: 'r1' },
    turnOrigin: 'task_notification',
  });
}

/** A line injected by the harness (hook output, local command caveat): isMeta, no origin. */
export function injectedPrompt(seconds: number, text: string, asBlocks = false): Obj {
  return {
    parentUuid: uid(),
    isSidechain: false,
    promptId: uid(),
    type: 'user',
    message: { role: 'user', content: asBlocks ? [{ type: 'text', text }] : text },
    isMeta: true,
    uuid: uid(),
    timestamp: ts(seconds),
    userType: 'external',
    entrypoint: 'cli',
    cwd: '/work/shop',
    sessionId: SESSION_ID,
    version: '2.1.999',
    gitBranch: 'main',
  };
}

/** A prompt with an image: the base64 payload is `bytes` bytes of 'A' encoded. */
export function imagePrompt(seconds: number, text: string, bytes: number): Obj {
  const data = Buffer.alloc(bytes, 65).toString('base64');
  return humanPrompt(seconds, text, {
    message: { role: 'user', content: [{ type: 'text', text }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data } }] },
    imagePasteIds: [1],
  });
}

export type Usage = { input?: number; output?: number; cacheRead?: number; cacheCreate?: number };

function usageOf(u: Usage): Obj {
  return {
    input_tokens: u.input ?? 10,
    cache_creation_input_tokens: u.cacheCreate ?? 100,
    cache_read_input_tokens: u.cacheRead ?? 1000,
    output_tokens: u.output ?? 50,
    service_tier: 'standard',
  };
}

/** One content block per line, like Claude Code 2.1.3xx writes it (`apiBlockIndex`); every line of the message repeats the usage. */
export function assistantLine(seconds: number, messageId: string, blockIndex: number, block: Obj, usage: Usage = {}, extra: Obj = {}): Obj {
  return {
    parentUuid: uid(),
    isSidechain: false,
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      model: 'claude-test-1',
      content: [block],
      stop_reason: block.type === 'tool_use' ? 'tool_use' : 'end_turn',
      usage: usageOf(usage),
    },
    apiBlockIndex: blockIndex,
    requestId: 'req_1',
    type: 'assistant',
    uuid: uid(),
    timestamp: ts(seconds),
    ...extra,
    userType: 'external',
    entrypoint: 'cli',
    cwd: '/work/shop',
    sessionId: SESSION_ID,
    version: '2.1.999',
    gitBranch: 'main',
  };
}

/** Several blocks in one line (older writers; parallel tool calls). */
export function assistantMulti(seconds: number, messageId: string, blocks: Obj[], usage: Usage = {}): Obj {
  const line = assistantLine(seconds, messageId, 0, blocks[0]!, usage);
  (line.message as Obj).content = blocks;
  return line;
}

export const textBlock = (text: string): Obj => ({ type: 'text', text });
export const thinkingBlock = (text: string): Obj => ({ type: 'thinking', thinking: text, signature: 'sig' });
export const toolUseBlock = (id: string, name: string, input: Obj): Obj => ({ type: 'tool_use', id, name, input, caller: { type: 'direct' } });

export function toolResultLine(seconds: number, results: { id: string; content: unknown; isError?: boolean }[], extra: Obj = {}): Obj {
  return {
    parentUuid: uid(),
    isSidechain: false,
    promptId: uid(),
    type: 'user',
    message: {
      role: 'user',
      content: results.map(r => ({
        tool_use_id: r.id,
        type: 'tool_result',
        content: r.content,
        ...(r.isError === true ? { is_error: true } : {}),
      })),
    },
    uuid: uid(),
    timestamp: ts(seconds),
    userType: 'external',
    entrypoint: 'cli',
    cwd: '/work/shop',
    sessionId: SESSION_ID,
    version: '2.1.999',
    gitBranch: 'main',
    ...extra,
  };
}

export function systemLine(seconds: number, subtype: string, extra: Obj = {}): Obj {
  return { parentUuid: uid(), isSidechain: false, type: 'system', subtype, ...extra, timestamp: ts(seconds), uuid: uid(), userType: 'external', entrypoint: 'cli', cwd: '/work/shop', sessionId: SESSION_ID, version: '2.1.999', gitBranch: 'main' };
}

export function queueLine(seconds: number, operation: string, extra: Obj = {}): Obj {
  return { type: 'queue-operation', operation, timestamp: ts(seconds), sessionId: SESSION_ID, ...extra };
}

/** The key order of the real line: the type comes AFTER the attachment object. */
export function attachmentLine(seconds: number, payload: Obj = { type: 'hook_success', hookName: 'Stop', content: 'neutral hook output' }): Obj {
  return { parentUuid: uid(), isSidechain: false, attachment: payload, type: 'attachment', uuid: uid(), timestamp: ts(seconds), userType: 'external', entrypoint: 'cli', cwd: '/work/shop', sessionId: SESSION_ID, version: '2.1.999', gitBranch: 'main' };
}

/** Lines of the types skipped by prefix, in their real key order. */
export function skippedLines(): Obj[] {
  return [
    { type: 'api-request', sessionId: SESSION_ID, id: uid(), timestamp: ts(0), version: '2.1.999', querySource: 'repl_main_thread', params: { model: 'x' } },
    { type: 'api-request-blob', sessionId: SESSION_ID, hash: 'abc', message: { role: 'user', content: 'neutral blob text' } },
    { type: 'api-request-shape', sessionId: SESSION_ID, shapeHash: 'h', timestamp: ts(0), version: '2.1.999', shape: {} },
    { type: 'file-history-snapshot', messageId: uid(), snapshot: { trackedFileBackups: {} }, isSnapshotUpdate: false },
    { type: 'file-history-delta', messageId: uid(), snapshotMessageId: uid(), trackingPath: 'a.txt', backup: null, timestamp: ts(0) },
    { type: 'last-prompt', lastPrompt: 'neutral', leafUuid: uid(), sessionId: SESSION_ID },
    { type: 'atis-latch', atis: true, sessionId: SESSION_ID },
    { type: 'permission-mode', permissionMode: 'default', sessionId: SESSION_ID },
    { type: 'mode', mode: 'normal', sessionId: SESSION_ID },
    { type: 'custom-title', customTitle: 'neutral title', sessionId: SESSION_ID },
    { type: 'agent-name', agentName: 'neutral-name', sessionId: SESSION_ID },
    { type: 'ai-title', aiTitle: 'neutral title', sessionId: SESSION_ID },
    { type: 'tools-used', tools: ['Bash'], sessionId: SESSION_ID },
    attachmentLine(0),
  ];
}

export function forkRefLine(agentId: string): Obj {
  return { type: 'fork-context-ref', agentId, parentSessionId: SESSION_ID, parentLastUuid: uid(), contextLength: 12 };
}

/** A sub-agent line (`agentId` set, isSidechain true). */
export function subagentPrompt(seconds: number, agentId: string, text: string): Obj {
  return { ...humanPrompt(seconds, text, { origin: undefined, promptSource: undefined, turnOrigin: undefined, permissionMode: undefined, turnPosition: undefined }), isSidechain: true, agentId };
}

/** A line written as is (not JSON, or JSON with a special layout). */
export type RawLine = { raw: string };

export const raw = (text: string): RawLine => ({ raw: text });

function isRaw(line: Obj | RawLine): line is RawLine {
  return typeof (line as RawLine).raw === 'string' && Object.keys(line).length === 1;
}

/** Lines to JSONL text. */
export function jsonl(lines: (Obj | RawLine)[], eol = '\n'): string {
  return lines.map(l => (isRaw(l) ? l.raw : JSON.stringify(l)) + eol).join('');
}

export function makeTempDir(prefix = 'am-transcript-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export function writeText(path: string, text: string | Buffer): void {
  writeFileSync(path, text);
}

export function appendText(path: string, text: string | Buffer): void {
  appendFileSync(path, text);
}

export function writeMeta(dir: string, agentId: string, meta: Obj): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `agent-${agentId}.meta.json`), JSON.stringify(meta));
}

/** Builds `<projects>/<folder>/<sessionId>.jsonl` and returns the paths. */
export function makeProject(folder: string, lines: (Obj | RawLine)[]): { projectsDir: string; projectDir: string; path: string; cleanup: () => void } {
  const projectsDir = makeTempDir();
  const projectDir = join(projectsDir, folder);
  mkdirSync(projectDir, { recursive: true });
  const path = join(projectDir, `${SESSION_ID}.jsonl`);
  writeFileSync(path, jsonl(lines));
  return { projectsDir, projectDir, path, cleanup: () => removeDir(projectsDir) };
}

/** A complete neutral conversation covering every kind: used by the tests and by the performance check. */
export function sampleConversation(): Obj[] {
  const lines: Obj[] = [
    ...skippedLines(),
    humanPrompt(1, 'Please list the project files.'),
    assistantLine(2, 'msg_a', 0, thinkingBlock('Neutral reasoning.'), {}, { thinkingDurationMs: 1200 }),
    assistantLine(3, 'msg_a', 1, toolUseBlock('toolu_1', 'Bash', { command: 'ls -la', description: 'List files' })),
    toolResultLine(5, [{ id: 'toolu_1', content: '\u001b[32mfile-a\u001b[0m\nfile-b' }], { toolUseResult: { stdout: 'file-a', stderr: '', interrupted: false } }),
    assistantLine(6, 'msg_b', 0, textBlock('Two files found.'), { output: 80 }),
    systemLine(7, 'stop_hook_summary', { hookCount: 2, hookInfos: [{ command: 'node a.js', durationMs: 10 }], hookErrors: [], hookAdditionalContext: [], preventedContinuation: false, stopReason: '', hasOutput: false, level: 'suggestion', toolUseID: 'x' }),
    systemLine(8, 'turn_duration', { durationMs: 7000, messageCount: 5, isMeta: true }),
  ];
  return lines;
}
