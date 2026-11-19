// Prints type/origin/promptSource/turnOrigin/isMeta and a trimmed content for user lines of a transcript .jsonl.
import fs from 'node:fs';
const [file] = process.argv.slice(2);
if (!file) throw new Error('usage: node transcript-user-lines.mjs <transcript.jsonl>');
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  if (r.type !== 'user' && r.type !== 'queue-operation' && r.type !== 'attachment') continue;
  const c = r.message?.content ?? r.content;
  const s = typeof c === 'string' ? c : JSON.stringify(c)?.replace(/"data":"[A-Za-z0-9+\/=]{40,}"/g, '"data":"<base64>"');
  console.log(JSON.stringify({ type: r.type, op: r.operation, origin: r.origin, promptSource: r.promptSource, turnOrigin: r.turnOrigin, isMeta: r.isMeta, entrypoint: r.entrypoint, sessionKind: r.sessionKind, content: s?.slice(0, 160) }));
}
