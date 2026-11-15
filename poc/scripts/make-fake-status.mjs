// One fake session for the status info row of the detail header (model, model change, context, tokens, branch, role). Usage: node make-fake-status.mjs <root> <repoDir>
// root = the AM_UI_ROOT of ui-dev.sh (it holds sessions/ and projects/, made by make-fake-sessions.mjs and make-fake-transcripts.mjs); repoDir = an EMPTY folder of
// yours (temp): the session's working directory. It becomes a git repository on branch "main" (git init, no commit), and gets the role file the status line reads
// (<repoDir>/.claude/session/roles/<sessionId>). The w-guardrails bypass state file is NOT written here (a hook blocks scripts that write it): the bypass chips are
// covered by jsdom tests, and the isolated app shows none. Nothing outside <root> and <repoDir> is written; the session borrows the pid of a process that already
// runs (tasklist), nothing is started or killed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [root, repoDir] = process.argv.slice(2);
if (!root || !repoDir) {
  throw new Error('Usage: node make-fake-status.mjs <root> <repoDir>');
}
const sessionsDir = path.join(root, 'sessions');
const projectsDir = path.join(root, 'projects');
for (const dir of [sessionsDir, projectsDir]) {
  if (!fs.existsSync(dir)) {
    throw new Error(`${dir} does not exist: run make-fake-sessions.mjs and make-fake-transcripts.mjs first.`);
  }
}
fs.mkdirSync(repoDir, { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'main', repoDir], { windowsHide: true });

const SESSION_ID = '00000000-0000-4000-8000-000000000017';
const cwd = path.resolve(repoDir);
const slug = (value) => value.replace(/[^A-Za-z0-9]/g, '-');
const NOW = Date.now();
const MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();

const livePids = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .map((line) => Number(line.split('","')[1]))
  .filter((pid) => Number.isInteger(pid) && pid > 4);
const pid = livePids[30] ?? livePids[livePids.length - 1];

fs.writeFileSync(
  path.join(sessionsDir, `${pid}.json`),
  JSON.stringify({
    pid, sessionId: SESSION_ID, cwd, startedAt: NOW - (2 * 60 + 22) * MIN, procStart: '134390780115574227', version: '2.1.325', kind: 'interactive', entrypoint: 'cli',
    status: 'idle', updatedAt: NOW - 20_000, statusUpdatedAt: NOW - 20_000, name: 'status-owner', nameSource: 'user',
  }),
);

// The role file the status line reads: "role-<name>".
const rolesDir = path.join(cwd, '.claude', 'session', 'roles');
fs.mkdirSync(rolesDir, { recursive: true });
fs.writeFileSync(path.join(rolesDir, SESSION_ID), 'role-autonomous-worker');

let n = 0;
const uid = () => `30000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const base = (at) => ({ parentUuid: uid(), isSidechain: false, uuid: uid(), timestamp: iso(at), userType: 'external', cwd, sessionId: SESSION_ID, version: '2.1.325' });
const prompt = (at, text) => ({ ...base(at), promptId: uid(), type: 'user', message: { role: 'user', content: text }, origin: { kind: 'human' }, turnOrigin: 'human' });
const reply = (at, model, text, input) => ({
  ...base(at),
  type: 'assistant',
  message: { id: `msg_${uid()}`, type: 'message', role: 'assistant', model, content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, cache_creation_input_tokens: 800, cache_read_input_tokens: input, output_tokens: 816 } },
});
const lines = [
  prompt(NOW - 40 * MIN, 'Look at the build and tell me what fails.'),
  reply(NOW - 39 * MIN, 'claude-opus-4-6', 'The build fails in two places: the import in src/index.ts and a missing type.', 120_000),
  prompt(NOW - 12 * MIN, 'Fix them, then run the tests.'),
  // The user switched the model with /model between the two answers: the second answer comes from another model.
  reply(NOW - 11 * MIN, 'claude-sonnet-5-5', 'Both fixed and the tests pass.', 367_000),
];
const dir = path.join(projectsDir, slug(cwd));
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${SESSION_ID}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
process.stdout.write(`wrote the fake session ${SESSION_ID} (pid ${pid}, cwd ${cwd}) under ${root}\n`);
