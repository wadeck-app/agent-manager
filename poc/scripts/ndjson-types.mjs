// Counts event types in an ndjson log from launch-streamjson.mjs and prints the 'result' events and registry snapshots in full.
import fs from 'node:fs';
const [file] = process.argv.slice(2);
if (!file) throw new Error('usage: node ndjson-types.mjs <file>');
const counts = {};
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  const d = r.data;
  const key = r.kind === 'out' ? `out:${d.type}${d.subtype ? '/' + d.subtype : ''}` : r.kind;
  counts[key] = (counts[key] || 0) + 1;
  if (r.kind === 'out' && d.type === 'result') console.log(r.t, 'RESULT', JSON.stringify(d).slice(0, 900));
  if (r.kind.startsWith('registry-') && typeof d === 'object') console.log(r.t, r.kind, JSON.stringify(d));
}
console.log(counts);
