// Experiment A3 (no model call): does a stream-json child survive when its parent exits without closing stdin?
// Phase "spawn": spawns claude (detached, piped stdio), prints its pid, then this process exits without closing the pipes.
// Phase "check <pid>": prints whether the pid is still alive; "kill <pid>" ends it (only for a pid this script printed).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';

const [phase, arg] = process.argv.slice(2);
if (phase === 'spawn') {
  fs.mkdirSync(arg, { recursive: true });
  const child = spawn('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--model', 'haiku', '--session-id', crypto.randomUUID(), '--setting-sources', 'project'],
  { cwd: arg, stdio: ['pipe', 'pipe', 'pipe'], detached: true, windowsHide: true });
  console.log('child pid', child.pid);
  child.unref();
  child.stdin.unref?.(); child.stdout.unref?.(); child.stderr.unref?.();
  setTimeout(() => process.exit(0), 1500);
} else if (phase === 'check' || phase === 'kill') {
  const pid = Number(arg);
  if (!Number.isInteger(pid)) throw new Error('usage: node detach-streamjson.mjs check|kill <pid>');
  let alive = true;
  try { process.kill(pid, 0); } catch (e) { alive = e.code === 'EPERM'; }
  console.log(`pid ${pid} alive=${alive}`);
  if (phase === 'kill' && alive) { process.kill(pid); console.log('killed', pid); }
} else {
  throw new Error('usage: node detach-streamjson.mjs spawn <workdir> | check <pid> | kill <pid>');
}
