'use strict';
// Blocking Stop hook "hot wait": long-polls up to WAIT_MS for results/reply-<sessionId>.txt.
// Found: prints {decision:'block', reason:<text>} on stdout (exit 0). Not found: exits 0 silently (session may stop).
// Logs to results/hotwait-<sessionId>.log (JSON lines, epoch ms).
const fs = require('fs');
const path = require('path');
const RES = path.join(__dirname, '..', 'results');
const WAIT_MS = Number(process.env.POC_HOTWAIT_MS || 15000);
const t0 = Date.now();

let buf = '';
let finished = false;
const run = () => {
  if (finished) return;
  finished = true;
  let input = {};
  try { input = JSON.parse(buf); } catch (_) { /* keep {} */ }
  const id = input.session_id || 'unknown';
  const log = (o) => fs.appendFileSync(path.join(RES, 'hotwait-' + id + '.log'), JSON.stringify({ at: Date.now(), pid: process.pid, ...o }) + '\n');
  log({ ev: 'start', stop_hook_active: input.stop_hook_active, last: String(input.last_assistant_message || '').slice(0, 40), maxWaitMs: WAIT_MS });
  const file = path.join(RES, 'reply-' + id + '.txt');
  const iv = setInterval(() => {
    let text = null;
    try { text = fs.readFileSync(file, 'utf8'); fs.unlinkSync(file); } catch (_) { /* not yet */ }
    if (text !== null) {
      clearInterval(iv);
      log({ ev: 'found', waitedMs: Date.now() - t0, maxRSS_KB: process.resourceUsage().maxRSS });
      process.stdout.write(JSON.stringify({ decision: 'block', reason: text }), () => process.exit(0));
    } else if (Date.now() - t0 >= WAIT_MS) {
      clearInterval(iv);
      log({ ev: 'expired', waitedMs: Date.now() - t0 });
      process.exit(0);
    }
  }, 200);
};
const timer = setTimeout(run, 1500);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { buf += c; try { JSON.parse(buf); clearTimeout(timer); run(); } catch (_) { /* partial */ } });
process.stdin.on('end', () => { clearTimeout(timer); run(); });
