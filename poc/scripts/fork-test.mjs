// Fork measurement (research/session-fork.md): at most 4 Haiku prompts, one process at a time, no loops.
// Usage: node fork-test.mjs <phase> <workdir> [args]
//   create <workdir>                      prompts 1+2 (one stream-json process, 2 messages); prints session id + transcript path + hash
//   full   <workdir> <sourceId>           prompt 3: --resume <id> --fork-session -p "<question>"
//   at     <workdir> <sourceId> <uuid>    prompt 4: --resume <id> --fork-session --resume-session-at <uuid> -p "<question>"
//   dump   <workdir> <sessionId>          prints the uuid / parentUuid / type chain of a transcript (no model call)
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [phase, workdir, a1, a2] = process.argv.slice(2);
if (!phase || !workdir) throw new Error('usage: node fork-test.mjs <create|full|at|dump> <workdir> [sourceId] [uuid]');
fs.mkdirSync(workdir, { recursive: true });

// Project folder slug: every non-alphanumeric char of the absolute cwd becomes '-' (documented, see research doc).
const slug = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');
const transcriptPath = (cwd, id) => path.join(os.homedir(), '.claude', 'projects', slug(fs.realpathSync(cwd)), `${id}.jsonl`);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 16);
const QUESTION = 'List every secret word I gave you in this conversation, as a comma separated list, nothing else. If none, answer NONE.';

function runPrint(args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd: workdir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('exit', (code) => resolve({ label, code, out, err }));
    child.on('error', reject);
  });
}

if (phase === 'create') {
  const sessionId = crypto.randomUUID();
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--replay-user-messages',
    '--model', 'haiku', '--session-id', sessionId, '--setting-sources', 'project', '--permission-mode', 'default'];
  const child = spawn('claude', args, { cwd: workdir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buf = '', results = 0, sent = 1;
  const events = [];
  const send = (text) => {
    const uuid = crypto.randomUUID();
    child.stdin.write(JSON.stringify({ type: 'user', uuid, message: { role: 'user', content: text } }) + '\n');
    events.push({ sent: text, uuid });
  };
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const o = JSON.parse(line);
      if (o.type === 'result') {
        results++;
        events.push({ result: o.subtype, text: o.result, session_id: o.session_id });
        if (results === 1 && sent === 1) { sent = 2; send('Another secret word is BRAVO. Reply exactly OK2. No tools.'); }
        else if (results === 2) child.stdin.end();
      }
    }
  });
  child.stderr.on('data', (d) => events.push({ stderr: String(d) }));
  child.on('exit', (code) => {
    const tp = transcriptPath(workdir, sessionId);
    console.log(JSON.stringify({ code, sessionId, transcript: tp, exists: fs.existsSync(tp), hash: fs.existsSync(tp) ? sha(tp) : null, events }, null, 2));
  });
  send('The first secret word is ALPHA. Remember it. Reply exactly OK1. No tools.');
} else if (phase === 'dump') {
  const tp = transcriptPath(workdir, a1);
  for (const l of fs.readFileSync(tp, 'utf8').split('\n').filter(Boolean)) {
    const o = JSON.parse(l);
    const txt = typeof o.message?.content === 'string' ? o.message.content : JSON.stringify(o.message?.content ?? '').slice(0, 70);
    console.log([o.type, o.uuid, 'parent=' + o.parentUuid, 'sid=' + o.sessionId, o.isSidechain ? 'sidechain' : '', o.forkedFrom ? 'forkedFrom=' + JSON.stringify(o.forkedFrom) : '', txt.slice(0, 70)].join(' | '));
  }
  console.log('hash', sha(tp), 'bytes', fs.statSync(tp).size);
} else if (phase === 'full' || phase === 'at') {
  const src = transcriptPath(workdir, a1);
  const before = { hash: sha(src), bytes: fs.statSync(src).size };
  const args = ['-p', '--output-format', 'json', '--model', 'haiku', '--setting-sources', 'project', '--permission-mode', 'default', '--resume', a1, '--fork-session'];
  if (phase === 'at') args.push('--resume-session-at', a2);
  args.push(QUESTION);
  const r = await runPrint(args, phase);
  let parsed = null;
  try { parsed = JSON.parse(r.out); } catch { /* raw output reported below */ }
  const after = { hash: sha(src), bytes: fs.statSync(src).size };
  const forkId = parsed?.session_id;
  const forkTp = forkId ? transcriptPath(workdir, forkId) : null;
  console.log(JSON.stringify({ args: args.slice(0, -1), code: r.code, stderr: r.err.slice(0, 800), result: parsed ? { subtype: parsed.subtype, result: parsed.result, session_id: parsed.session_id, is_error: parsed.is_error } : r.out.slice(0, 800),
    sourceBefore: before, sourceAfter: after, sourceUnchanged: before.hash === after.hash, forkTranscript: forkTp, forkExists: forkTp ? fs.existsSync(forkTp) : null }, null, 2));
} else throw new Error('unknown phase ' + phase);
