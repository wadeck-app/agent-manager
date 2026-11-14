'use strict';
// M4 reply side, manual end-to-end check (iteration 2b). Starts ONE headless Claude Code session (haiku, 1 model turn expected),
// sends ONE reply through ReplyService (compiled core package) against THAT session only, and checks that the turn starts and that
// deliveryState reaches 'confirmed' from the session transcript.
// SAFETY: the registry given to the service is filtered to the session started here; no other session or token file is ever addressed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const L = require('./lib');

const CORE = path.resolve(__dirname, '..', '..', 'packages', 'agent-manager-core', 'dist');
const SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');

(async () => {
  const core = await import(pathToFileURL(path.join(CORE, 'index.js')).href);
  const reply = await import(pathToFileURL(path.join(CORE, 'reply', 'index.js')).href);
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-manager-e2e-'));
  const h = L.startSession('m4-reply-e2e', {});
  const out = { sessionId: h.sessionId, steps: [] };
  const step = (name, value) => { out.steps.push({ name, value }); console.log(name, JSON.stringify(value)); };
  try {
    const reg = await L.registered(h);
    if (!reg) throw new Error('session did not register within 40 s; stderr: ' + h.stderr().slice(0, 300));
    step('registered', { pid: reg.pid, status: reg.status });
    await L.sleep(3000);

    const service = reply.createReplyService({
      configDir,
      transports: [reply.socketTransport, reply.asyncRewakeTransport],
      // Only the session started by this script is visible to the service.
      readSessions: async () => {
        const registry = await core.readSessionRegistry(SESSIONS_DIR);
        if (!registry.ok) return registry;
        return { ...registry, sessions: registry.sessions.filter((s) => s.sessionId === h.sessionId) };
      },
    });
    const registry = await core.readSessionRegistry(SESSIONS_DIR);
    const mine = registry.sessions.filter((s) => s.sessionId === h.sessionId);
    step('transport-status', await service.getTransportStatus(mine));

    const word = 'ack-M4-' + crypto.randomBytes(2).toString('hex');
    const since = Date.now();
    const resultsBefore = h.results();
    const record = await service.send({ sessionId: h.sessionId, text: 'Reply with exactly the single word ' + word, id: crypto.randomUUID() });
    step('send', record);
    const obs = await L.observeTurn(h, since, 90000, resultsBefore);
    step('observed', { turnStarted: obs.firstEventAt !== null, firstEventMs: obs.firstEventAt && obs.firstEventAt - since, resultMs: obs.resultAt && obs.resultAt - since, answered: L.answerText(h, since).includes(word) });

    await L.sleep(1500);
    const file = L.findTranscript(h.sessionId);
    const entries = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
    const status = service.deliveryState(record, entries, { sessionStatus: 'idle' });
    step('deliveryState', status);
    out.confirmed = status.state === 'confirmed';
    const audit = await reply.readAudit(configDir);
    step('audit', audit.records.map((r) => ({ outcome: r.outcome, transport: r.transport, msgId: r.msgId })));
  } finally {
    out.exitCode = await h.stop();
    console.log('session exit code', out.exitCode, 'confirmed:', out.confirmed);
    console.log('results (model turns):', h.results());
  }
})().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });
