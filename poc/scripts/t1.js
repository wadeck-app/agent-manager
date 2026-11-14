'use strict';
// T1: socket sender on an idle headless session (2.1.325). n samples (max 5).
const L = require('./lib');
const N = Number(process.argv[2] || 5);

(async () => {
  const h = L.startSession('t1', {});
  const out = { samples: [] };
  try {
    const reg = await L.registered(h);
    if (!reg) throw new Error('session did not register within 40 s; stderr: ' + h.stderr().slice(0, 300));
    out.registry = { spawnPid: h.pid, registryPid: reg.pid, keys: Object.keys(reg).sort(), status: reg.status };
    console.log('registered', JSON.stringify(out.registry));
    await L.sleep(20000);
    const snap = L.snapshot();
    const tr = L.tree(h.pid, snap);
    out.idle = { processes: tr.length, wsMB: tr.reduce((s, p) => s + p.wsMB, 0), privMB: tr.reduce((s, p) => s + p.privMB, 0), procs: tr.map((p) => p.name + ':' + p.pid) };
    console.log('idle', JSON.stringify(out.idle));

    for (let i = 1; i <= N; i++) {
      const word = 'ack-T1-' + i;
      const resultsBefore = h.results();
      const since = Date.now();
      // sender runs as a separate process (spawn + node startup is included in its own wall time, but the latency
      // reference is its beforeConnect timestamp)
      const s = L.runSender(h.sessionId, 'T1 message from a script. Reply with exactly the single word ' + word);
      const obs = await L.observeTurn(h, since, 90000, resultsBefore);
      const ans = L.answerText(h, since);
      const sample = {
        i, sender: s,
        latencyToTranscriptMs: obs.transcriptAt && obs.transcriptAt - s.beforeConnect,
        latencyToFirstStreamEventMs: obs.firstEventAt && obs.firstEventAt - s.beforeConnect,
        firstEventType: obs.firstEventType,
        latencyToAssistantMs: obs.assistantAt && obs.assistantAt - s.beforeConnect,
        latencyToResultMs: obs.resultAt && obs.resultAt - s.beforeConnect,
        answered: ans.includes(word), answer: ans.slice(0, 120),
      };
      out.samples.push(sample);
      console.log(JSON.stringify(sample));
      if (!sample.answered) { console.log('STOP: sample did not get the expected answer'); break; }
      await L.sleep(4000);
    }
    const col = (k) => out.samples.map((x) => x[k]).filter((v) => typeof v === 'number');
    out.summary = {
      transcript: L.stats(col('latencyToTranscriptMs')), firstEvent: L.stats(col('latencyToFirstStreamEventMs')),
      assistant: L.stats(col('latencyToAssistantMs')), result: L.stats(col('latencyToResultMs')),
      senderWallMs: L.stats(out.samples.map((x) => x.sender.wallMs)), senderWallNoGraceMs: L.stats(out.samples.map((x) => x.sender.wallMsWithoutGrace)),
      senderMaxRSS_KB: L.stats(out.samples.map((x) => x.sender.maxRSS_KB)),
    };
    console.log(JSON.stringify(out.summary, null, 1));
  } finally {
    out.exitCode = await h.stop();
    out.stderr = h.stderr().slice(0, 500);
    L.saveResult('t1.json', out);
    console.log('session exit code', out.exitCode);
  }
})().catch((e) => { console.error('T1 FAILED:', e.message); process.exit(1); });
