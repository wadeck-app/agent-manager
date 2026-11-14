'use strict';
// Task A: mine hook_success.durationMs from the 40 most recently modified transcripts (cap 100 MB read). Read-only.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(os.homedir(), '.claude', 'projects');
const MAX_FILES = 40;
const CAP = 100 * 1024 * 1024;

function listTranscripts() {
  const out = [];
  const walk = (d, depth) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 4) walk(p, depth + 1); } else if (e.name.endsWith('.jsonl')) {
        try { const s = fs.statSync(p); out.push({ p, size: s.size, mtime: s.mtimeMs }); } catch (_) { /* gone */ }
      }
    }
  };
  walk(ROOT, 0);
  return out.sort((a, b) => b.mtime - a.mtime);
}

function pct(s, q) { return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; }
function summarize(a) {
  const s = [...a].sort((x, y) => x - y);
  return { n: s.length, median: pct(s, 0.5), p95: pct(s, 0.95), max: s[s.length - 1] };
}
function kind(cmd) {
  if (/w-warp|w-command-log|w-guardrails/i.test(cmd) || /\bnode(\.exe)?\b/i.test(cmd) || /\.(c|m)?js\b/.test(cmd)) return 'node';
  if (/powershell|pwsh|\.ps1/i.test(cmd)) return 'powershell';
  if (/\bbash\b|\.sh\b/i.test(cmd)) return 'bash';
  return 'other';
}
function base(cmd) {
  const m = String(cmd || '').match(/([^\\/\s"']+\.(?:c?m?js|ps1|sh|cmd|bat|exe))/i);
  return m ? m[1] : String(cmd || '').slice(0, 60);
}

(async () => {
  const all = listTranscripts();
  const picked = []; const skipped = [];
  let total = 0;
  for (const f of all.slice(0, MAX_FILES)) {
    if (total + f.size > CAP) { skipped.push(f.p); continue; }
    picked.push(f); total += f.size;
  }
  const groups = new Map();
  const byKind = new Map();
  const projects = new Map();
  let lines = 0, hooks = 0, parseErr = 0, bytes = 0;
  for (const f of picked) {
    const proj = path.basename(path.dirname(f.p));
    projects.set(proj, (projects.get(proj) || 0) + 1);
    const rl = readline.createInterface({ input: fs.createReadStream(f.p, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      lines++; bytes += line.length;
      if (!line.includes('"hook_success"')) continue;
      let o;
      try { o = JSON.parse(line); } catch (_) { parseErr++; continue; }
      const a = o && o.attachment;
      if (!a || a.type !== 'hook_success' || typeof a.durationMs !== 'number') continue;
      hooks++;
      const k = a.hookEvent + ' | ' + base(a.command);
      if (!groups.has(k)) groups.set(k, { kind: kind(a.command || ''), v: [] });
      groups.get(k).v.push(a.durationMs);
      const kk = a.hookEvent + ' | ' + kind(a.command || '');
      if (!byKind.has(kk)) byKind.set(kk, []);
      byKind.get(kk).push(a.durationMs);
    }
  }
  const mt = picked.map((f) => f.mtime);
  const res = {
    files: picked.length, skippedForCap: skipped.length, candidatesConsidered: Math.min(MAX_FILES, all.length), totalBytes: total, lines, hookSuccessLines: hooks, parseErrors: parseErr,
    mtimeOldest: new Date(Math.min(...mt)).toISOString(), mtimeNewest: new Date(Math.max(...mt)).toISOString(),
    projects: Object.fromEntries(projects),
    perEventCommand: [...groups.entries()].map(([k, g]) => ({ key: k, kind: g.kind, ...summarize(g.v) })).sort((a, b) => b.n - a.n),
    perEventKind: [...byKind.entries()].map(([k, v]) => ({ key: k, ...summarize(v) })).sort((a, b) => b.n - a.n),
  };
  fs.writeFileSync(path.join(__dirname, '..', 'results', 'hook-durations.json'), JSON.stringify(res, null, 2));
  console.log(JSON.stringify({ files: res.files, MB: +(total / 1048576).toFixed(1), hooks, parseErr, mtimeOldest: res.mtimeOldest, mtimeNewest: res.mtimeNewest }));
  for (const r of res.perEventKind) console.log('KIND', JSON.stringify(r));
  for (const r of res.perEventCommand.slice(0, 25)) console.log('CMD', JSON.stringify(r));
  console.log('PROJECTS', JSON.stringify(res.projects));
})().catch((e) => { console.error('FAILED', e.stack); process.exit(1); });
