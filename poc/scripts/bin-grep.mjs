// Read-only scan of the installed Claude Code binary: prints context around each match of a regex (latin1, first N matches).
import fs from 'node:fs';
const [file, pattern, ctx = '200', max = '5'] = process.argv.slice(2);
if (!file || !pattern) throw new Error('usage: node bin-grep.mjs <file> <regex> [ctxChars] [maxMatches]');
const s = fs.readFileSync(file, 'latin1');
const re = new RegExp(pattern, 'g');
let m, n = 0;
while ((m = re.exec(s)) && n < +max) {
  n++;
  const a = Math.max(0, m.index - +ctx), b = Math.min(s.length, m.index + m[0].length + +ctx);
  console.log(`--- offset ${m.index}\n${s.slice(a, b).replace(/[^\x20-\x7e\n]/g, '.')}`);
}
console.log(`matches shown: ${n}`);
