// Round 3 measured comparison of launch modes, ONE session at a time, n=1, no loops over runs.
// Usage: node compare-launch.mjs x1 | x2-start | x2-run | x2-stop | x3-start | x3-run | x3-stop
// x2-start / x2-run (and x3-*) are separate processes on purpose: the second one proves a new manager can drive a session
// the first (now gone) manager started. State and logs: %TEMP%\am-research5\.
// Only touches sessions it started itself (name am-r5-*, or the child it spawned). Windows only.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';

const SCRATCH = path.join(process.env.TEMP, 'am-research5');
const PROJ_TRUSTED = path.join(process.env.TEMP, 'am-research2', 'proj'); // already trusted in ~/.claude.json (needed by --bg and interactive claude)
const SESSIONS = path.join(os.homedir(), '.claude', 'sessions');
const PROJECTS = path.join(os.homedir(), '.claude', 'projects');
fs.mkdirSync(SCRATCH, { recursive: true });

const mode = process.argv[2];
if (!mode) throw new Error('usage: node compare-launch.mjs x1|x2-start|x2-run|x2-stop|x3-start|x3-run|x3-stop');
const T0 = Date.now();
const logFile = path.join(SCRATCH, mode + '.log');
fs.writeFileSync(logFile, '');
const log = (kind, data) => {
  const line = JSON.stringify({ t: Date.now() - T0, kind, data });
  fs.appendFileSync(logFile, line + '\n');
  console.log(line.length > 700 ? line.slice(0, 700) + '...' : line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uuid = () => crypto.randomUUID();
const stateFile = (v) => path.join(SCRATCH, v + '-state.json');
const readState = (v) => {
  if (!fs.existsSync(stateFile(v))) throw new Error(`no state file ${stateFile(v)}: run ${v}-start first`);
  return JSON.parse(fs.readFileSync(stateFile(v), 'utf8'));
};

// ---------- processes ----------
function psList() {
  const r = spawnSync('powershell', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,PrivatePageCount,CommandLine | ConvertTo-Json -Compress'],
  { encoding: 'utf8', maxBuffer: 256e6 });
  if (r.status !== 0) throw new Error('powershell process list failed: ' + r.stderr);
  const a = JSON.parse(r.stdout);
  return Array.isArray(a) ? a : [a];
}
function tree(list, roots) {
  const set = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of list) if (!set.has(p.ProcessId) && set.has(p.ParentProcessId)) { set.add(p.ProcessId); grew = true; }
  }
  return list.filter((p) => set.has(p.ProcessId));
}
const mb = (b) => Math.round((b / 1048576) * 10) / 10;
function summ(ps) {
  return {
    count: ps.length,
    wsMB: mb(ps.reduce((s, p) => s + (p.WorkingSetSize || 0), 0)),
    privateMB: mb(ps.reduce((s, p) => s + (p.PrivatePageCount || 0), 0)),
    procs: ps.map((p) => `${p.Name}#${p.ProcessId} ws=${mb(p.WorkingSetSize || 0)}`),
  };
}

// ---------- registry / transcript ----------
function registryAll() {
  const out = [];
  for (const f of fs.readdirSync(SESSIONS)) {
    if (!f.endsWith('.json')) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(SESSIONS, f), 'utf8'))); } catch { /* being written */ }
  }
  return out;
}
const registryByPid = (pid) => { try { return JSON.parse(fs.readFileSync(path.join(SESSIONS, pid + '.json'), 'utf8')); } catch { return null; } };
const registryBySession = (sid) => registryAll().find((r) => r.sessionId === sid) || null;
function findTranscript(sid) {
  for (const d of fs.readdirSync(PROJECTS)) {
    const f = path.join(PROJECTS, d, sid + '.jsonl');
    if (fs.existsSync(f)) return f;
  }
  return null;
}
function sumLine(o, max = 200) {
  const m = o.message;
  let c = '';
  if (m && (o.type === 'user' || o.type === 'assistant')) {
    const cont = m.content;
    c = typeof cont === 'string' ? 'str:' + cont.slice(0, max)
      : (cont || []).map((b) => b.type + (b.type === 'tool_use' ? ':' + b.name : '') + (b.type === 'text' ? ':' + String(b.text).slice(0, max) : '')).join('|');
  }
  return { type: o.type, op: o.operation, sub: o.subtype, promptSource: o.promptSource, turnOrigin: o.turnOrigin, origin: o.origin, entrypoint: o.entrypoint, stop: m?.stop_reason, meta: o.isMeta, c };
}
function userLines(sid) {
  const f = findTranscript(sid);
  if (!f) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((o) => o && (o.type === 'user' || o.type === 'queue-operation')).map((o) => sumLine(o, 260));
}

// Polls (50 ms) the registry file and the transcript of one session; records time of every status change and transcript line.
// until: 'idle' (busy seen, then idle after an end_turn assistant line) | 'waiting' (registry status waiting) | 'timeout'
async function observe({ sid, pid, tSend, until, timeoutMs = 90000 }) {
  const ev = [];
  let file = null; let offset = 0; let buf = '';
  let lastStatus = null; let busySeen = false; let endTurn = false; let done = false;
  const end = Date.now() + timeoutMs;
  while (!done && Date.now() < end) {
    const now = Date.now() - tSend;
    const reg = registryByPid(pid);
    const key = reg ? reg.status + '/' + (reg.waitingFor || '') : 'gone';
    if (key !== lastStatus) { ev.push({ t: now, k: 'reg', v: key }); lastStatus = key; }
    if (reg && reg.status === 'busy') busySeen = true;
    if (!file) file = findTranscript(sid);
    if (file) {
      const size = fs.statSync(file).size;
      if (size > offset) {
        const fd = fs.openSync(file, 'r');
        const b = Buffer.alloc(size - offset);
        fs.readSync(fd, b, 0, b.length, offset);
        fs.closeSync(fd);
        offset = size;
        buf += b.toString('utf8');
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          try {
            const o = JSON.parse(line);
            const s = sumLine(o, 90);
            ev.push({ t: now, k: 'tr', v: s });
            if (o.type === 'assistant' && o.message?.stop_reason === 'end_turn') endTurn = true;
          } catch { ev.push({ t: now, k: 'tr-partial' }); }
        }
      }
    }
    if (until === 'waiting' && reg && reg.status === 'waiting') done = true;
    if (until === 'idle' && endTurn && reg && reg.status === 'idle') done = true;
    if (!done) await sleep(50);
  }
  if (!done) ev.push({ t: Date.now() - tSend, k: 'timeout', v: until, busySeen, endTurn });
  return ev;
}
function printEvents(label, ev) {
  // Compact: registry changes, and per transcript line type/op the first occurrence
  const compact = ev.map((e) => e.k === 'tr'
    ? { t: e.t, k: 'tr', v: `${e.v.type}${e.v.op ? '/' + e.v.op : ''}${e.v.sub ? '/' + e.v.sub : ''}${e.v.stop ? ' stop=' + e.v.stop : ''} ${e.v.c || ''}`.trim() }
    : e);
  log(label, compact);
}

// ---------- hc / claude ----------
function run(cmd, args, opts = {}) {
  const t = Date.now();
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout || 60000, cwd: opts.cwd, windowsHide: true });
  return { ms: Date.now() - t, status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const hc = (...args) => run('hc', args);
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');

// inbox socket (baseline Y): same frame as socketTransport.ts buildSocketFrame
function socketSend(reg, text) {
  return new Promise((resolve, reject) => {
    const sp = reg.messagingSocketPath;
    const hashed = sp.toLowerCase();
    const keyFile = path.join(SESSIONS, `${reg.pid}.${crypto.createHash('sha256').update(hashed).digest('hex')}.key`);
    const token = JSON.parse(fs.readFileSync(keyFile, 'utf8')).peerToken;
    const frame = JSON.stringify({ type: 'user', message: { role: 'user', content: text }, msgV: 1, msg_id: uuid(), session_id: reg.sessionId });
    const t = Date.now();
    const s = net.connect(sp);
    s.on('error', reject);
    s.on('connect', () => {
      const tc = Date.now() - t;
      s.write(JSON.stringify({ type: 'auth', token }) + '\n' + frame + '\n', () => {
        resolve({ connectMs: tc, writeMs: Date.now() - t });
        setTimeout(() => s.destroy(), 300);
      });
    });
  });
}

const FILE_TASK = (name) => `Run exactly this Bash command and nothing else: touch ${name} . Then reply DONE.`;

// =====================================================================================
if (mode === 'x1') {
  // X1: stream-json child owned by this node process
  const work = path.join(SCRATCH, 'x1');
  fs.mkdirSync(work, { recursive: true });
  const sid = uuid();
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--replay-user-messages', '--permission-prompt-tool', 'stdio', '--model', 'haiku', '--session-id', sid,
    '--setting-sources', 'project', '--permission-mode', 'default'];
  const tSpawn = Date.now();
  const child = spawn('claude', args, { cwd: work, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const rel = () => Date.now() - tSpawn;
  log('spawn', { pid: child.pid, sid, args: args.join(' ') });
  const events = []; // {t, ev}
  let buf = '';
  const waiters = [];
  const pendingCtl = [];
  child.stderr.on('data', (d) => log('stderr', d.toString().slice(0, 300)));
  child.on('exit', (code) => log('exit', { code, atMs: rel() }));
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let ev; try { ev = JSON.parse(line); } catch { log('nonjson', line.slice(0, 200)); continue; }
      const rec = { t: Date.now(), ev };
      events.push(rec);
      for (const w of waiters.slice()) if (w.pred(ev)) { waiters.splice(waiters.indexOf(w), 1); w.res(rec); }
    }
  });
  const waitEv = (pred, ms = 90000) => new Promise((res, rej) => {
    const hit = events.find((e) => pred(e.ev));
    if (hit) return res(hit);
    const w = { pred, res };
    waiters.push(w);
    setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); rej(new Error('timeout waiting for event')); } }, ms);
  });
  const send = (o) => { child.stdin.write(JSON.stringify(o) + '\n'); return Date.now(); };

  // startup: initialize frame at once; registry poll
  const reqId = uuid();
  const tInit = send({ type: 'control_request', request_id: reqId, request: { subtype: 'initialize' } });
  let regAt = null; let regIdleAt = null;
  const initP = waitEv((e) => e.type === 'control_response' && e.response?.request_id === reqId, 30000).then((r) => r.t - tSpawn).catch(() => 'no answer in 30 s');
  while (rel() < 15000) {
    const reg = registryBySession(sid);
    if (reg && regAt === null) { regAt = rel(); log('registry-appeared', { atMs: regAt, status: reg.status, kind: reg.kind, entrypoint: reg.entrypoint, hasSocket: !!reg.messagingSocketPath, keys: Object.keys(reg) }); }
    if (reg && reg.status === 'idle') { regIdleAt = rel(); break; }
    if (typeof (await Promise.race([initP, sleep(50).then(() => null)])) === 'number' && rel() > 2500 && regAt === null) break;
  }
  log('startup', { initializeAnsweredAtMs: await initP, registryAppearedAtMs: regAt, registryIdleAtMs: regIdleAt });
  await sleep(2000);
  const snap1 = summ(tree(psList(), [child.pid]));
  log('mem-idle-after-start', snap1);

  // turn 1: trivial
  const u1 = uuid();
  const tS1 = send({ type: 'user', uuid: u1, message: { role: 'user', content: 'Reply with exactly the word PONG1. No tools.' } });
  const lifecycle = await waitEv((e) => e.type === 'command_lifecycle' && e.command_uuid === u1 && e.state === 'queued');
  const started = await waitEv((e) => e.type === 'command_lifecycle' && e.command_uuid === u1 && e.state === 'started');
  const firstDelta = await waitEv((e) => e.type === 'stream_event' && e.event?.type === 'content_block_delta' && e.event?.delta?.type === 'text_delta');
  const assistant = await waitEv((e) => e.type === 'assistant');
  const replay = await waitEv((e) => e.type === 'user' && e.uuid === u1 && e.isReplay);
  const result = await waitEv((e) => e.type === 'result');
  const completed = await waitEv((e) => e.type === 'command_lifecycle' && e.command_uuid === u1 && e.state === 'completed');
  log('turn1', { queuedMs: lifecycle.t - tS1, startedMs: started.t - tS1, firstTextDeltaMs: firstDelta.t - tS1, replayMs: replay.t - tS1, assistantMs: assistant.t - tS1, resultMs: result.t - tS1, completedMs: completed.t - tS1,
    text: assistant.ev.message?.content?.map((b) => b.text).join(''), regStatusAfter: registryBySession(sid)?.status });
  await sleep(1500);
  log('mem-idle-after-turn1', summ(tree(psList(), [child.pid])));

  // turn 2: permission
  const u2 = uuid();
  const nBefore = events.length;
  const tS2 = send({ type: 'user', uuid: u2, message: { role: 'user', content: FILE_TASK('am-x1.txt') } });
  const req = await waitEv((e) => e.type === 'control_request' && e.request?.subtype === 'can_use_tool' && events.indexOf(events.find((x) => x.ev === e)) >= nBefore);
  const regDuring = registryBySession(sid);
  const tAns = send({ type: 'control_response', response: { subtype: 'success', request_id: req.ev.request_id, response: { behavior: 'allow', updatedInput: req.ev.request.input } } });
  log('perm', { requestAfterSendMs: req.t - tS2, tool: req.ev.request.tool_name, regStatusWhilePending: regDuring && [regDuring.status, regDuring.waitingFor], answerSentMs: tAns - tS2 });
  const result2 = await waitEv((e) => e.type === 'result' && events.filter((x) => x.ev.type === 'result').length >= 2 || false, 90000).catch(() => null);
  await sleep(500);
  log('turn2', { resultMs: events.filter((x) => x.ev.type === 'result')[1] ? events.filter((x) => x.ev.type === 'result')[1].t - tS2 : 'no second result', fileCreated: fs.existsSync(path.join(work, 'am-x1.txt')), regStatusAfter: registryBySession(sid)?.status, result2: !!result2 });
  const sess = registryBySession(sid);
  log('registry-full-minus-secrets', sess ? { ...sess, messagingSocketPath: sess.messagingSocketPath ? '<present>' : undefined } : null);
  log('transcript-user-lines', userLines(sid));
  log('event-types-seen', [...new Set(events.map((e) => e.ev.type + (e.ev.subtype ? '/' + e.ev.subtype : '')))]);
  child.stdin.end();
  await sleep(3000);
  log('final', { exitCode: child.exitCode, note: 'stdin closed by the script' });
  if (child.exitCode === null) { log('killing-own-child', child.pid); child.kill(); }
}

// =====================================================================================
else if (mode === 'x2-start') {
  const name = 'am-r5-x2';
  const before = new Set(registryAll().map((r) => r.pid));
  const t = Date.now();
  const r = spawn('claude', ['--bg', '--model', 'haiku', '--name', name, '--permission-mode', 'default'], { cwd: PROJ_TRUSTED, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  r.stdout.on('data', (d) => { out += d; }); r.stderr.on('data', (d) => { out += d; });
  let exitAt = null; r.on('exit', (c) => { exitAt = Date.now() - t; log('cli-exit', { code: c, atMs: exitAt }); });
  let appeared = null; let idleAt = null; let reg = null;
  while (Date.now() - t < 60000) {
    reg = registryAll().find((x) => x.name === name && !before.has(x.pid)) || null;
    if (reg && appeared === null) { appeared = Date.now() - t; log('registry-appeared', { atMs: appeared, status: reg.status }); }
    if (reg && reg.status === 'idle') { idleAt = Date.now() - t; break; }
    await sleep(50);
  }
  log('startup', { cliExitMs: exitAt, registryAppearedMs: appeared, registryIdleMs: idleAt, cliOutput: stripAnsi(out).slice(0, 300) });
  if (!reg) throw new Error('bg session did not register within 60 s; output: ' + out);
  await sleep(3000);
  const list = psList();
  const hosts = list.filter((p) => p.CommandLine && p.CommandLine.includes('--bg-pty-host') && p.CommandLine.includes(name));
  const sup = list.filter((p) => p.CommandLine && / daemon run/.test(p.CommandLine) && /claude/i.test(p.Name));
  log('mem-idle-after-start', { session: summ(tree(list, hosts.map((p) => p.ProcessId))), supervisorShared: summ(sup), registryPidInSessionTree: tree(list, hosts.map((p) => p.ProcessId)).some((p) => p.ProcessId === reg.pid) });
  const ag = run('claude', ['agents', '--json', '--cwd', PROJ_TRUSTED]);
  log('agents-json', { ms: ag.ms, out: ag.out.slice(0, 600) });
  log('registry-full-minus-secrets', { ...reg, messagingSocketPath: '<present>' });
  fs.writeFileSync(stateFile('x2'), JSON.stringify({ name, pid: reg.pid, sessionId: reg.sessionId, jobId: reg.jobId, managerPid: process.pid }));
  log('manager-exit', 'this node process now exits; the claude --bg CLI already exited');
}

else if (mode === 'x2-run') {
  const st = readState('x2');
  if (st.managerPid === process.pid) throw new Error('same process');
  let reg = registryByPid(st.pid);
  if (!reg || reg.sessionId !== st.sessionId) throw new Error('session of x2-start no longer in the registry: ' + JSON.stringify(reg));
  log('resilience', { startManagerPid: st.managerPid, startManagerAlive: (() => { try { process.kill(st.managerPid, 0); return true; } catch { return false; } })(), status: reg.status });
  const key = fs.readFileSync(path.join(os.homedir(), '.claude', 'daemon', 'control.key'), 'utf8').trim();
  const pipes = run('powershell', ['-NoProfile', '-Command', "[System.IO.Directory]::GetFiles('\\\\.\\pipe\\') | Where-Object { $_ -like '*cc-daemon-*-control' }"]);
  const pipe = pipes.out.split(/\r?\n/).filter(Boolean)[0];
  if (!pipe) throw new Error('no supervisor control pipe found: ' + pipes.out + pipes.err);
  const reply = (text) => new Promise((resolve, reject) => {
    const t = Date.now(); const s = net.connect(pipe);
    s.on('error', reject);
    s.on('connect', () => s.write(JSON.stringify({ proto: 1, op: 'reply', short: st.jobId, text, auth: key }) + '\n'));
    let b = '';
    s.on('data', (d) => { b += d; if (b.includes('\n')) { resolve({ ms: Date.now() - t, resp: b.trim().slice(0, 300) }); s.destroy(); } });
    setTimeout(() => reject(new Error('no answer from supervisor in 15 s')), 15000);
  });
  const pre = () => { const l = psList(); const hosts = l.filter((p) => p.CommandLine && p.CommandLine.includes('--bg-pty-host') && p.CommandLine.includes(st.name)); return { session: summ(tree(l, hosts.map((p) => p.ProcessId))), supervisorShared: summ(l.filter((p) => p.CommandLine && / daemon run/.test(p.CommandLine) && /claude/i.test(p.Name))) }; };

  // P1 trivial
  const tS = Date.now();
  const rp = await reply('Reply with exactly the word PONG1. No tools.');
  log('reply-op', rp);
  printEvents('turn1-events', await observe({ sid: st.sessionId, pid: st.pid, tSend: tS, until: 'idle' }));
  await sleep(1500);
  log('mem-idle-after-turn1', pre());
  // P2 permission
  const tS2 = Date.now();
  log('reply-op', await reply(FILE_TASK('am-x2.txt')));
  printEvents('perm-events', await observe({ sid: st.sessionId, pid: st.pid, tSend: tS2, until: 'waiting', timeoutMs: 60000 }));
  const ag = run('claude', ['agents', '--json', '--cwd', PROJ_TRUSTED]);
  log('agents-json-while-waiting', { ms: ag.ms, out: ag.out.slice(0, 600) });
  const lg = run('claude', ['logs', st.jobId]);
  log('logs-tail-while-waiting', { ms: lg.ms, tail: stripAnsi(lg.out).split(/\r?\n/).filter((l) => l.trim()).slice(-14).join('\n') });
  log('file-created-before-any-answer', fs.existsSync(path.join(PROJ_TRUSTED, 'am-x2.txt')));
  log('transcript-user-lines', userLines(st.sessionId));
}

else if (mode === 'x2-stop') {
  const st = readState('x2');
  log('stop', run('claude', ['stop', st.jobId]));
  await sleep(2000);
  log('rm', run('claude', ['rm', st.jobId]));
  await sleep(6000);
  log('remaining', psList().filter((p) => p.CommandLine && (p.CommandLine.includes(st.name) || (/ daemon run/.test(p.CommandLine) && /claude/i.test(p.Name)))).map((p) => `${p.Name}#${p.ProcessId}`));
}

// =====================================================================================
else if (mode === 'x3-start') {
  const name = 'am-r5-x3';
  const before = new Set(registryAll().map((r) => r.pid));
  const t = Date.now();
  const r = hc('run', '--json', '--bg', '--no-parent', '--no-notify', '--name', name, '--cwd', PROJ_TRUSTED, 'claude', '--model', 'haiku', '--permission-mode', 'default');
  log('hc-run', { ms: r.ms, status: r.status, out: r.out.slice(0, 400), err: r.err.slice(0, 300) });
  let reg = null; let appeared = null; let idleAt = null;
  while (Date.now() - t < 60000) {
    reg = registryAll().find((x) => !before.has(x.pid) && x.cwd && path.resolve(x.cwd).toLowerCase() === path.resolve(PROJ_TRUSTED).toLowerCase()) || null;
    if (reg && appeared === null) { appeared = Date.now() - t; log('registry-appeared', { atMs: appeared, status: reg.status }); }
    if (reg && reg.status === 'idle') { idleAt = Date.now() - t; break; }
    await sleep(50);
  }
  log('startup', { hcRunReturnMs: r.ms, registryAppearedMs: appeared, registryIdleMs: idleAt });
  if (!reg) { log('screen', hc('read', name).out.slice(-800)); throw new Error('no registry entry for the hc terminal within 60 s (see the screen dump above)'); }
  await sleep(3000);
  const get = JSON.parse(hc('get', '--json', '--', name).out);
  log('hc-get', { pid: get.pid, foreground: get.foreground, status: get.status, agent: get.agent });
  const list = psList();
  const roots = [get.pid, get.foreground?.pid].filter(Boolean);
  const sess = tree(list, roots);
  const shared = list.filter((p) => [10816, 23664].includes(p.ProcessId)); // herdr-core pids seen in `hc server status` (shared by every terminal)
  log('mem-idle-after-start', { session: summ(sess), registryPidInTree: sess.some((p) => p.ProcessId === reg.pid), herdrCoreShared: summ(shared) });
  log('registry-full-minus-secrets', { ...reg, messagingSocketPath: '<present>' });
  log('screen-tail', hc('read', name).out.split(/\r?\n/).filter((l) => l.trim()).slice(-8).join('\n'));
  fs.writeFileSync(stateFile('x3'), JSON.stringify({ name, pid: reg.pid, sessionId: reg.sessionId, managerPid: process.pid }));
  log('manager-exit', 'this node process now exits');
}

else if (mode === 'x3-run') {
  const st = readState('x3');
  let reg = registryByPid(st.pid);
  if (!reg || reg.sessionId !== st.sessionId) throw new Error('session of x3-start no longer in the registry');
  log('resilience', { startManagerPid: st.managerPid, startManagerAlive: (() => { try { process.kill(st.managerPid, 0); return true; } catch { return false; } })(), status: reg.status });
  const mem = () => {
    const get = JSON.parse(hc('get', '--json', '--', st.name).out);
    return summ(tree(psList(), [get.pid, get.foreground?.pid].filter(Boolean)));
  };
  // P1 trivial via hc send
  const tS = Date.now();
  const s1 = hc('send', '--json', '--', st.name, 'Reply with exactly the word PONG1. No tools.');
  log('hc-send', { ms: s1.ms, out: s1.out.slice(0, 200), err: s1.err.slice(0, 200) });
  printEvents('turn1-events', await observe({ sid: st.sessionId, pid: st.pid, tSend: tS, until: 'idle' }));
  await sleep(1500);
  log('mem-idle-after-turn1', mem());
  // P2 permission via hc send, answered with hc keys
  const tS2 = Date.now();
  const s2 = hc('send', '--json', '--', st.name, FILE_TASK('am-x3.txt'));
  log('hc-send', { ms: s2.ms, out: s2.out.slice(0, 200) });
  let blockedAt = null; let st3 = null;
  while (Date.now() - tS2 < 60000) {
    const g = hc('get', '--json', '--', st.name);
    try { st3 = JSON.parse(g.out).status; } catch { st3 = null; }
    if (st3 && st3.state === 'blocked') { blockedAt = Date.now() - tS2; break; }
    await sleep(200);
  }
  const regW = registryByPid(st.pid);
  log('perm-visible', { blockedAfterSendMs: blockedAt, hcStatus: st3, registry: regW && [regW.status, regW.waitingFor] });
  const screen = stripAnsi(hc('read', st.name).out).split(/\r?\n/).filter((l) => l.trim()).slice(-14).join('\n');
  log('screen-at-prompt', screen);
  if (blockedAt !== null && /Yes/.test(screen)) {
    const tK = Date.now();
    const k = hc('keys', st.name, 'enter');
    log('hc-keys-enter', { ms: k.ms, out: k.out.slice(0, 200) });
    printEvents('perm-events', await observe({ sid: st.sessionId, pid: st.pid, tSend: tK, until: 'idle', timeoutMs: 90000 }));
    log('file-created', fs.existsSync(path.join(PROJ_TRUSTED, 'am-x3.txt')));
  } else {
    log('perm-not-answered', 'no blocked state or no "Yes" option on screen; see screen-at-prompt');
  }
  // P3 inbox socket (baseline Y)
  const tS3 = Date.now();
  const sk = await socketSend(registryByPid(st.pid), 'Reply with exactly the word PONG3. No tools.');
  log('socket-send', sk);
  printEvents('turn3-socket-events', await observe({ sid: st.sessionId, pid: st.pid, tSend: tS3, until: 'idle' }));
  log('transcript-user-lines', userLines(st.sessionId));
}

else if (mode === 'x3-stop') {
  const st = readState('x3');
  log('kill', hc('kill', st.name));
  await sleep(1500);
  log('rm', hc('rm', st.name));
  log('remaining', psList().filter((p) => p.ProcessId === st.pid).map((p) => `${p.Name}#${p.ProcessId}`));
}
else if (mode === 'x3-inspect') {
  // Read-only: transcript lines of the x3 session with their own timestamps (no model call)
  const st = readState('x3');
  const f = findTranscript(st.sessionId);
  const rows = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((o) => !/^(attachment|custom-title|agent-name|mode|permission-mode|atis-latch|file-history-snapshot|last-prompt|ai-title|api-request.*)$/.test(o.type));
  for (const o of rows.slice(-16)) log('line', { ts: o.timestamp, ...sumLine(o, 300) });
  log('registry', (({ status, waitingFor, updatedAt }) => ({ status, waitingFor, updatedAt }))(registryByPid(st.pid) || {}));
}
else throw new Error('unknown mode ' + mode);
