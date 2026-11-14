// Dev-only, READ-ONLY probe: parses the N most recently modified real Claude Code transcripts and prints shape statistics (counts, key sets,
// enumerated tags) so shape drift is visible. It never prints message text. Needs `npm run build` for the normaliser section.
// Usage: node scripts/probe-real-transcripts.mjs [--count 3] [--projects <dir>] [--verbose] [--slugs]
import { existsSync, openSync, readSync, closeSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const count = Number(opt('--count', '3'));
const projectsDir = opt('--projects', join(homedir(), '.claude', 'projects'));
const verbose = args.includes('--verbose');
const checkSlugs = args.includes('--slugs');
// Values of these fields are enumerations (never free text), safe to print.
const TAG_FIELDS = ['subtype', 'level', 'userType', 'entrypoint', 'stop_reason', 'operation', 'promptSource', 'turnOrigin', 'permissionMode', 'reason'];

const here = dirname(fileURLToPath(import.meta.url));
const distIndex = join(here, '..', 'dist', 'transcript', 'index.js');
const api = existsSync(distIndex) ? await import(pathToFileURL(distIndex).href) : undefined;
if (api === undefined) {
  console.log('NOTE: ' + distIndex + ' not found: run `npm run build` in the repository root to also check the normaliser.');
}

function newest(n) {
  const found = [];
  for (const proj of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!proj.isDirectory()) continue;
    for (const f of readdirSync(join(projectsDir, proj.name))) {
      if (!f.endsWith('.jsonl')) continue;
      const p = join(projectsDir, proj.name, f);
      try {
        found.push({ p, m: statSync(p).mtimeMs });
      } catch {
        // file vanished between readdir and stat: ignore
      }
    }
  }
  return found.sort((a, b) => b.m - a.m).slice(0, n).map(x => x.p);
}

function bump(map, key, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}
function dump(title, map) {
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + '=' + v);
  console.log('  ' + title + ': ' + (rows.length ? rows.join(', ') : '(none)'));
}

// Types the normaliser knows (handled or skipped by prefix). Anything else in a real file is shape drift.
// Seen on real files, kept as an 'unknown' entry (keys only) on purpose: not modelled yet, so not drift.
const UNMODELLED = new Set(['cost-state']);
const KNOWN_TYPES = new Set(['user', 'assistant', 'system', 'queue-operation', 'fork-context-ref', ...UNMODELLED, ...(api ? api.SKIPPED_LINE_TYPES : [])]);
const KNOWN_BLOCKS = ['text', 'thinking', 'tool_use', 'tool_result', 'image', 'redacted_thinking'];

const files = newest(count);
console.log('probe: ' + files.length + ' transcripts from ' + projectsDir);
let exitProblems = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const types = new Map();
  const keysByType = new Map();
  const tags = new Map();
  const blocks = new Map();
  const unknown = new Map();
  const unknownBlocks = new Map();
  let parseErrors = 0;
  let maxLine = 0;
  let crlf = 0;
  let blank = 0;
  for (const line of lines) {
    if (line === '') {
      blank++;
      continue;
    }
    maxLine = Math.max(maxLine, Buffer.byteLength(line));
    if (line.endsWith('\r')) crlf++;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      parseErrors++;
      continue;
    }
    const t = typeof o.type === 'string' ? o.type : '(no-type)';
    bump(types, t);
    if (!KNOWN_TYPES.has(t)) bump(unknown, t);
    const ks = keysByType.get(t) ?? new Map();
    for (const k of Object.keys(o)) bump(ks, k);
    keysByType.set(t, ks);
    for (const f of TAG_FIELDS) {
      if (typeof o[f] === 'string' && o[f].length < 40) bump(tags, t + '.' + f + ':' + o[f]);
    }
    if (o.origin && typeof o.origin === 'object') bump(tags, t + '.origin.kind:' + o.origin.kind);
    if (o.message && Array.isArray(o.message.content) && (t === 'user' || t === 'assistant')) {
      for (const b of o.message.content) {
        const bt = b && b.type;
        bump(blocks, t + '.block:' + bt);
        if (!KNOWN_BLOCKS.includes(bt)) bump(unknownBlocks, t + '.block:' + bt);
      }
    }
  }
  const name = file.split(/[\\/]/).slice(-2).join('/');
  console.log('\n' + name + ' bytes=' + Buffer.byteLength(text) + ' lines=' + (lines.length - blank) + ' maxLineBytes=' + maxLine + ' crlf=' + crlf + ' parseErrors=' + parseErrors);
  dump('line types', types);
  dump('UNKNOWN line types (not known to the normaliser)', unknown);
  dump('UNKNOWN content blocks', unknownBlocks);
  if (parseErrors > 0 || unknown.size > 0 || unknownBlocks.size > 0) exitProblems++;
  if (verbose) {
    for (const [t, ks] of keysByType) dump('keys[' + t + ']', ks);
    dump('tags', tags);
    dump('blocks', blocks);
  }
  if (api !== undefined) {
    const tailer = new api.TranscriptTailer();
    const t0 = performance.now();
    let state = api.createTailerState();
    const kinds = new Map();
    const statuses = new Map();
    let reads = 0;
    for (;;) {
      const r = await tailer.readNew(file, state, { maxBytes: 1 << 20 });
      if (r.error) {
        console.log('  normaliser ERROR: ' + r.error.message);
        exitProblems++;
        break;
      }
      for (const e of r.entries) {
        bump(kinds, e.kind);
        if (e.kind === 'tool-call') bump(statuses, e.status + (e.orphan ? '/orphan' : ''));
      }
      state = r.state;
      reads++;
      if (!r.more) break;
    }
    const ms = Math.round(performance.now() - t0);
    console.log('  normaliser: ' + reads + ' reads, ' + ms + ' ms, offset ' + state.offset + '/' + state.size);
    dump('entries', kinds);
    dump('tool-call entry statuses (running = no result yet)', statuses);
    console.log('  counts: ' + JSON.stringify({ lines: state.counts.lines, oversize: state.counts.oversize, parseErrors: state.counts.parseErrors, unknown: state.counts.unknown, skipped: state.counts.skipped }));
    // Consistency: every line skipped by the normaliser must be of a type the raw census saw, with the same count.
    const mismatch = [];
    for (const [type, n] of Object.entries(state.counts.skipped)) {
      if ((types.get(type) ?? 0) !== n) mismatch.push(type + ' normaliser=' + n + ' raw=' + (types.get(type) ?? 0));
    }
    if (mismatch.length > 0) {
      console.log('  MISMATCH skipped counts (a line may have been appended during the run): ' + mismatch.join(', '));
      exitProblems++;
    }
    const rawTotal = lines.length - blank;
    if (Math.abs(rawTotal - state.counts.lines) > 2) {
      console.log('  MISMATCH total lines normaliser=' + state.counts.lines + ' raw=' + rawTotal);
      exitProblems++;
    }
  }
}

if (checkSlugs) {
  if (api === undefined) {
    console.log('\n--slugs needs the build (projectSlug).');
    process.exit(2);
  }
  let ok = 0;
  const bad = [];
  let noCwd = 0;
  for (const proj of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!proj.isDirectory()) continue;
    const jsonls = readdirSync(join(projectsDir, proj.name)).filter(f => f.endsWith('.jsonl'));
    if (jsonls.length === 0) continue;
    const fd = openSync(join(projectsDir, proj.name, jsonls[0]), 'r');
    const buf = Buffer.alloc(262144);
    const n = readSync(fd, buf, 0, buf.length, 0);
    closeSync(fd);
    const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(buf.toString('utf8', 0, n));
    if (!m) {
      noCwd++;
      continue;
    }
    const cwd = JSON.parse('"' + m[1] + '"');
    if (api.projectSlug(cwd) === proj.name) ok++;
    else bad.push(proj.name + ' <- ' + cwd);
  }
  console.log('\nslug rule over project folders: match=' + ok + ' mismatch=' + bad.length + ' noCwdInFirst256KB=' + noCwd);
  for (const b of bad.slice(0, 10)) console.log('  mismatch: ' + b);
}

console.log('\nprobe done: ' + (exitProblems === 0 ? 'no shape drift detected' : exitProblems + ' file(s) with drift or problems (see above)'));
process.exit(exitProblems === 0 ? 0 : 1);
