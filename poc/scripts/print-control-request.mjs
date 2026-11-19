// Prints the first control_request of an ndjson log in full (pretty JSON).
import fs from 'node:fs';
const [file] = process.argv.slice(2);
if (!file) throw new Error('usage: node print-control-request.mjs <file>');
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  if (r.kind === 'out' && r.data.type === 'control_request') { console.log(JSON.stringify(r.data, null, 1)); break; }
}
