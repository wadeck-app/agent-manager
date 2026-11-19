// Prints a compact view of an ndjson log written by launch-streamjson.mjs (long strings truncated).
import fs from 'node:fs';
const [file, max = '260'] = process.argv.slice(2);
if (!file) throw new Error('usage: node summarize-ndjson.mjs <file> [maxChars]');
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  let s = JSON.stringify(r.data);
  s = s.replace(/"data":"[A-Za-z0-9+/=]{40,}"/g, '"data":"<base64>"');
  if (s.length > +max) s = s.slice(0, +max) + '...';
  console.log(String(r.t).padStart(6), r.kind, s);
}
