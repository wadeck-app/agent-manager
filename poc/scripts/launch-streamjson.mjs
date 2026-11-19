// Experiment A: claude -p stream-json child kept open across 2 user messages (2 Haiku prompts max).
// Usage: node launch-streamjson.mjs <workdir> <logfile>
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const [workdir, logfile] = process.argv.slice(2);
if (!workdir || !logfile) throw new Error('usage: node launch-streamjson.mjs <workdir> <logfile>');
fs.mkdirSync(workdir, { recursive: true });
const sessionId = crypto.randomUUID();
const out = fs.createWriteStream(logfile, { flags: 'w' });
const t0 = Date.now();
const log = (kind, data) => out.write(JSON.stringify({ t: Date.now() - t0, kind, data }) + '\n');

const png = fs.readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'magenta-64.png')).toString('base64');
const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
  '--replay-user-messages', '--model', 'haiku', '--session-id', sessionId,
  '--setting-sources', 'project', '--permission-mode', 'default'];
log('spawn', { args, sessionId, workdir });
const child = spawn('claude', args, { cwd: workdir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
log('pid', child.pid);
child.on('exit', (code, sig) => { log('exit', { code, sig }); });
child.stderr.on('data', (d) => log('stderr', d.toString()));

const registryFile = path.join(os.homedir(), '.claude', 'sessions', `${child.pid}.json`);
const snapshotRegistry = (label) => {
  try { log('registry-' + label, JSON.parse(fs.readFileSync(registryFile, 'utf8'))); }
  catch (e) { log('registry-' + label, 'ABSENT: ' + registryFile + ' ' + e.code); }
};
const snapshotMem = (label) => {
  try {
    const o = execFileSync('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq ${child.pid} -or $_.ParentProcessId -eq ${child.pid} } | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,PrivatePageCount | ConvertTo-Json -Compress`], { encoding: 'utf8' });
    log('mem-' + label, o.trim());
  } catch (e) { log('mem-' + label, 'ERR ' + e.message); }
};

let buf = '';
const waiters = [];
child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch { log('nonjson', line); continue; }
    log('out', ev);
    if (ev.type === 'control_request') {
      // answer allow, echoing the input
      const resp = { type: 'control_response', response: { subtype: 'success', request_id: ev.request_id,
        response: { behavior: 'allow', updatedInput: ev.request.input } } };
      log('send-control-response', resp);
      child.stdin.write(JSON.stringify(resp) + '\n');
    }
    for (const w of [...waiters]) if (w.pred(ev)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(ev); }
  }
});
const waitFor = (pred, ms, label) => new Promise((resolve, reject) => {
  const w = { pred, resolve };
  waiters.push(w);
  setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); reject(new Error('timeout ' + label)); } }, ms);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (obj) => { log('send', obj); child.stdin.write(JSON.stringify(obj) + '\n'); };

try {
  await sleep(4000);
  log('alive-before-first-message', child.exitCode === null);
  snapshotRegistry('before-msg1'); snapshotMem('before-msg1');
  const u1 = crypto.randomUUID();
  send({ type: 'user', uuid: u1, message: { role: 'user', content: [
    { type: 'text', text: 'Reply with the word PONG1 and the main colour of the attached image in one word. No tools.' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }] } });
  await waitFor((e) => e.type === 'result', 90000, 'result1');
  snapshotRegistry('after-msg1'); snapshotMem('after-msg1');
  await sleep(8000);
  log('alive-after-pause', child.exitCode === null);
  const u2 = crypto.randomUUID();
  send({ type: 'user', uuid: u2, message: { role: 'user', content: 'Run exactly this Bash command and nothing else: touch am-streamjson-file.txt . Then reply DONE2.' } });
  await waitFor((e) => e.type === 'result', 120000, 'result2');
  snapshotRegistry('after-msg2');
  log('closing-stdin', true);
  child.stdin.end();
  await sleep(6000);
  log('alive-after-stdin-close', child.exitCode === null);
} catch (e) {
  log('error', e.message);
} finally {
  if (child.exitCode === null) { log('killing-own-child', child.pid); child.kill(); }
  await sleep(1500);
  out.end();
  console.log('done', logfile, sessionId);
}
