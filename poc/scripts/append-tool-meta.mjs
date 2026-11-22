// Dev-only, THROWAWAY: appends tool calls with the SHAPES of real results (toolUseResult, structuredPatch, hook attachments; see probe-tool-meta*.mjs) to one fake
// transcript made by make-fake-transcripts.mjs, to look at the tool meta chips and the log filters in the browser.
// Usage: node append-tool-meta.mjs <transcript.jsonl>      (only a file under the temp folder of the fake UI data: it appends, it never reads a real folder)
import fs from 'node:fs';

const file = process.argv[2];
if (!file || !file.includes('am-ui')) {
  throw new Error('Usage: node append-tool-meta.mjs <transcript.jsonl of the FAKE ui data (the path must contain "am-ui")>');
}
const SID = '00000000-0000-4000-8000-000000000002';
let n = 0;
const uid = () => `22222222-0000-4000-8000-${String(++n).padStart(12, '0')}`;
let at = Date.now() - 120_000;
const tick = (ms) => (at += ms);
const common = () => ({ uuid: uid(), timestamp: new Date(at).toISOString(), userType: 'external', entrypoint: 'cli', cwd: 'C:\\Workspace_Tooling\\billing', sessionId: SID, version: '2.1.325', gitBranch: 'main' });
const out = [];
const assistant = (block) => out.push({ parentUuid: uid(), isSidechain: false, message: { id: `msg_${n}`, type: 'message', role: 'assistant', model: 'claude-fake-1', content: [block], stop_reason: 'tool_use', usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 5000, output_tokens: 60 } }, apiBlockIndex: 0, requestId: 'req_1', type: 'assistant', ...common() });
const call = (id, name, input, ms = 1) => {
  tick(ms);
  assistant({ type: 'tool_use', id, name, input, caller: { type: 'direct' } });
};
const result = (id, content, toolUseResult, isError = false, ms = 400) => {
  tick(ms);
  out.push({ parentUuid: uid(), isSidechain: false, promptId: uid(), type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content, ...(isError ? { is_error: true } : {}) }] }, ...common(), ...(toolUseResult === undefined ? {} : { toolUseResult }) });
};
const hook = (type, hookName, hookEvent, toolUseID, extra = {}) => {
  tick(1);
  out.push({ parentUuid: uid(), isSidechain: false, attachment: { type, hookName, toolUseID, hookEvent, content: '', stdout: '{"ok":true}', stderr: '', exitCode: 0, command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/pre-tool-use.js"', durationMs: 90, ...extra }, type: 'attachment', ...common() });
};
const text = (t) => {
  tick(500);
  out.push({ parentUuid: uid(), isSidechain: false, message: { id: `msg_${n}`, type: 'message', role: 'assistant', model: 'claude-fake-1', content: [{ type: 'text', text: t }], stop_reason: 'end_turn', usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 5000, output_tokens: 60 } }, apiBlockIndex: 0, requestId: 'req_1', type: 'assistant', ...common() });
};
const lines = (count) => Array.from({ length: count }, (_, i) => `test line ${i + 1} ok`).join('\n');

tick(0);
out.push({ parentUuid: null, isSidechain: false, promptId: uid(), type: 'user', message: { role: 'user', content: 'Fix the invoice rounding, run the tests and check the docs.' }, ...common(), permissionMode: 'default', promptSource: 'typed', origin: { kind: 'human' }, turnOrigin: 'human' });

// Group 1: edits, a write, a read, greps, tests; hooks written between the calls.
call('toolu_m1', 'Edit', { file_path: 'C:\\Workspace_Tooling\\billing\\src\\invoice.ts', old_string: 'a\nb\nc', new_string: 'a\nB\nc\nd', replace_all: false });
hook('hook_success', 'PreToolUse:Edit', 'PreToolUse', 'toolu_m1');
result('toolu_m1', 'The file has been updated successfully.', { filePath: 'src/invoice.ts', oldString: 'b', newString: 'B', originalFile: 'x', structuredPatch: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, lines: [' a', '-b', '+B', ' c', '+d'] }], userModified: false, replaceAll: false });
hook('hook_success', 'PostToolUse:Edit', 'PostToolUse', 'toolu_m1');
call('toolu_m2', 'Edit', { file_path: 'C:\\Workspace_Tooling\\billing\\src\\round.ts', old_string: 'x', new_string: 'y\nz' });
result('toolu_m2', 'The file has been updated successfully.', { filePath: 'src/round.ts', structuredPatch: [{ oldStart: 4, oldLines: 1, newStart: 4, newLines: 2, lines: ['-x', '+y', '+z'] }], userModified: false, replaceAll: false });
call('toolu_m3', 'Write', { file_path: 'C:\\Workspace_Tooling\\billing\\src\\money.ts', content: 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n' });
result('toolu_m3', 'File created successfully at: src/money.ts', { type: 'create', filePath: 'src/money.ts', content: 'x', structuredPatch: [], originalFile: null, userModified: false });
call('toolu_m4', 'Read', { file_path: 'C:\\Workspace_Tooling\\billing\\README.md', offset: 10, limit: 50 });
result('toolu_m4', lines(50), { type: 'text', file: { filePath: 'README.md', content: 'x', numLines: 50, startLine: 10, totalLines: 400 } });
call('toolu_m5', 'Grep', { pattern: 'round', path: 'src', output_mode: 'files_with_matches' });
result('toolu_m5', 'src/a.ts\nsrc/b.ts\nsrc/c.ts', { mode: 'files_with_matches', filenames: ['a', 'b', 'c'], numFiles: 3, totalFiles: 3 });
call('toolu_m6', 'Bash', { command: 'npm test', description: 'Run the tests' });
hook('hook_success', 'PreToolUse:Bash', 'PreToolUse', 'toolu_m6');
result('toolu_m6', lines(40), { stdout: lines(40), stderr: '', interrupted: false, isImage: false, noOutputExpected: false }, false, 14_200);
text('Edits done, tests are green. Now a failing script and a fetch.');

// Single calls: a failing Bash (exit code), a fetch, a background agent, an MCP call, a failed edit.
call('toolu_m7', 'Bash', { command: 'node scripts/check.js --strict', description: 'Strict check' });
result('toolu_m7', 'Exit code 2\nstrict check failed: 3 problems', undefined, true, 2300);
text('The strict check fails; looking at the docs.');
call('toolu_m8', 'WebFetch', { url: 'https://docs.example.com/rounding/modes?x=1', prompt: 'summarise' });
result('toolu_m8', 'Rounding modes: half-even, half-up.', { bytes: 51200, code: 200, codeText: 'OK', result: 'x', durationMs: 900, url: 'https://docs.example.com/rounding/modes?x=1' }, false, 900);
call('toolu_m9', 'Agent', { description: 'Audit rounding', prompt: 'Audit the rounding code', subagent_type: 'Explore', run_in_background: true });
result('toolu_m9', 'Async agent launched', { isAsync: true, status: 'async_launched', agentId: 'af00dbee0000000000', description: 'Audit rounding', prompt: 'x', outputFile: 'x', canReadOutputFile: true, canContinueAgent: true }, false, 50);
call('toolu_m10', 'mcp__github-wadeck__actions_list', { method: 'list_workflow_runs', owner: 'wadeck', repo: 'billing' });
result('toolu_m10', [{ type: 'text', text: '{"total_count":0}' }], [{ type: 'text', text: '{}' }], false, 700);
call('toolu_m11', 'Edit', { file_path: 'C:\\Workspace_Tooling\\billing\\src\\gone.ts', old_string: 'nope', new_string: 'yes' });
result('toolu_m11', 'String to replace not found in file.', 'Error: String to replace not found in file.', true, 120);
out.push({ parentUuid: uid(), isSidechain: false, type: 'user', message: { role: 'user', content: '<cross-session-message from="docs-writer">Docs are ready, rounding section is in docs/rounding.md</cross-session-message>' }, isMeta: true, promptSource: 'system', origin: { kind: 'peer', from: 'peer-id', msg_id: 'm1', name: 'docs-writer' }, turnOrigin: 'peer', ...common() });
call('toolu_m12', 'SendMessage', { to: 'docs-writer', message: 'Thanks, merged.', summary: 'ack' });
result('toolu_m12', 'Message sent', { success: true, message: 'sent', display: 'x', msg_id: 'mm' }, false, 60);
hook('hook_success', 'Stop', 'Stop', uid(), { durationMs: 415 });
hook('hook_non_blocking_error', 'SessionStart:clear', 'SessionStart', uid(), { stderr: 'Hook output looks like a JSON object but failed validation', exitCode: 1 });
text('All done: rounding fixed, tests green, docs checked.');

fs.appendFileSync(file, out.map((line) => JSON.stringify(line)).join('\n') + '\n');
console.log(`appended ${out.length} lines to ${file}`);
