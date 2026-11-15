// Fabricates a registry folder with sessions in every state, for the UI checks (agent-browser). Usage: node make-fake-sessions.mjs <outDir> [now-offset-ms]
// Alive sessions borrow the pids of processes that already run (read from tasklist); nothing is started, nothing is killed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const outDir = process.argv[2];
if (!outDir) {
  throw new Error('Usage: node make-fake-sessions.mjs <outDir>');
}
fs.mkdirSync(outDir, { recursive: true });
const livePids = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .map((line) => Number(line.split('","')[1]))
  .filter((pid) => Number.isInteger(pid) && pid > 4)
  .slice(0, 40);
const now = Date.now();
const min = 60_000;
const hour = 60 * min;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// [folder, name, status, ageMs, extra]
const rows = [
  ['agent-manager', 'agent-manager-owner', 'waiting', 40_000, { waitingFor: 'permission prompt: Bash(npm test)' }],
  ['billing', 'billing-owner', 'waiting', 12 * min, { waitingFor: 'question: which currency should the invoice use?' }],
  ['project', 'project-owner', 'idle', 2 * min, {}],
  ['docs', 'docs-writer', 'idle', 9 * min, {}],
  ['task', 'task-owner', 'busy', 3 * min, {}],
  ['dsl-view', 'dsl-owner', 'busy', 3 * min, {}],
  ['app-core', 'app-core-owner', 'busy', 90_000, {}],
  ['agent-fleet', 'flow-owner', 'busy', 25 * min, {}],
  ['queue', 'queue-owner', 'idle', 44 * min, {}],
  ['local-marketplace', 'claude-plugin-owner-with-a-really-long-session-name-that-must-be-cut-with-an-ellipsis', 'idle', 54 * min, {}],
  ['a-very-long-folder-name-for-a-project-that-keeps-going-and-going', '$sources.sessions.sessions', 'idle', 7 * hour, {}],
  ['scrapers', undefined, 'idle', 8 * hour, {}],
  ['legacy', 'legacy-owner', 'shell', 5 * min, {}],
  ['ghost', 'ghost-owner', 'busy', 3 * hour, { dead: true }],
  ['unknown', 'unknown-status', 'thinking-hard', 6 * min, {}],
];
rows.forEach(([folder, name, status, age, extra], index) => {
  const pid = extra.dead ? 999_000 + index : livePids[index % livePids.length] ?? 4;
  const cwd = folder === 'scrapers' ? 'C:\\Workspace_Tooling\\scrapers' : `C:\\Workspace_Tooling\\${folder}`;
  const body = {
    pid,
    sessionId: id(index + 1),
    cwd,
    startedAt: now - 10 * hour,
    procStart: '134390780115574227',
    version: index % 5 === 0 ? '2.1.322' : '2.1.325',
    kind: 'interactive',
    entrypoint: 'cli',
    status,
    updatedAt: now - age,
    statusUpdatedAt: now - age,
    ...(name === undefined ? {} : { name, nameSource: 'user' }),
    ...(extra.waitingFor === undefined ? {} : { waitingFor: extra.waitingFor }),
  };
  fs.writeFileSync(path.join(outDir, `${pid}.json`), JSON.stringify(body));
});
process.stdout.write(`wrote ${rows.length} fake sessions into ${outDir}\n`);
