'use strict';

// Shared harness for the PoC. Ideas copied from w-agent-wake tests/contract/socket-contract.js (own implementation).
// SAFETY: only sessions started by startSession() are ever targeted; their pid + sessionId are written to
// results/spawned.json immediately after spawn, and sender.js refuses any session id not listed there.

const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const POC = path.resolve(__dirname, '..');
const RESULTS = path.join(POC, 'results');
const WORK = path.join(POC, 'work');
const SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const SPAWNED = path.join(RESULTS, 'spawned.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The harness runs inside a Claude Code session: strip every variable that would make the children look like
// children of it (session id, messaging socket/token...) or that points at the user's terminal tooling.
function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if ((/^CLAUDE_CODE_/.test(k) && k !== 'CLAUDE_CODE_USE_BEDROCK') || k === 'CLAUDECODE' || k === 'CLAUDE_PID' || /^HERDR/i.test(k)) delete env[k];
  }
  return env;
}

function readSpawned() {
  try { return JSON.parse(fs.readFileSync(SPAWNED, 'utf8')); } catch (_) { return []; }
}
function writeSpawned(list) { fs.writeFileSync(SPAWNED, JSON.stringify(list, null, 2)); }
function recordSpawn(entry) { const l = readSpawned(); l.push(entry); writeSpawned(l); }
function updateSpawn(sessionId, patch) { const l = readSpawned(); const e = l.find((x) => x.sessionId === sessionId); if (e) Object.assign(e, patch); writeSpawned(l); }

function writeSettings(obj, name) {
  const file = path.join(RESULTS, 'settings-' + (name || crypto.randomBytes(3).toString('hex')) + '.json');
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
  return file;
}

// Settings applied to every PoC session through --settings (flag layer, user's files untouched).
// The 4 local plugins that add Stop/SessionStart hooks are disabled for the PoC session only (confound removal).
function baseSettings(extra) {
  return {
    crossSessionInbound: 'accept',
    enabledPlugins: {
      'w-warp@local-marketplace': false,
      'w-command-log@local-marketplace': false,
      'w-block-worktree@local-marketplace': false,
      'w-guardrails@local-marketplace': false,
      'w-roles@local-marketplace': false,
    },
    ...extra,
  };
}

function findTranscript(sessionId) {
  try {
    for (const d of fs.readdirSync(PROJECTS_DIR)) {
      const f = path.join(PROJECTS_DIR, d, sessionId + '.jsonl');
      if (fs.existsSync(f)) return f;
    }
  } catch (_) { /* missing */ }
  return null;
}

function registryEntry(sessionId) {
  let files;
  try { files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json')); } catch (_) { return null; }
  for (const f of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
      if (raw.sessionId === sessionId) return raw;
    } catch (_) { /* being rewritten */ }
  }
  return null;
}

// label: free text. opts: { settings (object), extraArgs, model }
function startSession(label, opts = {}) {
  fs.mkdirSync(WORK, { recursive: true });
  const sessionId = crypto.randomUUID();
  const settingsFile = writeSettings(baseSettings(opts.settings), label);
  const args = [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--session-id', sessionId, '--model', opts.model || 'haiku', '--max-budget-usd', '1', '--max-turns', '6',
    '--permission-mode', 'default', '--settings', settingsFile, ...(opts.extraArgs || []),
  ];
  const child = spawn('claude', args, { cwd: WORK, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: cleanEnv() });
  recordSpawn({ label, pid: child.pid, sessionId, startedAt: new Date().toISOString(), args: args.join(' ') });
  const events = [];
  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try { events.push({ at: Date.now(), msg: JSON.parse(line) }); } catch (_) { /* not JSON */ }
    }
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => { stderr += c; });
  child.on('exit', (code) => updateSpawn(sessionId, { exitedAt: new Date().toISOString(), exitCode: code }));
  const h = {
    label, sessionId, child, events, pid: child.pid,
    stderr: () => stderr,
    results: () => events.filter((e) => e.msg.type === 'result').length,
    user: (content) => child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n'),
    // Clean end: close stdin and wait for the session's own exit. Never kills.
    stop: async (waitMs = 15000) => {
      try { child.stdin.end(); } catch (_) { /* closed */ }
      const end = Date.now() + waitMs;
      while (child.exitCode === null && Date.now() < end) await sleep(200);
      return child.exitCode;
    },
  };
  return h;
}

async function registered(h, ms = 40000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const e = registryEntry(h.sessionId);
    if (e && e.messagingSocketPath) return e;
    await sleep(300);
  }
  return null;
}

// Runs sender.js (separate process, not a child of any claude) and returns its JSON line.
function runSender(sessionId, frameJsonOrText, mode = 'text') {
  const out = execFileSync(process.execPath, [path.join(__dirname, 'sender.js'), sessionId, mode, frameJsonOrText], { encoding: 'utf8', env: cleanEnv(), windowsHide: true });
  return JSON.parse(out.trim().split('\n').pop());
}

// Poll file size (transcript) and the event list to detect the first sign of a turn after `since`.
// Resolves { transcriptAt, firstEventAt, firstEventType, assistantAt, resultAt } (null when not seen within timeoutMs).
async function observeTurn(h, since, timeoutMs = 90000, resultsBefore = h.results()) {
  const out = { transcriptAt: null, firstEventAt: null, firstEventType: null, toolUseAt: null, assistantAt: null, resultAt: null };
  let tfile = findTranscript(h.sessionId);
  let tsize = tfile ? fs.statSync(tfile).size : 0;
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (!tfile) { tfile = findTranscript(h.sessionId); if (tfile) tsize = 0; }
    if (tfile && out.transcriptAt === null) {
      let s = 0;
      try { s = fs.statSync(tfile).size; } catch (_) { /* race */ }
      if (s > tsize) out.transcriptAt = Date.now();
    }
    const ev = h.events.filter((e) => e.at >= since);
    if (ev.length && out.firstEventAt === null) {
      out.firstEventAt = ev[0].at;
      out.firstEventType = ev[0].msg.type + (ev[0].msg.subtype ? '/' + ev[0].msg.subtype : '') + (ev[0].msg.event ? '/' + ev[0].msg.event.type : '');
    }
    const a = ev.find((e) => e.msg.type === 'assistant');
    if (a && out.assistantAt === null) out.assistantAt = a.at;
    const t = ev.find((e) => e.msg.type === 'assistant' && JSON.stringify(e.msg.message && e.msg.message.content).includes('"tool_use"'));
    if (t && out.toolUseAt === null) out.toolUseAt = t.at;
    const r = h.events.filter((e) => e.msg.type === 'result');
    if (r.length > resultsBefore) { out.resultAt = r[resultsBefore].at; break; }
    await sleep(25);
  }
  return out;
}

function answerText(h, since) {
  return h.events.filter((e) => e.at >= since && e.msg.type === 'assistant')
    .map((e) => (e.msg.message.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('')).join(' | ');
}

// Windows process snapshot: pid, parent, name, working set and private bytes (MB), cmdline start
function snapshot() {
  const cmd = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,PrivatePageCount,CommandLine | ConvertTo-Json -Compress';
  const raw = execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return JSON.parse(raw).map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name, wsMB: (p.WorkingSetSize || 0) / 1048576, privMB: (p.PrivatePageCount || 0) / 1048576, cmd: (p.CommandLine || '').slice(0, 160) }));
}
function tree(rootPid, procs) {
  const out = [];
  const q = [rootPid];
  while (q.length) {
    const pid = q.shift();
    const p = procs.find((x) => x.pid === pid);
    if (p) out.push(p);
    for (const c of procs) if (c.ppid === pid) q.push(c.pid);
  }
  return out;
}

function stats(a) {
  if (!a.length) return { n: 0 };
  const s = [...a].sort((x, y) => x - y);
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  return { n: s.length, min: s[0], median: med, max: s[s.length - 1] };
}

function saveResult(name, obj) { fs.writeFileSync(path.join(RESULTS, name), JSON.stringify(obj, null, 2)); }

module.exports = { POC, RESULTS, WORK, SESSIONS_DIR, sleep, cleanEnv, startSession, registered, registryEntry, runSender, observeTurn, answerText, snapshot, tree, stats, saveResult, findTranscript, readSpawned, SPAWNED };
