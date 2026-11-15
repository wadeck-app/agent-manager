// Adds ONE fake session with 70 sub-agents (1 running, 2 failed, 67 finished, a few nested) to the fake folders of make-fake-sessions.mjs and
// make-fake-transcripts.mjs, for the UI checks of the sub-agent panel. Usage: node make-fake-subagents.mjs <root>   (root = the AM_UI_ROOT of ui-dev.sh:
// it holds sessions/ and projects/). Nothing here touches a real Claude Code folder: the only paths written are under <root>.
// The session borrows the pid of a process that already runs (tasklist), like make-fake-sessions.mjs: nothing is started, nothing is killed.
// The main transcript has about 2000 lines; the 70 Agent calls are spread over it, so the first ones are far behind the newest page of the log.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
if (!root) {
  throw new Error('Usage: node make-fake-subagents.mjs <root>');
}
const sessionsDir = path.join(root, 'sessions');
const projectsDir = path.join(root, 'projects');
for (const dir of [sessionsDir, projectsDir]) {
  if (!fs.existsSync(dir)) {
    throw new Error(`${dir} does not exist: run make-fake-sessions.mjs and make-fake-transcripts.mjs first (or pass the right root).`);
  }
}

const SESSION_ID = '00000000-0000-4000-8000-000000000016';
const CWD = 'C:\\Workspace_Tooling\\swarm';
const slug = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');
const NOW = Date.now();
const MIN = 60_000;
const START = NOW - 70 * MIN;
const iso = (ms) => new Date(ms).toISOString();

// A tiny deterministic generator, so a run always makes the same session.
let seed = 20261115;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const livePids = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .map((line) => Number(line.split('","')[1]))
  .filter((pid) => Number.isInteger(pid) && pid > 4);
const pid = livePids[20] ?? livePids[livePids.length - 1];

let uidCounter = 0;
const uid = () => `20000000-0000-4000-8000-${String(++uidCounter).padStart(12, '0')}`;
const base = (at) => ({ parentUuid: uid(), isSidechain: false, uuid: uid(), timestamp: iso(at), userType: 'external', cwd: CWD, sessionId: SESSION_ID, version: '2.1.325' });
const prompt = (at, text) => ({ ...base(at), promptId: uid(), type: 'user', message: { role: 'user', content: text }, origin: { kind: 'human' }, turnOrigin: 'human' });
const assistant = (at, block) => ({
  ...base(at),
  type: 'assistant',
  message: { id: `msg_${uid()}`, type: 'message', role: 'assistant', model: 'claude-fake-1', content: [block], stop_reason: block.type === 'tool_use' ? 'tool_use' : 'end_turn', usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 5000, output_tokens: 60 } },
});
const toolResult = (at, id, content, extra = {}) => ({ ...base(at), promptId: uid(), type: 'user', message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content }] }, ...extra });

const TYPES = ['general-purpose', 'Explore', 'code-reviewer', 'test-runner', 'fork'];
const TOPICS = ['auth module', 'billing api', 'scheduler', 'log viewer', 'cli parser', 'config loader', 'tray icon', 'updater', 'queue worker', 'schema migration', 'search index', 'theme tokens'];
const VERBS = { 'general-purpose': 'Implement', Explore: 'Explore', 'code-reviewer': 'Review', 'test-runner': 'Run the tests of', fork: 'Check' };

// The 70 sub-agents: start times spread over the hour (with bursts, so several run at once), durations 20 s to 7 min.
const agents = [];
for (let n = 0; n < 70; n += 1) {
  const type = TYPES[Math.floor(rnd() * TYPES.length)];
  const topic = TOPICS[Math.floor(rnd() * TOPICS.length)];
  const startedAt = START + Math.round((n / 70) * 62 * MIN + rnd() * 40_000);
  const duration = Math.round(20_000 + rnd() * rnd() * 7 * MIN);
  agents.push({ n, id: `a${String(n + 1).padStart(3, '0')}${Math.floor(rnd() * 1e6).toString(16).padStart(5, '0')}`, type, description: `${VERBS[type]} the ${topic} (${n + 1})`, toolUseId: `toolu_sw_${String(n + 1).padStart(3, '0')}`, startedAt, endedAt: startedAt + duration, state: 'finished' });
}
// 1 running (the newest, written a few seconds ago), 2 failed (stopped by the user), the rest finished.
const running = agents[69];
running.state = 'running';
running.endedAt = NOW - 6_000;
running.startedAt = NOW - 4 * MIN;
agents[23].state = 'failed';
agents[51].state = 'failed';
// Four nested: their Agent call is written inside the transcript of their parent.
const NESTED = { 30: 12, 31: 12, 44: 40, 60: 55 };

// The main transcript: about 2000 lines, the Agent calls at their start time.
const lines = [];
lines.push(prompt(START - 5 * MIN, 'Run the whole review and migration swarm: one sub-agent per module.'));
const calls = agents.filter((agent) => NESTED[agent.n] === undefined).sort((a, b) => a.startedAt - b.startedAt);
const total = 2000;
const perCall = Math.floor(total / (calls.length + 1));
let clock = START - 4 * MIN;
const tick = () => {
  clock += 1_500;
  return clock;
};
let callIndex = 0;
for (let i = 0; i < total; ) {
  const next = calls[callIndex];
  if (next !== undefined && i >= (callIndex + 1) * perCall - perCall / 2) {
    lines.push(assistant(next.startedAt - 800, { type: 'tool_use', id: next.toolUseId, name: 'Agent', input: { description: next.description, subagent_type: next.type, prompt: `Please ${next.description.toLowerCase()}.` } }));
    lines.push(toolResult(next.endedAt, next.toolUseId, next.state === 'failed' ? 'Interrupted: the sub-agent was stopped.' : next.state === 'running' ? '' : `Done: ${next.description}.`, { toolUseResult: { agentId: next.id } }));
    if (next.state === 'running') {
      // A call still running has no result: drop the empty one just written.
      lines.pop();
    }
    callIndex += 1;
    i += 2;
    continue;
  }
  const kind = i % 6;
  if (kind === 0) {
    lines.push(assistant(tick(), { type: 'text', text: `Checking module ${i}: nothing blocking so far, moving on to the next one.` }));
  } else if (kind === 1 || kind === 2) {
    const id = `toolu_main_${i}`;
    lines.push(assistant(tick(), { type: 'tool_use', id, name: 'Bash', input: { command: `npm test -- module-${i}`, description: `Tests of module ${i}` } }));
    lines.push(toolResult(tick(), id, `PASS module-${i}\n${'ok '.repeat(20)}`));
    i += 1;
  } else if (kind === 3) {
    lines.push(prompt(tick(), `Update ${i}: keep going, report only failures.`));
  } else {
    lines.push(assistant(tick(), { type: 'text', text: `Status ${i}: ${callIndex} of 70 sub-agents started.` }));
  }
  i += 1;
}
// Keep the order by time for the lines written from clocks that moved on.
const dir = path.join(projectsDir, slug(CWD));
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${SESSION_ID}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n') + '\n');

// The sub-agents: a meta file, and a transcript whose first timestamp is the start and whose modification time is the end.
const subDir = path.join(dir, SESSION_ID, 'subagents');
fs.mkdirSync(subDir, { recursive: true });
for (const agent of agents) {
  const parent = NESTED[agent.n] === undefined ? undefined : agents[NESTED[agent.n]];
  const meta = { agentType: agent.type, description: agent.description, toolUseId: agent.toolUseId, spawnDepth: parent === undefined ? 1 : 2, ...(agent.type === 'fork' ? { isFork: true } : {}), ...(agent.state === 'finished' ? { finished: true } : {}), ...(agent.state === 'failed' ? { stoppedByUser: true } : {}) };
  fs.writeFileSync(path.join(subDir, `agent-${agent.id}.meta.json`), JSON.stringify(meta));
  const own = [{ ...base(agent.startedAt), isSidechain: true, agentId: agent.id, promptId: uid(), type: 'user', message: { role: 'user', content: [{ type: 'text', text: `Task: ${agent.description}` }] } }];
  own.push({ ...assistant(agent.startedAt + 3_000, { type: 'text', text: `Working on ${agent.description}.` }), isSidechain: true, agentId: agent.id });
  for (const child of agents.filter((other) => NESTED[other.n] === agent.n)) {
    own.push({ ...assistant(child.startedAt - 500, { type: 'tool_use', id: child.toolUseId, name: 'Agent', input: { description: child.description, prompt: 'go' } }), isSidechain: true, agentId: agent.id });
  }
  const file = path.join(subDir, `agent-${agent.id}.jsonl`);
  fs.writeFileSync(file, own.map((line) => JSON.stringify(line)).join('\n') + '\n');
  fs.utimesSync(file, new Date(agent.endedAt), new Date(agent.endedAt));
}

// The registry file of the session: busy, so it shows as working.
fs.writeFileSync(
  path.join(sessionsDir, `${pid}.json`),
  JSON.stringify({ pid, sessionId: SESSION_ID, cwd: CWD, startedAt: START - 10 * MIN, procStart: '134390780115574227', version: '2.1.325', kind: 'interactive', entrypoint: 'cli', status: 'busy', updatedAt: NOW - 8_000, statusUpdatedAt: NOW - 8_000, name: 'swarm-owner', nameSource: 'user' }),
);
const counts = agents.reduce((acc, agent) => ({ ...acc, [agent.state]: (acc[agent.state] ?? 0) + 1 }), {});
process.stdout.write(`wrote the fake session ${SESSION_ID} (pid ${pid}, ${lines.length} lines, ${agents.length} sub-agents: ${JSON.stringify(counts)}) under ${root}\n`);
