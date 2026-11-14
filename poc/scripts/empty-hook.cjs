'use strict';
// Empty hook: reads stdin JSON, exits 0. EMPTY_HOOK_RSS=1 prints the peak RSS (KB) on stderr (measurement only).
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { buf += c; });
process.stdin.on('end', () => {
  try { JSON.parse(buf); } catch (_) { process.exit(2); }
  if (process.env.EMPTY_HOOK_RSS === '1') process.stderr.write(String(process.resourceUsage().maxRSS));
  process.exit(0);
});
