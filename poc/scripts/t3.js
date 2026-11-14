'use strict';
// T3: asyncRewake hook (SessionStart + Stop both launch waiter.js), timeout 20 s.
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const WAITER = path.join(__dirname, 'waiter.js').replace(/\\/g, '/');
const TIMEOUT = 20;
const hookCmd = { type: 'command', command: 'node "' + WAITER + '"', asyncRewake: true, timeout: TIMEOUT };
const logFile = (id) => path.join(L.RESULTS, 'waiter-' + id + '.log');
const readLog = (id) => { try { return fs.readFileSync(logFile(id), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (_) { return []; } };
const isAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

async function waitFor(fn, ms, step = 100) { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await L.sleep(step); } return null; }

(async () => {
  const h = L.startSession('t3', { settings: { hooks: { SessionStart: [{ hooks: [hookCmd] }], Stop: [{ hooks: [hookCmd] }] } } });
  const id = h.sessionId;
  const out = { timeoutS: TIMEOUT, wakes: [] };
  const inbox = path.join(L.RESULTS, 'inbox-' + id + '.txt');
  const writeInbox = (text) => { const tmp = inbox + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, inbox); return Date.now(); };
  try {
    if (!(await L.registered(h))) throw new Error('no registration; stderr ' + h.stderr().slice(0, 300));
    const s0 = await waitFor(() => readLog(id).find((e) => e.ev === 'start'), 20000);
    out.firstWaiterStart = s0 || 'NOT STARTED within 20 s of registration';
    console.log('first waiter', JSON.stringify(out.firstWaiterStart));
    if (!s0) throw new Error('SessionStart asyncRewake hook never started a waiter (stderr: ' + h.stderr().slice(0, 300) + ')');

    for (let i = 1; i <= 3; i++) {
      // wait until a waiter is armed (start event newer than the previous wake) and let it settle a little
      const armedAfter = i === 1 ? 0 : out.wakes[i - 2].doneAt;
      const st = await waitFor(() => readLog(id).filter((e) => e.ev === 'start' && e.at > armedAfter).pop(), 15000);
      if (!st) { out.wakes.push({ i, error: 'no waiter armed after previous wake (nothing re-launched the hook)' }); console.log('wake', i, 'NO WAITER ARMED'); break; }
      await L.sleep(2500);
      // footprint while armed (first round only)
      if (i === 1) {
        const snap = L.snapshot();
        const tr = L.tree(h.pid, snap);
        out.armedTree = tr.map((p) => ({ name: p.name, pid: p.pid, ppid: p.ppid, wsMB: +p.wsMB.toFixed(1), privMB: +p.privMB.toFixed(1), cmd: p.cmd.slice(0, 100) }));
        console.log('armed tree', JSON.stringify(out.armedTree));
      }
      const rb = h.results();
      const writeAt = writeInbox('T3 hook message ' + i + '. Reply with exactly the single word ack-T3-' + i);
      const obs = await L.observeTurn(h, writeAt, 60000, rb);
      await L.sleep(1500);
      const lg = readLog(id);
      const wake = lg.filter((e) => e.ev === 'wake' && e.at >= writeAt).pop();
      const ans = L.answerText(h, writeAt);
      const w = {
        i, armedBy: st.event, writeAt, waiterDetectMs: wake && wake.at - writeAt,
        firstEventMs: obs.firstEventAt && obs.firstEventAt - writeAt, firstEventType: obs.firstEventType,
        resultMs: obs.resultAt && obs.resultAt - writeAt, answered: ans.includes('ack-T3-' + i), answer: ans.slice(0, 150),
        waiterMaxRSS_KB: wake && wake.maxRSS_KB, waiterCpuUs: wake && wake.cpuUs, doneAt: obs.resultAt || Date.now(),
      };
      out.wakes.push(w);
      console.log('wake', JSON.stringify(w));
      if (!w.answered) break;
    }

    // Expiry: the last Stop armed a waiter (timeout 20 s). Do not write; watch it die.
    const last = out.wakes[out.wakes.length - 1];
    const st = await waitFor(() => readLog(id).filter((e) => e.ev === 'start' && e.at > (last.doneAt || 0)).pop(), 15000);
    if (st) {
      const evBefore = h.events.length;
      const dead = await waitFor(() => !isAlive(st.pid), 40000, 250);
      const deadAt = Date.now();
      const hbs = readLog(id).filter((e) => e.ev === 'hb' && e.pid === st.pid);
      out.expiry = { waiterPid: st.pid, startedAt: st.at, deadDetectedAfterMs: dead ? deadAt - st.at : 'still alive after 40 s', lastHeartbeatAfterStartMs: hbs.length ? hbs[hbs.length - 1].at - st.at : null, streamEventsDuringWait: h.events.length - evBefore, eventTypes: [...new Set(h.events.slice(evBefore).map((e) => e.msg.type + (e.msg.subtype ? '/' + e.msg.subtype : '')))] };
      console.log('expiry', JSON.stringify(out.expiry));
      // Deaf period: file written after expiry
      const rb = h.results();
      const wAt = writeInbox('T3 stale message after expiry. Reply with exactly the single word ack-T3-stale');
      await L.sleep(8000);
      out.afterExpiryFileWake = { turnStartedWithin8s: h.results() > rb || h.events.some((e) => e.at >= wAt && e.msg.type === 'assistant') };
      console.log('after expiry', JSON.stringify(out.afterExpiryFileWake));
      // Recovery: a socket message starts a turn -> Stop re-launches the waiter -> it finds the stale file at once
      const rb2 = h.results();
      const since = Date.now();
      const sres = L.runSender(id, 'T3 socket message after expiry. Reply with exactly the single word ack-T3-sock');
      const obs1 = await L.observeTurn(h, since, 60000, rb2);
      await L.sleep(1500);
      const lg = readLog(id);
      const newStart = lg.filter((e) => e.ev === 'start' && e.at > since).pop();
      const wake2 = lg.filter((e) => e.ev === 'wake' && e.at > wAt).pop();
      out.recovery = { socketTurnResultMs: obs1.resultAt && obs1.resultAt - sres.beforeConnect, newWaiterStartedBy: newStart && newStart.event, newWaiterStartAfterResultMs: newStart && obs1.resultAt && newStart.at - obs1.resultAt, staleFileConsumedAfterSendMs: wake2 && wake2.at - since };
      console.log('recovery', JSON.stringify(out.recovery));
      await L.sleep(8000);
      out.recovery.answerAfterwards = L.answerText(h, since).slice(0, 300);
      out.recovery.turnsSince = h.results() - rb2;
    }
  } finally {
    out.exitCode = await h.stop();
    out.stderr = h.stderr().slice(0, 500);
    out.waiterLog = readLog(id);
    L.saveResult('t3.json', out);
    console.log('exit', out.exitCode, 'alive waiter pids:', [...new Set(out.waiterLog.map((e) => e.pid))].filter(isAlive));
  }
})().catch((e) => { console.error('T3 FAILED:', e.message); process.exit(1); });
