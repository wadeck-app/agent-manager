'use strict';
// Lists PoC-spawned sessions that are still alive (pid check on spawned.json entries only) and leftover waiter pids from logs.
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
for (const s of L.readSpawned()) if (alive(s.pid)) console.log('SESSION ALIVE', s.label, s.pid, s.sessionId, 'exitCode', s.exitCode);
for (const f of fs.readdirSync(L.RESULTS).filter((x) => /^waiter-.*\.log$/.test(x))) {
  const pids = new Set(fs.readFileSync(path.join(L.RESULTS, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).pid));
  for (const p of pids) if (alive(p)) console.log('WAITER ALIVE', p, f);
}
console.log('check done');
