'use strict';
// Task C: read-only watcher of ~/.claude/sessions/*.json. Appends NDJSON on change of status/name/updatedAt and on appear/disappear.
// Exits after 6 h or when poc/results/registry-watch.stop exists.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.claude', 'sessions');
const RES = path.join(__dirname, '..', 'results');
const OUT = path.join(RES, 'registry-watch.ndjson');
const STOP = path.join(RES, 'registry-watch.stop');
const END = Date.now() + 6 * 3600 * 1000;
const seen = new Map(); // file -> { sig, entry }

function log(ev, f, e) {
  const line = { ts: new Date().toISOString(), ev, file: f, pid: e && e.pid, sessionId: e && e.sessionId, name: e && e.name, status: e && e.status, statusUpdatedAt: e && e.statusUpdatedAt, updatedAt: e && e.updatedAt, cwd: e && e.cwd };
  fs.appendFileSync(OUT, JSON.stringify(line) + '\n');
}

function tick() {
  if (Date.now() > END || fs.existsSync(STOP)) { log('exit', null, null); process.exit(0); }
  let files = [];
  try { files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')); } catch (e) { fs.appendFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), ev: 'error', msg: String(e.message) }) + '\n'); return; }
  const now = new Set(files);
  for (const f of files) {
    let e;
    try { e = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (_) { continue; }
    const sig = [e.status, e.name, e.updatedAt, e.statusUpdatedAt].join('|');
    const prev = seen.get(f);
    if (!prev) log('appear', f, e);
    else if (prev.sig !== sig) log('change', f, e);
    seen.set(f, { sig, entry: e });
  }
  for (const [f, v] of [...seen]) if (!now.has(f)) { log('disappear', f, v.entry); seen.delete(f); }
}

fs.appendFileSync(OUT, JSON.stringify({ ts: new Date().toISOString(), ev: 'start', pid: process.pid }) + '\n');
tick();
setInterval(tick, 1000);
