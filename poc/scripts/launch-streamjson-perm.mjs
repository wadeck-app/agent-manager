// Experiment A2: claude -p stream-json with --permission-prompt-tool stdio; the host answers can_use_tool requests (1 Haiku prompt).
// First request (command touching am-allow) -> allow; second (am-deny) -> deny with a message.
// Usage: node launch-streamjson-perm.mjs <workdir> <logfile>
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';

const [workdir, logfile] = process.argv.slice(2);
if (!workdir || !logfile) throw new Error('usage: node launch-streamjson-perm.mjs <workdir> <logfile>');
fs.mkdirSync(workdir, { recursive: true });
const sessionId = crypto.randomUUID();
const out = fs.createWriteStream(logfile, { flags: 'w' });
const t0 = Date.now();
const log = (kind, data) => out.write(JSON.stringify({ t: Date.now() - t0, kind, data }) + '\n');

const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
  '--replay-user-messages', '--permission-prompt-tool', 'stdio', '--model', 'haiku', '--session-id', sessionId,
  '--setting-sources', 'project', '--permission-mode', 'default'];
log('spawn', { args, sessionId, workdir });
const child = spawn('claude', args, { cwd: workdir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
log('pid', child.pid);
child.on('exit', (code, sig) => log('exit', { code, sig }));
child.stderr.on('data', (d) => log('stderr', d.toString()));

let buf = '';
let resultSeen = false;
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch { log('nonjson', line); continue; }
    log('out', ev);
    if (ev.type === 'control_request' && ev.request?.subtype === 'can_use_tool') {
      const allow = String(ev.request.input?.command ?? '').includes('am-allow');
      const response = allow
        ? { behavior: 'allow', updatedInput: ev.request.input }
        : { behavior: 'deny', message: 'Denied by the agent-manager research host.' };
      const resp = { type: 'control_response', response: { subtype: 'success', request_id: ev.request_id, response } };
      log('send-control-response', resp);
      child.stdin.write(JSON.stringify(resp) + '\n');
    }
    if (ev.type === 'result') resultSeen = true;
  }
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (obj) => { log('send', obj); child.stdin.write(JSON.stringify(obj) + '\n'); };

try {
  await sleep(2000);
  send({ type: 'user', uuid: crypto.randomUUID(), message: { role: 'user', content:
    'Run two Bash commands, each in its own separate tool call, one after the other: first `touch am-allow.txt`, then `touch am-deny.txt`. If one is refused, do not retry it. Then reply DONE.' } });
  const end = Date.now() + 120000;
  while (!resultSeen && Date.now() < end) await sleep(300);
  log('result-seen', resultSeen);
  child.stdin.end();
  await sleep(5000);
} catch (e) {
  log('error', e.message);
} finally {
  if (child.exitCode === null) { log('killing-own-child', child.pid); child.kill(); }
  await sleep(1000);
  out.end();
  console.log('done', logfile, sessionId);
}
