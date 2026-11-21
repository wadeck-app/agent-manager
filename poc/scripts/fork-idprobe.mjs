// No model call: does `--resume <src> --fork-session --session-id <new>` start with stream-json and end cleanly on stdin EOF? (research/session-fork.md)
// Usage: node fork-idprobe.mjs <workdir> <sourceId> [--with-id|--without-id|--id-no-fork]
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [workdir, src, mode = '--with-id'] = process.argv.slice(2);
if (!workdir || !src) throw new Error('usage: node fork-idprobe.mjs <workdir> <sourceId> [--with-id|--without-id|--id-no-fork]');
const newId = crypto.randomUUID();
const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--replay-user-messages', '--model', 'haiku', '--resume', src];
if (mode !== '--id-no-fork') args.push('--fork-session');
if (mode !== '--without-id') args.push('--session-id', newId);
const child = spawn('claude', args, { cwd: workdir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let out = '', err = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (err += d));
setTimeout(() => child.stdin.end(), 4000);
child.on('exit', (code) => {
  const slug = fs.realpathSync(workdir).replace(/[^A-Za-z0-9]/g, '-');
  const tp = path.join(os.homedir(), '.claude', 'projects', slug, `${newId}.jsonl`);
  console.log(JSON.stringify({ mode, args: args.slice(-5), newId, code, stdout: out.slice(0, 600), stderr: err.slice(0, 600), newTranscriptExists: fs.existsSync(tp) }, null, 2));
});
setTimeout(() => { if (child.exitCode === null) { child.kill(); console.error('killed after 30s'); } }, 30000);
