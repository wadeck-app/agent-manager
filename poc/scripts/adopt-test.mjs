// Host switch measurement (research/adopt-host-switch.md): one process at a time, no loops. No model call except `x1`.
// Usage: node adopt-test.mjs <phase> <workdir> [args]
//   x1   <workdir> <id|-> <text>   stream-json process (-p), --session-id <new> when id is "-", else --resume <id>; one message, waits for the result, closes stdin
//   snap <workdir> [id]            registry entries of the folder, claude processes naming the folder or id, hc terminals in the folder, transcripts of the folder
//   tx   <workdir> <id>            transcript analysis only (lines, sessionId values, duplicate uuids, synthetic lines, types)
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [phase, workdir, a1, a2] = process.argv.slice(2);
if (!phase || !workdir) throw new Error('usage: node adopt-test.mjs <x1|snap|tx> <workdir> [id] [text]');
const cwd = fs.realpathSync(workdir);
const slug = (p) => p.replace(/[^A-Za-z0-9]/g, '-');
const projDir = path.join(os.homedir(), '.claude', 'projects', slug(cwd));
const norm = (p) => path.resolve(p).toLowerCase();

function txInfo(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const ids = new Set(), seen = new Map(), types = {};
  let synthetic = 0, interrupted = 0;
  for (const l of lines) {
    const o = JSON.parse(l);
    types[o.type] = (types[o.type] ?? 0) + 1;
    if (o.sessionId) ids.add(o.sessionId);
    if (o.uuid) seen.set(o.uuid, (seen.get(o.uuid) ?? 0) + 1);
    const s = JSON.stringify(o.message?.content ?? '');
    if (s.includes('No response requested')) synthetic++;
    if (s.includes('Tool call interrupted') || s.includes('Request interrupted')) interrupted++;
  }
  return { file: path.basename(file), lines: lines.length, bytes: fs.statSync(file).size, sessionIds: [...ids], duplicateUuids: [...seen.values()].filter((n) => n > 1).length, noResponseRequested: synthetic, interruptedMarkers: interrupted, types };
}

function registry() {
  const dir = path.join(os.homedir(), '.claude', 'sessions');
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const o = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (norm(o.cwd ?? '') === norm(cwd)) {
        let alive = false;
        try { process.kill(o.pid, 0); alive = true; } catch { /* dead */ }
        out.push({ file: f, pid: o.pid, sessionId: o.sessionId, status: o.status, kind: o.kind, entrypoint: o.entrypoint, alive, waitingFor: o.waitingFor, name: o.name });
      }
    } catch (e) { out.push({ file: f, error: String(e) }); }
  }
  return out;
}

function claudeProcs(needle) {
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine -like '*${needle}*') -and $_.Name -notlike 'powershell*' } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress`;
  const t = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true }).trim();
  if (!t) return [];
  const j = JSON.parse(t);
  return (Array.isArray(j) ? j : [j]).filter((p) => p.Name !== 'bash.exe' && p.ProcessId !== process.pid).map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name, cmd: String(p.CommandLine).slice(0, 160) }));
}

if (phase === 'tx') {
  console.log(JSON.stringify(txInfo(path.join(projDir, `${a1}.jsonl`)), null, 2));
} else if (phase === 'snap') {
  const hc = JSON.parse(execFileSync('hc', ['ls', '--json'], { encoding: 'utf8', windowsHide: true }));
  const mine = hc.terminals.filter((t) => norm(t.cwd ?? '') === norm(cwd));
  const files = fs.existsSync(projDir) ? fs.readdirSync(projDir, { withFileTypes: true }).map((d) => (d.isDirectory() ? d.name + '/' : d.name)) : [];
  console.log(JSON.stringify({ registry: registry(), hcTerminals: mine, projDirEntries: files, procsNamingFolder: claudeProcs('am-adopt'), procsNamingId: a1 ? claudeProcs(a1) : undefined }, null, 2));
} else if (phase === 'x1') {
  const text = a2;
  if (!a1 || !text) throw new Error('x1 needs <id|-> <text>');
  const fresh = a1 === '-';
  const id = fresh ? crypto.randomUUID() : a1;
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--replay-user-messages', '--model', 'haiku', '--setting-sources', 'project', '--permission-mode', 'default'];
  args.push(...(fresh ? ['--session-id', id] : ['--resume', id]));
  const child = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const report = { args, pid: child.pid, initSessionIds: new Set(), result: null, stderr: '', registryWhileRunning: null };
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const o = JSON.parse(line);
      if (o.session_id) report.initSessionIds.add(o.session_id);
      if (o.type === 'system' && o.subtype === 'init' && !report.registryWhileRunning) report.registryWhileRunning = registry().filter((r) => r.pid === child.pid);
      if (o.type === 'result') { report.result = { subtype: o.subtype, text: o.result }; child.stdin.end(); }
    }
  });
  child.stderr.on('data', (d) => (report.stderr += d));
  const startedAt = Date.now();
  child.on('exit', (code) => {
    const tp = path.join(projDir, `${id}.jsonl`);
    console.log(JSON.stringify({ ...report, initSessionIds: [...report.initSessionIds], stderr: report.stderr.slice(0, 600), exitCode: code, ms: Date.now() - startedAt, requestedId: id, registryAfterExit: registry().filter((r) => r.pid === child.pid), transcript: fs.existsSync(tp) ? txInfo(tp) : null }, null, 2));
  });
  child.stdin.write(JSON.stringify({ type: 'user', uuid: crypto.randomUUID(), message: { role: 'user', content: text } }) + '\n');
} else throw new Error('unknown phase ' + phase);
