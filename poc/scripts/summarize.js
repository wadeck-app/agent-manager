'use strict';
// Prints min/median/max summaries of the numbers used in REPORT.md from results/*.json
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(L.RESULTS, f), 'utf8'));
const S = (a) => JSON.stringify(L.stats(a.filter((v) => typeof v === 'number')));

const t2 = rd('t2.json');
console.log('T2 baseline resultMs', S(t2.baseline.map((x) => x.resultMs)), t2.baseline.map((x) => x.resultMs));
console.log('T2 path resultMs', S(t2.path.map((x) => x.resultMs)), t2.path.map((x) => x.resultMs));
console.log('T2 path toolUseMs', S(t2.path.map((x) => x.toolUseMs)), t2.path.map((x) => x.toolUseMs));
console.log('T2 path tools', t2.path.map((x) => x.tools.join('+')), 'correct', t2.path.map((x) => x.correct));
console.log('T2 path timeline sample', JSON.stringify(t2.path[0].timeline.map((t) => t.tag + '@' + t.ms + (t.count > 1 ? 'x' + t.count : ''))));
console.log('T2 baseline timeline sample', JSON.stringify(t2.baseline[1].timeline.map((t) => t.tag + '@' + t.ms + (t.count > 1 ? 'x' + t.count : ''))));

const t3 = rd('t3.json');
console.log('T3 waiterDetectMs', S(t3.wakes.map((x) => x.waiterDetectMs)), t3.wakes.map((x) => x.waiterDetectMs));
console.log('T3 firstEventMs', S(t3.wakes.map((x) => x.firstEventMs)), t3.wakes.map((x) => x.firstEventMs + ':' + x.firstEventType));
console.log('T3 resultMs', S(t3.wakes.map((x) => x.resultMs)));
console.log('T3 waiter maxRSS KB', S(t3.wakes.map((x) => x.waiterMaxRSS_KB)), 'cpuUs', t3.wakes.map((x) => x.waiterCpuUs));

const t4 = rd('t4.json');
console.log('T4 hookDetectMs', S(t4.continuations.map((x) => x.hookDetectMs)));
console.log('T4 firstEventMs', S(t4.continuations.map((x) => x.firstEventMs)), t4.continuations.map((x) => x.firstEventType));
console.log('T4 assistantMs', S(t4.continuations.map((x) => x.assistantMs)));
console.log('T4 next hook stop_hook_active', t4.continuations.map((x) => x.nextHookStopHookActive));
console.log('T4 hook RSS KB', S(t4.continuations.map((x) => x.hookRSS_KB)));

const t5 = rd('t5.json');
for (const r of t5) {
  console.log('T5', r.withWaiter ? 'WITH   ' : 'WITHOUT', 'n=' + r.n, 'per-session priv MB', r.rows.map((x) => x.privMB.toFixed(0)).join('/'), 'ws MB', r.rows.map((x) => x.wsMB.toFixed(0)).join('/'),
    'claude.exe priv', r.rows.map((x) => x.claudePrivMB.toFixed(0)).join('/'), 'procs', r.rows.map((x) => x.processes).join('/'), 'node procs', r.rows.map((x) => x.nodeProcs).join('/'),
    'node ws/priv', r.rows.map((x) => x.nodeWsMB.toFixed(0) + '/' + x.nodePrivMB.toFixed(0)).join(' '), 'waiterLog', JSON.stringify(r.waiterLogs), 'exit', r.exitCodes, 'leftover', r.leftoverWaiterPids);
}
