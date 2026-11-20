// Prints one event list of a compare-launch log without noise. Usage: node compare-events.mjs <log> <kind>
import fs from 'node:fs';
const [file, kind] = process.argv.slice(2);
if (!file || !kind) throw new Error('usage: node compare-events.mjs <log> <kind>');
for (const l of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
  const o = JSON.parse(l);
  if (o.kind !== kind) continue;
  for (const e of o.data) {
    if (e.k === 'tr' && /^(attachment|custom-title|agent-name|mode|permission-mode|atis-latch|file-history-snapshot|last-prompt|ai-title)/.test(e.v)) continue;
    console.log(e.t, e.k, String(e.v ?? '').slice(0, 130));
  }
}
