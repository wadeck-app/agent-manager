'use strict';
// T2: image by path (3 samples) vs text-only baseline (2 samples), then ONE content-block-array frame with a base64 image.
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const FIX = path.join(L.POC, 'fixtures');
const accepted = { magenta: /magenta|fuchsia|pink|purple/i, orange: /orange/i, cyan: /cyan|aqua|turquoise/i, yellow: /yellow/i };

function timeline(h, since, t0) {
  const out = [];
  for (const e of h.events.filter((x) => x.at >= since)) {
    const m = e.msg;
    let tag = m.type + (m.subtype ? '/' + m.subtype : '') + (m.event ? '/' + m.event.type : '');
    if (m.type === 'assistant') tag += JSON.stringify((m.message.content || []).map((c) => c.type + (c.name ? ':' + c.name : '')));
    if (m.type === 'user') tag += JSON.stringify((m.message && Array.isArray(m.message.content) ? m.message.content : []).map((c) => c.type));
    const last = out[out.length - 1];
    if (last && last.tag === tag) { last.count++; last.lastMs = e.at - t0; } else out.push({ tag, ms: e.at - t0, lastMs: e.at - t0, count: 1 });
  }
  return out;
}

async function one(h, label, text, expect) {
  const rb = h.results();
  const since = Date.now();
  const s = L.runSender(h.sessionId, text);
  const obs = await L.observeTurn(h, since, 90000, rb);
  await L.sleep(500);
  const ans = L.answerText(h, since);
  const tools = h.events.filter((e) => e.at >= since && e.msg.type === 'assistant').flatMap((e) => (e.msg.message.content || []).filter((c) => c.type === 'tool_use').map((c) => c.name));
  const r = {
    label, sender: s, tools, answer: ans.slice(0, 150),
    correct: expect ? expect.test(ans) : null,
    firstEventMs: obs.firstEventAt && obs.firstEventAt - s.beforeConnect,
    toolUseMs: obs.toolUseAt && obs.toolUseAt - s.beforeConnect,
    resultMs: obs.resultAt && obs.resultAt - s.beforeConnect,
    timeline: timeline(h, since, s.beforeConnect),
  };
  console.log(JSON.stringify({ ...r, timeline: undefined }));
  return r;
}

(async () => {
  const h = L.startSession('t2', { extraArgs: ['--allowedTools', 'Read'] });
  const out = { baseline: [], path: [], array: null };
  try {
    if (!(await L.registered(h))) throw new Error('no registration; stderr ' + h.stderr().slice(0, 300));
    await L.sleep(15000);
    for (let i = 1; i <= 2; i++) { out.baseline.push(await one(h, 'baseline-' + i, 'What colour is a clear daytime sky? Answer in one word.', /blue/i)); await L.sleep(3000); }
    for (const c of ['magenta', 'orange', 'cyan']) {
      const f = path.join(FIX, c + '-64.png');
      out.path.push(await one(h, 'path-' + c, 'The user attached an image: ' + f + '. Read it and tell me its dominant colour in one word.', accepted[c]));
      await L.sleep(3000);
    }
    // ONE experimental attempt: content-block array frame
    const data = fs.readFileSync(path.join(FIX, 'yellow-64.png')).toString('base64');
    const frame = JSON.stringify({ type: 'user', message: { role: 'user', content: [
      { type: 'text', text: 'The attached image is a solid colour. Tell me its dominant colour in one word, without using any tool.' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data } }] } });
    const rb = h.results();
    const since = Date.now();
    const s = L.runSender(h.sessionId, frame, 'raw');
    const obs = await L.observeTurn(h, since, 40000, rb);
    await L.sleep(1000);
    const ans = L.answerText(h, since);
    out.array = { sender: s, turnStarted: h.results() > rb, firstEventType: obs.firstEventType, resultMs: obs.resultAt && obs.resultAt - s.beforeConnect, answer: ans.slice(0, 200), sawYellow: /yellow/i.test(ans), timeline: timeline(h, since, s.beforeConnect), eventCountSince: h.events.filter((e) => e.at >= since).length };
    console.log('ARRAY', JSON.stringify(out.array));
  } finally {
    out.exitCode = await h.stop();
    L.saveResult('t2.json', out);
    console.log('exit', out.exitCode);
  }
})().catch((e) => { console.error('T2 FAILED:', e.message); process.exit(1); });
