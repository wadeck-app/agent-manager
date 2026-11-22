// Dev-only: kinds and meta of the entries of a saved log answer (stdin path as argument).
import fs from 'node:fs';
const body = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const kinds = {};
for (const e of body.entries) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
console.log(body.entries.length, kinds);
for (const e of body.entries) if (e.kind === 'tool-call') console.log(e.name, JSON.stringify(e.meta));
