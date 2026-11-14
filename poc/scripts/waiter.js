'use strict';
// asyncRewake hook process. Polls results/inbox-<sessionId>.txt every 200 ms; when present: consumes it, prints the text on
// stderr and exits 2 (= wake the model). Singleton per session (pid file) so SessionStart + Stop do not stack waiters.
// Logs to results/waiter-<sessionId>.log (JSON lines, epoch ms).
const fs = require('fs');
const path = require('path');
const RES = path.join(__dirname, '..', 'results');
const t0 = Date.now();

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    let finished = false;
    const done = () => { if (finished) return; finished = true; try { resolve(JSON.parse(buf)); } catch (_) { resolve({}); } };
    const timer = setTimeout(done, 1500);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; try { JSON.parse(buf); clearTimeout(timer); done(); } catch (_) { /* partial */ } });
    process.stdin.on('end', () => { clearTimeout(timer); done(); });
    process.stdin.on('error', () => { clearTimeout(timer); done(); });
  });
}

(async () => {
  const input = await readStdin();
  const id = input.session_id || 'unknown';
  const log = (o) => fs.appendFileSync(path.join(RES, 'waiter-' + id + '.log'), JSON.stringify({ at: Date.now(), pid: process.pid, ...o }) + '\n');
  const pidFile = path.join(RES, 'waiter-' + id + '.pid');
  try {
    const other = Number(fs.readFileSync(pidFile, 'utf8'));
    if (other && other !== process.pid) {
      let alive = true;
      try { process.kill(other, 0); } catch (_) { alive = false; }
      if (alive) { log({ ev: 'skip', event: input.hook_event_name, otherPid: other }); process.exit(0); }
    }
  } catch (_) { /* no pid file */ }
  fs.writeFileSync(pidFile, String(process.pid));
  log({ ev: 'start', event: input.hook_event_name, stop_hook_active: input.stop_hook_active, startupMs: Date.now() - t0 });
  const inbox = path.join(RES, 'inbox-' + id + '.txt');
  let last = 0;
  const poll = setInterval(() => {
    const now = Date.now();
    if (now - last >= 2000) { last = now; log({ ev: 'hb', maxRSS_KB: process.resourceUsage().maxRSS, cpuUs: process.cpuUsage().user + process.cpuUsage().system }); }
    let text;
    try { text = fs.readFileSync(inbox, 'utf8'); fs.unlinkSync(inbox); } catch (_) { return; }
    clearInterval(poll);
    log({ ev: 'wake', text: text.slice(0, 80), maxRSS_KB: process.resourceUsage().maxRSS, cpuUs: process.cpuUsage().user + process.cpuUsage().system, waitedMs: Date.now() - t0 });
    try { fs.unlinkSync(pidFile); } catch (_) { /* gone */ }
    process.stderr.write(text, () => process.exit(2));
  }, 200);
})();
