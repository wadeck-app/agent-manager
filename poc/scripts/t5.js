'use strict';
// T5: idle headless sessions (no prompt, no model call), with and without the asyncRewake waiter. n=1 and n=2, max 2 alive at once.
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const WAITER = path.join(__dirname, 'waiter.js').replace(/\\/g, '/');
const hookCmd = { type: 'command', command: 'node "' + WAITER + '"', asyncRewake: true, timeout: 600 };
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const readLog = (id) => { try { return fs.readFileSync(path.join(L.RESULTS, 'waiter-' + id + '.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (_) { return []; } };

async function scenario(withWaiter, n) {
  const hs = [];
  for (let i = 0; i < n; i++) {
    hs.push(L.startSession('t5-' + (withWaiter ? 'with' : 'without') + '-n' + n + '-' + (i + 1), withWaiter ? { settings: { hooks: { SessionStart: [{ hooks: [hookCmd] }] } } } : {}));
    await L.sleep(500);
  }
  for (const h of hs) if (!(await L.registered(h))) throw new Error('no registration for ' + h.label + '; stderr ' + h.stderr().slice(0, 300));
  await L.sleep(30000);
  const snap = L.snapshot();
  const rows = hs.map((h) => {
    const tr = L.tree(h.pid, snap);
    return { label: h.label, processes: tr.length, names: tr.map((p) => p.name).join(','), nodeProcs: tr.filter((p) => p.name === 'node.exe').length, wsMB: tr.reduce((s, p) => s + p.wsMB, 0), privMB: tr.reduce((s, p) => s + p.privMB, 0), claudePrivMB: (tr.find((p) => p.pid === h.pid) || {}).privMB, claudeWsMB: (tr.find((p) => p.pid === h.pid) || {}).wsMB, nodeWsMB: tr.filter((p) => p.name === 'node.exe').reduce((s, p) => s + p.wsMB, 0), nodePrivMB: tr.filter((p) => p.name === 'node.exe').reduce((s, p) => s + p.privMB, 0) };
  });
  const waiterLogs = withWaiter ? hs.map((h) => { const hb = readLog(h.sessionId).filter((e) => e.ev === 'hb'); const l = hb[hb.length - 1]; return l ? { maxRSS_KB: l.maxRSS_KB, cpuUs: l.cpuUs, hbCount: hb.length } : null; }) : null;
  const exitCodes = [];
  for (const h of hs) exitCodes.push(await h.stop());
  await L.sleep(2000);
  const leftovers = [];
  if (withWaiter) for (const h of hs) for (const e of readLog(h.sessionId)) if (e.ev === 'start' && isAlive(e.pid)) leftovers.push(e.pid);
  const res = { withWaiter, n, rows, waiterLogs, exitCodes, leftoverWaiterPids: leftovers, totalPrivMB: rows.reduce((s, r) => s + r.privMB, 0), totalWsMB: rows.reduce((s, r) => s + r.wsMB, 0) };
  console.log(JSON.stringify({ ...res, rows: rows.map((r) => ({ ...r, wsMB: +r.wsMB.toFixed(0), privMB: +r.privMB.toFixed(0), claudePrivMB: +r.claudePrivMB.toFixed(0), claudeWsMB: +r.claudeWsMB.toFixed(0), nodeWsMB: +r.nodeWsMB.toFixed(0), nodePrivMB: +r.nodePrivMB.toFixed(0) })) }));
  return res;
}

(async () => {
  const all = [];
  for (const n of [1, 2]) for (const w of [false, true]) all.push(await scenario(w, n));
  L.saveResult('t5.json', all);
})().catch((e) => { console.error('T5 FAILED:', e.message); process.exit(1); });
