'use strict';
// Task D: socket frame fields on sessions started by this script only.
//   node m0-socket-fields.js dedupe     -> session 1: same full frame (msgV:1, msg_id) twice, 200 ms apart
//   node m0-socket-fields.js priority   -> session 2: while a turn runs tool calls, send priority now / next / later (one per round)
// Never targets a session it did not start (uses h.sessionId only). Never kills.
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const L = require('./lib');

function target(sessionId) {
  const e = L.registryEntry(sessionId);
  if (!e || !e.messagingSocketPath) throw new Error('no registry entry/socket for ' + sessionId);
  const dir = L.SESSIONS_DIR;
  const hashed = process.platform === 'win32' ? e.messagingSocketPath.toLowerCase() : e.messagingSocketPath;
  const keyFile = path.join(dir, e.pid + '.' + crypto.createHash('sha256').update(hashed).digest('hex') + '.key');
  const token = JSON.parse(fs.readFileSync(keyFile, 'utf8')).peerToken;
  return { socketPath: e.messagingSocketPath, token };
}

// returns { at: epoch ms of connect call }
function send(t, frameObj) {
  const at = Date.now();
  return new Promise((resolve, reject) => {
    const s = net.connect(t.socketPath);
    s.on('error', reject);
    s.on('connect', () => {
      s.write(JSON.stringify({ type: 'auth', token: t.token }) + '\n' + JSON.stringify(frameObj) + '\n', () => {
        setTimeout(() => { s.destroy(); resolve({ at }); }, 300);
      });
    });
  });
}

// ordered view of the transcript: user texts, assistant tool_use names, tool_result snippets
function transcriptView(sessionId) {
  const f = L.findTranscript(sessionId);
  if (!f) return [];
  const out = [];
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch (_) { continue; }
    if (o.type !== 'user' && o.type !== 'assistant') continue;
    const c = o.message && o.message.content;
    const parts = Array.isArray(c) ? c : [{ type: 'text', text: String(c) }];
    for (const p of parts) {
      if (p.type === 'text') out.push({ ts: o.timestamp, role: o.type, text: String(p.text).slice(0, 110) });
      else if (p.type === 'tool_use') out.push({ ts: o.timestamp, role: o.type, tool_use: JSON.stringify(p.input).slice(0, 60) });
      else if (p.type === 'tool_result') out.push({ ts: o.timestamp, role: o.type, tool_result: JSON.stringify(p.content).slice(0, 110) });
    }
  }
  return out;
}

async function dedupe() {
  const h = L.startSession('m0-d1-dedupe', { extraArgs: ['--max-turns', '40'] });
  const out = { test: 'msg_id dedupe', turnsBudgetUsed: 0 };
  try {
    const reg = await L.registered(h);
    if (!reg) throw new Error('not registered; stderr ' + h.stderr().slice(0, 300));
    await L.sleep(3000);
    const t = target(h.sessionId);
    const word = 'ack-D1';
    const frame = { type: 'user', message: { role: 'user', content: 'M0 dedupe probe. Reply with exactly the single word ' + word }, msgV: 1, msg_id: 'poc-d1-' + crypto.randomBytes(4).toString('hex'), priority: 'next', session_id: h.sessionId };
    out.frame = frame;
    const since = Date.now();
    const p1 = send(t, frame);
    await L.sleep(200);
    const p2 = send(t, frame);
    const [a, b] = await Promise.all([p1, p2]);
    out.sendGapMs = b.at - a.at;
    // wait for the first result, then 25 s more to let a second turn show up
    const end = Date.now() + 60000;
    while (h.results() < 1 && Date.now() < end) await L.sleep(250);
    await L.sleep(25000);
    out.resultsAfterWait = h.results();
    const view = transcriptView(h.sessionId);
    out.userLinesWithMarker = view.filter((x) => x.role === 'user' && x.text && x.text.includes('M0 dedupe probe')).length;
    out.assistantAnswers = h.events.filter((e) => e.at >= since && e.msg.type === 'assistant').length;
    out.transcript = view;
    out.turnsBudgetUsed = out.resultsAfterWait;
  } finally {
    out.exitCode = await h.stop();
    out.stderr = h.stderr().slice(0, 400);
    L.saveResult('m0-d1-dedupe.json', out);
    console.log(JSON.stringify({ ...out, transcript: undefined }));
    console.log(JSON.stringify(out.transcript, null, 1));
  }
}

async function priority() {
  const h = L.startSession('m0-d2-priority', { extraArgs: ['--max-turns', '40', '--allowedTools', 'Bash'] });
  const out = { test: 'priority', rounds: [] };
  try {
    const reg = await L.registered(h);
    if (!reg) throw new Error('not registered; stderr ' + h.stderr().slice(0, 300));
    await L.sleep(3000);
    const t = target(h.sessionId);
    for (const prio of ['now', 'next', 'later']) {
      const word = 'MSG-' + prio.toUpperCase();
      const before = h.results();
      const startEv = h.events.length;
      const tStart = Date.now();
      h.user('Use the Bash tool to run `sleep 3` three times, each as its own separate tool call, one after the other. After the third, reply with the single word done.');
      // wait for the first tool_use
      const end = Date.now() + 60000;
      let toolAt = null;
      while (Date.now() < end && toolAt === null) {
        const e = h.events.slice(startEv).find((x) => x.msg.type === 'assistant' && JSON.stringify(x.msg.message && x.msg.message.content).includes('"tool_use"'));
        if (e) toolAt = e.at; else await L.sleep(50);
      }
      if (toolAt === null) { out.rounds.push({ prio, error: 'no tool_use seen within 60 s' }); break; }
      await L.sleep(1000);
      const frame = { type: 'user', message: { role: 'user', content: 'Priority probe ' + prio + ': reply with exactly the single word ' + word }, msgV: 1, msg_id: 'poc-d2-' + prio + '-' + crypto.randomBytes(3).toString('hex'), priority: prio, session_id: h.sessionId };
      const s = await send(t, frame);
      // wait until the session has produced results for the whole round (max 2 results: task turn + possibly message turn), settle 15 s
      const end2 = Date.now() + 90000;
      while (h.results() < before + 1 && Date.now() < end2) await L.sleep(250);
      await L.sleep(15000);
      const evs = h.events.slice(startEv);
      const seq = [];
      for (const e of evs) {
        const m = e.msg;
        if (m.type === 'assistant') {
          const cs = (m.message && m.message.content) || [];
          for (const c of cs) {
            if (c.type === 'tool_use') seq.push({ t: e.at - tStart, ev: 'tool_use', cmd: JSON.stringify(c.input).slice(0, 40) });
            if (c.type === 'text' && c.text) seq.push({ t: e.at - tStart, ev: 'assistant_text', text: c.text.slice(0, 60) });
          }
        } else if (m.type === 'user') seq.push({ t: e.at - tStart, ev: 'user_event', text: JSON.stringify(m.message && m.message.content).slice(0, 110) });
        else if (m.type === 'result') seq.push({ t: e.at - tStart, ev: 'result' });
      }
      out.rounds.push({ prio, word, sentAtMsAfterPrompt: s.at - tStart, resultsThisRound: h.results() - before, seq });
      console.log('ROUND', prio, JSON.stringify({ sentAt: s.at - tStart, results: h.results() - before }));
    }
    out.transcript = transcriptView(h.sessionId);
    out.totalResults = h.results();
  } finally {
    out.exitCode = await h.stop();
    out.stderr = h.stderr().slice(0, 400);
    L.saveResult('m0-d2-priority.json', out);
    console.log(JSON.stringify(out, null, 1));
  }
}

const mode = process.argv[2];
(mode === 'dedupe' ? dedupe() : mode === 'priority' ? priority() : Promise.reject(new Error('usage: dedupe|priority')))
  .catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
