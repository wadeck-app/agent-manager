// Fabricates transcripts for the fake sessions of make-fake-sessions.mjs (same session ids and cwds), for the UI checks of the log viewer.
// Usage:  node make-fake-transcripts.mjs <projectsDir>                 write every transcript (point AGENT_MANAGER_PROJECTS_DIR at <projectsDir>)
//         node make-fake-transcripts.mjs <projectsDir> --append <sessionId>   live test: finish the running tool call (once) and append an assistant line
// Session 1 (agent-manager-owner) has 2000 lines: 100 KB tool outputs, a tool call still running, thinking, markdown (with a script tag, an image and bad
// links to prove they are not rendered), unknown and unparsable lines, notices and sub-agents (finished, running, nested, fork). The others are small.
// Nothing here reads or touches a real Claude Code folder: the only path written is under <projectsDir>.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const projectsDir = args[0];
if (!projectsDir || projectsDir.startsWith('--')) {
  throw new Error('Usage: node make-fake-transcripts.mjs <projectsDir> [--append <sessionId>]');
}
const appendAt = args.indexOf('--append');

const FOLDERS = ['agent-manager', 'billing', 'project', 'docs', 'task', 'dsl-view', 'app-core', 'agent-fleet', 'queue', 'local-marketplace', 'a-very-long-folder-name-for-a-project-that-keeps-going-and-going', 'scrapers', 'legacy', 'ghost', 'unknown'];
const sessionId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cwdOf = (folder) => `C:\\Workspace_Tooling\\${folder}`;
const slug = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');

let counter = 0;
const uid = () => `11111111-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
const NOW = Date.now();

function common(n, at, extra = {}) {
  return { uuid: uid(), timestamp: new Date(at).toISOString(), userType: 'external', entrypoint: 'cli', cwd: cwdOf(FOLDERS[n - 1]), sessionId: sessionId(n), version: '2.1.325', gitBranch: 'main', ...extra };
}
const prompt = (n, at, text) => ({
  parentUuid: null, isSidechain: false, promptId: uid(), type: 'user', message: { role: 'user', content: text },
  ...common(n, at), permissionMode: 'default', promptSource: 'typed', origin: { kind: 'human' }, turnOrigin: 'human',
});
const assistant = (n, at, messageId, block, extra = {}) => ({
  parentUuid: uid(), isSidechain: false,
  message: { id: messageId, type: 'message', role: 'assistant', model: 'claude-fake-1', content: [block], stop_reason: block.type === 'tool_use' ? 'tool_use' : 'end_turn', usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 5000, output_tokens: 60 } },
  apiBlockIndex: 0, requestId: 'req_1', type: 'assistant', ...common(n, at), ...extra,
});
const text = (value) => ({ type: 'text', text: value });
const thinking = (value) => ({ type: 'thinking', thinking: value, signature: 'sig' });
const toolUse = (id, name, input) => ({ type: 'tool_use', id, name, input, caller: { type: 'direct' } });
const toolResult = (n, at, id, content, isError = false, extra = {}) => ({
  parentUuid: uid(), isSidechain: false, promptId: uid(), type: 'user',
  message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content, ...(isError ? { is_error: true } : {}) }] },
  ...common(n, at), ...extra,
});
const system = (n, at, subtype, extra) => ({ parentUuid: uid(), isSidechain: false, type: 'system', subtype, ...extra, ...common(n, at) });

const MARKDOWN = [
  '## What I found\n\nThe build fails in **two** places. Here is the plan:\n\n- fix the *import* in `src/index.ts`\n- rerun the tests\n  - unit tests first\n  - then the integration ones\n\n1. open the file\n2. change the line\n\n```ts\nexport const answer = 42; // <b>not bold</b>\n```\n\nSee [the docs](https://example.com/docs) and https://example.org/path.',
  'Raw HTML must stay text: <script>alert("xss")</script> <img src="https://example.com/track.png" onerror="alert(1)"> and an image ![tracking pixel](https://example.com/pixel.png).\n\nBad links: [click me](javascript:alert(1)) and [local](file:///C:/Windows/win.ini).\n\n> A quoted remark\n\n| name | status |\n| --- | --- |\n| build | failed |\n| tests | skipped |',
  'Done. All 42 tests pass.',
];

function bigOutput(kb) {
  const line = 'output line with some text 0123456789 abcdefghijklmnopqrstuvwxyz\n';
  return line.repeat(Math.ceil((kb * 1024) / line.length));
}

function buildMain(n, total, subagentIds) {
  const lines = [];
  const span = 5 * 3600_000;
  const stamp = (i) => NOW - span + Math.floor((span - 90_000) * (i / total));
  let turn = 0;
  while (lines.length < total - 14) {
    turn += 1;
    const i = lines.length;
    lines.push(prompt(n, stamp(i), `Turn ${turn}: please look at module ${turn} and report. ${turn % 7 === 0 ? 'Keep it short.' : ''}`));
    lines.push(assistant(n, stamp(i + 1), `msg_${turn}_t`, thinking(`Thinking about turn ${turn}. I should read the file, then run the tests and compare.`), { thinkingDurationMs: 2300 }));
    const calls = 1 + (turn % 4);
    for (let c = 0; c < calls; c++) {
      const id = `toolu_${turn}_${c}`;
      const name = ['Bash', 'Read', 'Grep', 'Edit'][(turn + c) % 4];
      const input = name === 'Bash' ? { command: `npm test -- --filter module${turn}`, description: 'Run the tests' } : name === 'Edit' ? { file_path: `src/m${turn}.ts`, old_string: 'a', new_string: 'b' } : { file_path: `src/m${turn}.ts`, pattern: `item${c}` };
      lines.push(assistant(n, stamp(i + 2 + c * 2), `msg_${turn}_${c}`, toolUse(id, name, input)));
      const content = turn % 11 === 0 && c === 0 ? bigOutput(100) : turn % 5 === 0 && c === 1 ? 'Error: command failed with exit code 1\nstack line 1\nstack line 2' : `result of ${name} for module ${turn}\nline 2\nline 3`;
      lines.push(toolResult(n, stamp(i + 3 + c * 2), id, content, turn % 5 === 0 && c === 1));
    }
    lines.push(assistant(n, stamp(i + 10), `msg_${turn}_x`, text(MARKDOWN[turn % MARKDOWN.length])));
    if (turn % 9 === 0) lines.push(system(n, stamp(i + 11), 'turn_duration', { durationMs: 41_000 + turn }));
    if (turn % 13 === 0) lines.push({ type: 'queue-operation', operation: 'enqueue', content: 'a queued follow-up typed while busy', timestamp: new Date(stamp(i + 11)).toISOString(), sessionId: sessionId(n) });
    if (turn === 20) lines.push({ type: 'brand-new-line-type', timestamp: new Date(stamp(i + 11)).toISOString(), payload: { some: 'thing' } });
    if (turn === 21) lines.push('{ this line is not JSON');
  }
  // The tail: sub-agents, a failed call, and a call that is still running.
  const t = (k) => NOW - 80_000 + k * 4000;
  lines.push(prompt(n, t(0), 'Now explore the repo with sub-agents, then run the full build.'));
  lines.push(assistant(n, t(1), 'msg_sub_1', text('Starting three sub-agents. **Explorer** reads the code, a fork reviews the plan.')));
  lines.push(assistant(n, t(2), 'msg_sub_2', toolUse('toolu_agent_main_1', 'Agent', { description: 'Explore the repo', subagent_type: 'Explore', prompt: 'Find the entry points' })));
  lines.push(assistant(n, t(3), 'msg_sub_3', toolUse('toolu_agent_main_2', 'Agent', { description: 'Write the migration', subagent_type: 'general-purpose', prompt: 'Write it' })));
  lines.push(assistant(n, t(4), 'msg_sub_4', toolUse('toolu_agent_main_3', 'Agent', { description: 'Review the plan', subagent_type: 'fork', prompt: 'Review' })));
  lines.push(toolResult(n, t(6), 'toolu_agent_main_1', 'Found 3 entry points: cli, daemon, module.', false, { toolUseResult: { agentId: subagentIds[0] } }));
  lines.push(assistant(n, t(7), 'msg_sub_5', thinking('The explorer finished. The migration agent is still running; meanwhile start the build.')));
  lines.push(assistant(n, t(8), 'msg_sub_6', toolUse('toolu_failed_1', 'Bash', { command: 'npm run build', description: 'Full build' })));
  lines.push(toolResult(n, t(9), 'toolu_failed_1', 'error TS2322: Type string is not assignable to type number\n'.repeat(20), true));
  lines.push(assistant(n, t(10), 'msg_sub_7', toolUse('toolu_running_1', 'Bash', { command: 'npm run build:all', description: 'Long build, still running' })));
  return lines;
}

function writeJsonl(file, lines) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n') + '\n');
}

function subagentLines(n, agentId, at, calls, childToolUse) {
  const lines = [{ ...prompt(n, at, 'Sub-agent task prompt'), isSidechain: true, agentId }];
  calls.forEach((call, index) => {
    lines.push({ ...assistant(n, at + 1000 * (2 * index + 1), `msg_${agentId}_${index}`, toolUse(call, 'Read', { file_path: `src/${call}.ts` })), isSidechain: true, agentId });
    lines.push({ ...toolResult(n, at + 1000 * (2 * index + 2), call, `content of ${call}`), isSidechain: true, agentId });
  });
  if (childToolUse) {
    lines.push({ ...assistant(n, at + 20_000, `msg_${agentId}_c`, toolUse(childToolUse, 'Agent', { description: 'nested worker', prompt: 'go' })), isSidechain: true, agentId });
  }
  return lines;
}

function writeSubagents(projectDir, n) {
  const dir = path.join(projectDir, sessionId(n), 'subagents');
  const ids = ['a1b2c3d4e5f60001', 'a1b2c3d4e5f60002', 'a1b2c3d4e5f60003', 'a1b2c3d4e5f60004'];
  const metas = [
    { agentType: 'Explore', description: 'Explore the repo', toolUseId: 'toolu_agent_main_1', finished: true, spawnDepth: 1 },
    { agentType: 'general-purpose', description: 'Write the migration', toolUseId: 'toolu_agent_main_2', finished: false, spawnDepth: 1 },
    { agentType: 'fork', description: 'Review the plan', toolUseId: 'toolu_agent_main_3', finished: true, spawnDepth: 1, isFork: true },
    // Nested: its toolUseId is the Agent call written inside the transcript of the second sub-agent.
    { agentType: 'general-purpose', description: 'nested worker', toolUseId: 'toolu_nested_1', finished: false, spawnDepth: 2 },
  ];
  ids.forEach((id, index) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `agent-${id}.meta.json`), JSON.stringify(metas[index]));
    const calls = [`${id}-r1`, `${id}-r2`];
    writeJsonl(path.join(dir, `agent-${id}.jsonl`), subagentLines(n, id, NOW - 70_000, calls, index === 1 ? 'toolu_nested_1' : undefined));
  });
  return ids;
}

function appendLive(file, n) {
  const content = fs.readFileSync(file, 'utf8');
  const extra = [];
  const at = Date.now();
  if (!content.includes('"tool_use_id":"toolu_running_1"')) {
    extra.push(toolResult(n, at - 500, 'toolu_running_1', 'build finished: 0 errors, 3 warnings'));
  }
  const number = (content.match(/Live append #/g) ?? []).length + 1;
  extra.push(assistant(n, at, `msg_live_${number}`, text(`Live append #${number} at ${new Date(at).toLocaleTimeString()}. The build is done.`)));
  fs.appendFileSync(file, extra.map((line) => JSON.stringify(line)).join('\n') + '\n');
  process.stdout.write(`appended ${extra.length} lines to ${file}\n`);
}

if (appendAt >= 0) {
  const wanted = args[appendAt + 1];
  if (!wanted) throw new Error('--append needs a session id');
  const n = Number(wanted.slice(-12));
  const file = path.join(projectsDir, slug(cwdOf(FOLDERS[n - 1])), `${wanted}.jsonl`);
  if (!fs.existsSync(file)) throw new Error(`No transcript at ${file}: run the script without --append first.`);
  appendLive(file, n);
} else {
  FOLDERS.forEach((folder, index) => {
    const n = index + 1;
    const projectDir = path.join(projectsDir, slug(cwdOf(folder)));
    let lines;
    if (n === 1) {
      const ids = writeSubagents(projectDir, n);
      lines = buildMain(n, 2000, ids);
    } else if (n === 14 || n === 15) {
      return; // no transcript: the log shows "No transcript yet"
    } else {
      lines = [prompt(n, NOW - 600_000, `Small session ${n}: summarise the repo.`), assistant(n, NOW - 590_000, `msg_s${n}`, text(MARKDOWN[2])), assistant(n, NOW - 580_000, `msg_s${n}b`, toolUse(`toolu_s${n}`, 'Bash', { command: 'git status', description: 'status' })), toolResult(n, NOW - 575_000, `toolu_s${n}`, 'On branch main\nnothing to commit')];
    }
    writeJsonl(path.join(projectDir, `${sessionId(n)}.jsonl`), lines);
  });
  process.stdout.write(`wrote transcripts under ${projectsDir}\n`);
}
