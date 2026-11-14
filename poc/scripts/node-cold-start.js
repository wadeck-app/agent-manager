'use strict';
// Task B: wall time of node cold start on Windows (sequential spawns, 1 KB JSON on stdin).
// Variants: empty hook (20x), global shim `agent-manager -v` (10x), bundle `node agent-manager.cjs -v` (10x).
// Shim and bundle run with AGENT_MANAGER_CONFIG_DIR = temp dir whose config.yml has autoUpdate: false (no updater scheduled).
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RES = path.join(__dirname, '..', 'results');
const GLOBAL = process.env.AGENT_MANAGER_GLOBAL || 'C:\\App\\nodejs';
const BUNDLE = path.join(GLOBAL, 'node_modules', '@wadeck-app', 'agent-manager-cli', 'agent-manager.cjs');
if (!fs.existsSync(BUNDLE)) throw new Error('bundle not found: ' + BUNDLE);
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'am-cold-'));
fs.writeFileSync(path.join(cfg, 'config.yml'), 'autoUpdate: false\n');
const payload = JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 'x'.repeat(36), tool_name: 'Bash', pad: 'p'.repeat(900) });

function pct(s, q) { return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; }
function stat(a) {
  const s = [...a].sort((x, y) => x - y);
  return { n: s.length, min: +s[0].toFixed(1), median: +pct(s, 0.5).toFixed(1), p95: +pct(s, 0.95).toFixed(1), max: +s[s.length - 1].toFixed(1) };
}
function run(label, n, file, args, env, opts = {}) {
  const t = [];
  let last = null;
  for (let i = 0; i < n; i++) {
    const a = process.hrtime.bigint();
    const r = spawnSync(file, args, { input: payload, env, windowsHide: true, encoding: 'utf8', ...opts });
    const ms = Number(process.hrtime.bigint() - a) / 1e6;
    if (r.error || r.status !== 0) throw new Error(label + ' failed: status=' + r.status + ' err=' + (r.error && r.error.message) + ' stderr=' + String(r.stderr).slice(0, 300));
    t.push(ms); last = r;
  }
  return { label, wallMs: stat(t), raw: t.map((x) => +x.toFixed(1)), lastStdout: String(last.stdout).trim().slice(0, 120), lastStderr: String(last.stderr).trim().slice(0, 200) };
}

const env = { ...process.env };
for (const k of Object.keys(env)) if (/^CLAUDE_CODE_/.test(k) || k === 'CLAUDECODE') delete env[k];
const envCfg = { ...env, AGENT_MANAGER_CONFIG_DIR: cfg };
const out = { node: process.version, configDir: cfg, payloadBytes: Buffer.byteLength(payload), results: [] };

const hook = path.join(__dirname, 'empty-hook.cjs');
out.results.push(run('empty-hook (node empty-hook.cjs)', 20, process.execPath, [hook], env));
// peak working set of the empty hook, from inside the child (one extra run, reported on stderr when EMPTY_HOOK_RSS=1)
const rss = spawnSync(process.execPath, [hook], { input: payload, env: { ...env, EMPTY_HOOK_RSS: '1' }, windowsHide: true, encoding: 'utf8' });
out.emptyHookMaxRssKB = rss.stderr.trim();
out.results.push(run('global shim (agent-manager -v)', 10, 'cmd.exe', ['/c', path.join(GLOBAL, 'agent-manager.cmd'), '-v'], envCfg));
out.results.push(run('bundle (node agent-manager.cjs -v)', 10, process.execPath, [BUNDLE, '-v'], envCfg));
fs.writeFileSync(path.join(RES, 'node-cold-start.json'), JSON.stringify(out, null, 2));
for (const r of out.results) console.log(r.label, JSON.stringify(r.wallMs), 'out=' + r.lastStdout, 'err=' + r.lastStderr);
console.log('emptyHook maxRSS', out.emptyHookMaxRssKB);
