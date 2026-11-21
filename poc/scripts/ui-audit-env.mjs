// UI audit environment (throwaway): fake registry, fake transcripts and a fake daemon (the module's test fake, NO claude at all) in a temp root.
// Run with tsx (it imports a .ts test helper): node_modules/.bin/tsx poc/scripts/ui-audit-env.mjs <tempRoot>
// Then, in another shell: AM_UI_ROOT=<tempRoot> AM_UI_PROJECTS=<tempRoot>/projects bash poc/scripts/ui-dev.sh
// This process keeps the fake daemon alive until it receives SIGINT/SIGTERM or the file <tempRoot>/stop appears. It never touches the real ~/.claude.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.argv[2];
if (!root) throw new Error('Usage: ui-audit-env.mjs <tempRoot>');
const here = path.dirname(fileURLToPath(import.meta.url));
for (const dir of ['sessions', 'projects', 'amconfig', 'xdg', 'appcore']) fs.mkdirSync(path.join(root, dir), { recursive: true });
fs.writeFileSync(path.join(root, 'amconfig', 'config.yml'), 'autoUpdate: false\n');
execFileSync(process.execPath, [path.join(here, 'make-fake-sessions.mjs'), path.join(root, 'sessions')], { stdio: 'inherit' });
execFileSync(process.execPath, [path.join(here, 'make-fake-transcripts.mjs'), path.join(root, 'projects')], { stdio: 'inherit' });

const { startFakeDaemon, ownedView } = await import(pathToFileURL(path.resolve(here, '../../packages/app-module-agent-manager/src/backend/daemon/fakeDaemon.ts')).href);
const daemon = await startFakeDaemon(path.join(root, 'amconfig'));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = Date.now();
const cwd = (folder) => `C:\\Workspace_Tooling\\${folder}`;
daemon.sessions = [
  ownedView({ id: id(1), cwd: cwd('agent-manager'), name: 'agent-manager-owner', state: 'requires_action', pendingPermissions: 1, waitingFor: 'permission prompt: Bash(npm test)', startedAt: now - 3_600_000, permissionMode: 'default' }),
  ownedView({ id: id(3), cwd: cwd('project'), name: 'project-owner', state: 'idle', startedAt: now - 7_200_000, forkedFrom: id(1) }),
  ownedView({ id: id(9), cwd: cwd('queue'), name: 'queue-owner', state: 'idle', startedAt: now - 600_000, forkedFrom: id(1), forkedAtMessage: '11111111-0000-4000-8000-000000000005', forkedAtQuote: 'which currency should the invoice use?' }),
  ownedView({ id: id(5), cwd: cwd('task'), name: 'task-owner', hostKind: 'hc', hcAddress: 't1z', state: 'unobserved' }),
  ownedView({ id: id(8), cwd: cwd('agent-fleet'), name: 'flow-owner', hostKind: 'bg', jobId: 'a1b2c3', state: 'running', bgState: 'working', attachCommand: 'claude attach a1b2c3' }),
  ownedView({ id: id(4), cwd: cwd('docs'), name: 'docs-writer', status: 'exited', state: 'exited', resumable: true, exit: { cause: 'exit', code: 0, signal: null, by: 'user', stderrTail: '', at: now - 900_000 } }),
  ownedView({ id: id(13), cwd: cwd('legacy'), name: 'legacy-owner', status: 'interrupted', state: 'interrupted', resumable: true, interruptedAt: now - 1_800_000, note: 'the daemon restarted: the turn was lost and is NOT replayed by a resume' }),
  ownedView({ id: id(7), cwd: cwd('app-core'), name: 'app-core-owner', state: 'running' }),
  ownedView({ id: id(6), cwd: cwd('dsl-view'), name: 'dsl-owner', status: 'exited', state: 'exited', resumable: true, switchFailure: { at: now - 300_000, target: 'hc', reason: 'herdr-core did not start the terminal (hc exited 1)' } }),
];
daemon.permissions[id(1)] = [{ requestId: 'req-1', toolName: 'Bash', displayName: 'Bash', description: 'Run the test suite', input: { command: 'npm test -- --bail' }, permissionSuggestions: [], receivedAt: now - 40_000 }];
fs.writeFileSync(path.join(root, 'daemon.json'), JSON.stringify({ port: daemon.port, pid: process.pid }));
process.stdout.write(`fake daemon on ${daemon.port} (config ${path.join(root, 'amconfig')}); pid ${process.pid}\n`);
// UI_AUDIT_STOP: another stop file name, to restart the daemon without deleting the old one.
const stopFile = process.env.UI_AUDIT_STOP ?? path.join(root, 'stop');
const timer = setInterval(async () => {
  if (fs.existsSync(stopFile)) {
    clearInterval(timer);
    await daemon.stopCleanly();
    process.exit(0);
  }
}, 1000);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await daemon.stopCleanly();
    process.exit(0);
  });
}
