// Dev-only, bounded performance check of the transcript tailer (single process, ONE run, about 20 MB, no loop).
// Generates a synthetic transcript (neutral text, real shapes) in its own folder under the OS temp dir, reads it once in 1 MiB windows, prints the
// parse time and the peak RSS, then removes only its own folder (if removal fails the path is printed). Needs `npm run build`.
// Usage: node scripts/perf-transcript.mjs [--mb 20]
import { closeSync, existsSync, mkdtempSync, openSync, rmSync, statSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mbArg = process.argv.indexOf('--mb');
const targetBytes = (mbArg >= 0 ? Number(process.argv[mbArg + 1]) : 20) * 1024 * 1024;
const here = dirname(fileURLToPath(import.meta.url));
const distIndex = join(here, '..', 'dist', 'transcript', 'index.js');
if (!existsSync(distIndex)) {
  console.error('ERROR: ' + distIndex + ' not found. Run `npm run build` first.');
  process.exit(2);
}
const { TranscriptTailer, createTailerState } = await import(pathToFileURL(distIndex).href);

const SESSION = '11111111-2222-4333-8444-555555555555';
let n = 0;
const uid = () => '00000000-0000-4000-8000-' + String(++n).padStart(12, '0');
const ts = i => new Date(Date.UTC(2026, 10, 15, 10, 0, 0) + i * 1000).toISOString();
const common = i => ({ uuid: uid(), timestamp: ts(i), userType: 'external', entrypoint: 'cli', cwd: '/work/shop', sessionId: SESSION, version: '2.1.999', gitBranch: 'main' });
const filler = len => 'neutral text '.repeat(Math.ceil(len / 13)).slice(0, len);

// One "turn": 1 prompt, thinking, 3 parallel tool calls, their results, a text answer, plus the lines Claude Code writes around them.
function turn(i) {
  const m = 'msg_' + i;
  const t = k => 'toolu_' + i + '_' + k;
  const usage = { input_tokens: 5, cache_creation_input_tokens: 200, cache_read_input_tokens: 30000 + i, output_tokens: 300 };
  const a = (idx, block, extra = {}) => ({ parentUuid: uid(), isSidechain: false, message: { id: m, type: 'message', role: 'assistant', model: 'claude-test-1', content: [block], stop_reason: 'tool_use', usage }, apiBlockIndex: idx, requestId: 'req_' + i, type: 'assistant', ...common(i), ...extra });
  return [
    { type: 'mode', mode: 'normal', sessionId: SESSION },
    { type: 'permission-mode', permissionMode: 'default', sessionId: SESSION },
    { type: 'api-request', sessionId: SESSION, id: uid(), timestamp: ts(i), version: '2.1.999', params: { filler: filler(2000) } },
    { type: 'api-request-blob', sessionId: SESSION, hash: 'h' + i, message: { role: 'user', content: filler(i % 25 === 0 ? 400000 : 20000) } },
    { parentUuid: null, isSidechain: false, promptId: uid(), type: 'user', message: { role: 'user', content: 'Prompt ' + i + ' ' + filler(300) }, ...common(i), origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' },
    { parentUuid: uid(), isSidechain: false, attachment: { type: 'hook_success', content: filler(1500) }, type: 'attachment', ...common(i) },
    a(0, { type: 'thinking', thinking: filler(1500), signature: 's' }, { thinkingDurationMs: 900 }),
    a(1, { type: 'tool_use', id: t(1), name: 'Bash', input: { command: 'echo ' + i, description: 'Echo' } }),
    a(2, { type: 'tool_use', id: t(2), name: 'Read', input: { file_path: '/work/shop/file' + i + '.ts' } }),
    a(3, { type: 'tool_use', id: t(3), name: 'Grep', input: { pattern: 'needle' + i, path: '/work/shop' } }),
    { parentUuid: uid(), isSidechain: false, type: 'user', message: { role: 'user', content: [1, 2, 3].map(k => ({ tool_use_id: t(k), type: 'tool_result', content: '\u001b[32m' + filler(k === 2 ? 6000 : 400) + '\u001b[0m' })) }, ...common(i + 1), toolUseResult: { stdout: 'x' } },
    a(0, { type: 'text', text: 'Answer ' + i + ' ' + filler(800) }, {}),
    { parentUuid: uid(), isSidechain: false, type: 'system', subtype: 'turn_duration', durationMs: 5000, messageCount: 7, isMeta: true, ...common(i + 2) },
    { type: 'queue-operation', operation: 'enqueue', timestamp: ts(i), sessionId: SESSION, content: 'queued text ' + i },
    { type: 'queue-operation', operation: 'dequeue', timestamp: ts(i), sessionId: SESSION },
  ];
}

const dir = mkdtempSync(join(tmpdir(), 'am-perf-'));
const file = join(dir, SESSION + '.jsonl');
let exitCode = 0;
try {
  const fd = openSync(file, 'w');
  let written = 0;
  let lineCount = 0;
  for (let i = 0; written < targetBytes; i++) {
    const text = turn(i).map(l => JSON.stringify(l) + '\n').join('');
    lineCount += 15;
    written += writeSync(fd, text);
  }
  closeSync(fd);
  const size = statSync(file).size;
  const rssBefore = process.resourceUsage().maxRSS / 1024;
  console.log('generated ' + (size / 1048576).toFixed(1) + ' MiB, ' + lineCount + ' lines, in ' + file);
  console.log('peak RSS after generation (baseline): ' + rssBefore.toFixed(0) + ' MiB');

  const tailer = new TranscriptTailer();
  let state = createTailerState();
  const kinds = {};
  let reads = 0;
  const t0 = performance.now();
  for (;;) {
    const r = await tailer.readNew(file, state, { maxBytes: 1048576 });
    if (r.error) {
      throw new Error('read failed: ' + r.error.message);
    }
    for (const e of r.entries) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    state = r.state;
    reads++;
    if (!r.more) break;
  }
  const ms = performance.now() - t0;
  const rssPeak = process.resourceUsage().maxRSS / 1024;
  console.log('read in 1 MiB windows: ' + reads + ' reads, ' + ms.toFixed(0) + ' ms, ' + (size / 1048576 / (ms / 1000)).toFixed(0) + ' MiB/s');
  console.log('peak RSS: ' + rssPeak.toFixed(0) + ' MiB (growth over baseline ' + (rssPeak - rssBefore).toFixed(0) + ' MiB)');
  console.log('lines ' + state.counts.lines + ' (written ' + lineCount + '), skipped ' + JSON.stringify(state.counts.skipped) + ', oversize ' + state.counts.oversize + ', parseErrors ' + state.counts.parseErrors);
  console.log('entries ' + JSON.stringify(kinds));
  if (state.counts.lines !== lineCount || state.offset !== size) {
    console.error('MISMATCH: lines read ' + state.counts.lines + ' vs written ' + lineCount + ', offset ' + state.offset + ' vs size ' + size);
    exitCode = 1;
  }
} finally {
  try {
    rmSync(dir, { recursive: true, force: true });
    console.log('removed ' + dir);
  } catch (error) {
    console.error('could not remove ' + dir + ' (' + error.message + '): delete it by hand');
  }
}
process.exit(exitCode);
