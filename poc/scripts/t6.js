'use strict';
// T6 (follow-up of T5): time from stdin close to process exit for an idle session with an armed asyncRewake waiter
// (timeout 600) vs the same without a hook. n=2 each (sequential, 1 session alive at a time). No model call.
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const WAITER = path.join(__dirname, 'waiter.js').replace(/\\/g, '/');
const hookCmd = { type: 'command', command: 'node "' + WAITER + '"', asyncRewake: true, timeout: 600 };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const readLog = (id) => { try { return fs.readFileSync(path.join(L.RESULTS, 'waiter-' + id + '.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (_) { return []; } };

async function one(withWaiter, k) {
  const h = L.startSession('t6-' + (withWaiter ? 'with' : 'without') + '-' + k, withWaiter ? { settings: { hooks: { SessionStart: [{ hooks: [hookCmd] }] } } } : {});
  if (!(await L.registered(h))) throw new Error('no registration');
  await L.sleep(10000);
  const waiterPid = withWaiter ? (readLog(h.sessionId).find((e) => e.ev === 'start') || {}).pid : null;
  const t = Date.now();
  try { h.child.stdin.end(); } catch (_) { /* closed */ }
  let waiterGoneAt = null;
  const end = t + 90000;
  while (h.child.exitCode === null && Date.now() < end) { if (waiterPid && waiterGoneAt === null && !alive(waiterPid)) waiterGoneAt = Date.now() - t; await L.sleep(100); }
  const r = { withWaiter, k, waiterPid, exitAfterMs: h.child.exitCode === null ? 'NOT EXITED after 90 s (pid ' + h.pid + ')' : Date.now() - t, exitCode: h.child.exitCode, waiterGoneAfterMs: waiterGoneAt };
  console.log(JSON.stringify(r));
  return r;
}

(async () => {
  const all = [];
  for (const w of [false, true]) for (const k of [1, 2]) all.push(await one(w, k));
  L.saveResult('t6.json', all);
})().catch((e) => { console.error('T6 FAILED:', e.message); process.exit(1); });
