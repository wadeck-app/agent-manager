'use strict';
// T4: blocking Stop hook with a 15 s hot wait (hook timeout 30 s).
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const HOT = path.join(__dirname, 'hotwait.js').replace(/\\/g, '/');
const hookCmd = { type: 'command', command: 'node "' + HOT + '"', timeout: 30 };
const readLog = (id) => { try { return fs.readFileSync(path.join(L.RESULTS, 'hotwait-' + id + '.log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch (_) { return []; } };
async function waitFor(fn, ms, step = 100) { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await L.sleep(step); } return null; }
const tag = (m) => m.type + (m.subtype ? '/' + m.subtype : '') + (m.event ? '/' + m.event.type : '');

(async () => {
  const h = L.startSession('t4', { settings: { hooks: { Stop: [{ hooks: [hookCmd] }] } } });
  const id = h.sessionId;
  const out = { phases: [], continuations: [] };
  const reply = path.join(L.RESULTS, 'reply-' + id + '.txt');
  const writeReply = (text) => { fs.writeFileSync(reply + '.tmp', text); fs.renameSync(reply + '.tmp', reply); return Date.now(); };
  try {
    if (!(await L.registered(h))) throw new Error('no registration; stderr ' + h.stderr().slice(0, 300));
    await L.sleep(8000);

    // Turn 0 (normal prompt on stdin), Stop hook starts a 15 s wait
    let rb = h.results();
    let since = Date.now();
    h.user('Reply with exactly the single word ack-T4-0');
    let st = await waitFor(() => readLog(id).filter((e) => e.ev === 'start' && e.at >= since).pop(), 30000);
    if (!st) throw new Error('the Stop hook never started; stderr: ' + h.stderr().slice(0, 300));
    const resultEvent = h.events.filter((e) => e.at >= since && e.msg.type === 'result')[0];
    out.turn0 = { sendToHookStartMs: st.at - since, stop_hook_active: st.stop_hook_active, resultEventBeforeHookStart: Boolean(resultEvent && resultEvent.at <= st.at) };
    console.log('turn0', JSON.stringify(out.turn0));

    // Three replies, each written 4 s into the wait
    for (let i = 1; i <= 3; i++) {
      await L.sleep(4000);
      rb = h.results();
      const writeAt = writeReply('T4 reply ' + i + ' from the user. Reply with exactly the single word ack-T4-' + i);
      // do not wait for the `result` event: it only arrives after the NEXT Stop hook wait is over
      const obs = { firstEventAt: null, firstEventType: null, assistantAt: null, resultAt: null };
      await waitFor(() => {
        const ev = h.events.filter((e) => e.at >= writeAt);
        if (ev.length && !obs.firstEventAt) { obs.firstEventAt = ev[0].at; obs.firstEventType = tag(ev[0].msg); }
        const a = ev.find((e) => e.msg.type === 'assistant' && JSON.stringify(e.msg.message.content).includes('ack-T4'));
        if (a) obs.assistantAt = a.at;
        return a;
      }, 30000, 20);
      await L.sleep(300);
      const lg = readLog(id);
      const found = lg.filter((e) => e.ev === 'found' && e.at >= writeAt).pop();
      const ans = L.answerText(h, writeAt);
      const c = {
        i, hookDetectMs: found && found.at - writeAt, firstEventMs: obs.firstEventAt && obs.firstEventAt - writeAt, firstEventType: obs.firstEventType,
        assistantMs: obs.assistantAt && obs.assistantAt - writeAt, resultMs: obs.resultAt && obs.resultAt - writeAt, answered: ans.includes('ack-T4-' + i), answer: ans.slice(0, 120), hookRSS_KB: found && found.maxRSS_KB,
      };
      out.continuations.push(c);
      console.log('cont', JSON.stringify(c));
      if (!c.answered) break;
      st = await waitFor(() => readLog(id).filter((e) => e.ev === 'start' && e.at >= writeAt).pop(), 15000);
      if (!st) { out.phases.push('no Stop hook after continuation ' + i); break; }
      c.nextHookStopHookActive = st.stop_hook_active;
    }

    // Expiry 1: the last Stop wait (stop_hook_active true) is left to expire
    {
      const stx = readLog(id).filter((e) => e.ev === 'start').pop();
      const ex = await waitFor(() => readLog(id).find((e) => e.ev === 'expired' && e.at > stx.at), 25000);
      const exAt = ex ? ex.at : null;
      await L.sleep(1500);
      const reg = L.registryEntry(id);
      const ev = h.events.filter((e) => exAt && e.at >= exAt - 50);
      out.expiry1 = { stop_hook_active: stx.stop_hook_active, waitedMs: ex && ex.waitedMs, eventsAfterExpiry: ev.map((e) => tag(e.msg) + '@+' + (e.at - exAt)), registryStatus: reg && reg.status, sessionAlive: h.child.exitCode === null };
      console.log('expiry1', JSON.stringify(out.expiry1));
    }

    // Expiry 2: a fresh turn via the socket, Stop (stop_hook_active false) waits and expires
    {
      rb = h.results();
      since = Date.now();
      const s = L.runSender(id, 'T4 socket message. Reply with exactly the single word ack-T4-sock');
      const obs = await L.observeTurn(h, since, 40000, rb);
      const stx = await waitFor(() => readLog(id).filter((e) => e.ev === 'start' && e.at >= since).pop(), 15000);
      const ex = stx && await waitFor(() => readLog(id).find((e) => e.ev === 'expired' && e.at > stx.at), 25000);
      await L.sleep(1500);
      const reg = L.registryEntry(id);
      out.expiry2 = { stop_hook_active: stx && stx.stop_hook_active, assistantToHookStartMs: stx && obs.assistantAt && stx.at - obs.assistantAt, resultEventToHookStartMs: stx && obs.resultAt && stx.at - obs.resultAt, waitedMs: ex && ex.waitedMs, registryStatus: reg && reg.status, answer: L.answerText(h, since).slice(0, 80) };
      console.log('expiry2', JSON.stringify(out.expiry2));
    }
  } finally {
    out.exitCode = await h.stop();
    out.stderr = h.stderr().slice(0, 500);
    out.hookLog = readLog(id);
    L.saveResult('t4.json', out);
    console.log('exit', out.exitCode);
  }
})().catch((e) => { console.error('T4 FAILED:', e.message); process.exit(1); });
