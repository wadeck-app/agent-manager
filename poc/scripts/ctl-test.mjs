// Round 2 PoCs (Haiku, 1-2 turns per session, one session at a time). Usage:
//   node ctl-test.mjs interrupt | setmode | resume-turn | resume-perm
//   node ctl-test.mjs survive-parent <detached 0|1> <withMsg 0|1>   (spawns a child, then exits WITHOUT closing stdin)
//   node ctl-test.mjs watch <pid> <seconds>                          (polls a pid once per second, prints changes)
//   node ctl-test.mjs kill <pid>                                     (taskkill /PID /T /F, only for a pid printed by this script)
// All logs: %TEMP%/am-research4/<name>.ndjson. Never writes under ~/.claude (read-only access to transcripts/registry).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const BASE = path.join(process.env.TEMP, 'am-research4');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uuid = () => crypto.randomUUID();
fs.mkdirSync(BASE, { recursive: true });

function brief(ev) {
  const s = ev.subtype ? `/${ev.subtype}` : '';
  switch (ev.type) {
    case 'assistant':
      return 'assistant ' + JSON.stringify(ev.message.content.map((b) => (b.type === 'text' ? { text: b.text.slice(0, 70) } : b.type === 'tool_use' ? { tool_use: b.name, input: b.input } : { [b.type]: 1 }))) + ' stop=' + ev.message.stop_reason;
    case 'user':
      return 'user ' + JSON.stringify(ev.message.content).slice(0, 200) + (ev.isReplay ? ' [isReplay]' : '');
    case 'result':
      return `result${s} stop=${ev.stop_reason} is_error=${ev.is_error} terminal=${ev.terminal_reason ?? ''} text=${JSON.stringify(String(ev.result ?? '').slice(0, 80))}`;
    case 'control_request':
    case 'control_response':
      return ev.type + ' ' + JSON.stringify(ev).slice(0, 420);
    default:
      return `${ev.type}${s} ` + JSON.stringify(ev).slice(0, 220);
  }
}

function start(name, { cwd, extra = [], perm = false, partial = false, onEvent }) {
  fs.mkdirSync(cwd, { recursive: true });
  const out = fs.createWriteStream(path.join(BASE, name + '.ndjson'), { flags: 'w' });
  const t0 = Date.now();
  const log = (kind, data) => out.write(JSON.stringify({ t: Date.now() - t0, kind, data }) + '\n');
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--replay-user-messages',
    '--model', 'haiku', '--setting-sources', 'project', '--permission-mode', 'default',
    ...(perm ? ['--permission-prompt-tool', 'stdio'] : []), ...(partial ? ['--include-partial-messages'] : []), ...extra];
  console.log(`[${name}] spawn: claude ${args.join(' ')}  (cwd ${cwd})`);
  const child = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const c = { child, events: [], exit: null, deltas: 0, thinking: 0, t0 };
  console.log(`[${name}] pid ${child.pid}`);
  child.on('exit', (code, sig) => { c.exit = { code, sig }; line(`EXIT code=${code} sig=${sig}`); log('exit', c.exit); });
  child.stderr.on('data', (d) => { line('STDERR ' + d.toString().trim().slice(0, 300)); log('stderr', d.toString()); });
  const line = (s) => console.log(`[${name} +${String(Date.now() - t0).padStart(6)}ms] ${s}`);
  c.line = line;
  c.send = (obj) => { log('send', obj); line('SEND ' + JSON.stringify(obj).slice(0, 420)); child.stdin.write(JSON.stringify(obj) + '\n'); };
  c.until = async (pred, ms, what) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (c.events.some(pred)) return true; if (c.exit) return false; await sleep(50); }
    line(`TIMEOUT waiting for ${what}`);
    return false;
  };
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!l.trim()) continue;
      let ev; try { ev = JSON.parse(l); } catch { log('nonjson', l); line('NONJSON ' + l.slice(0, 200)); continue; }
      log('out', ev); c.events.push(ev);
      if (ev.type === 'stream_event') { c.deltas++; continue; }
      if (ev.type === 'system' && ev.subtype === 'thinking_tokens') { c.thinking++; continue; }
      line('RECV ' + brief(ev));
      onEvent?.(ev, c);
    }
  });
  c.finish = async () => {
    if (!c.exit) { child.stdin.end(); await c.until(() => false, 8000, 'exit after stdin close'); }
    if (!c.exit) { line('still alive after stdin close; killing own child'); child.kill(); await sleep(500); }
    out.end();
  };
  c.kill = () => { line(`taskkill /PID ${child.pid} /T /F`); const r = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8' }); line('taskkill -> ' + (r.stdout + r.stderr).trim().slice(0, 200)); };
  return c;
}

const user = (content) => ({ type: 'user', uuid: uuid(), message: { role: 'user', content } });
const ctl = (request) => ({ type: 'control_request', request_id: uuid(), request });
const isResult = (e) => e.type === 'result';

function findTranscript(sid) {
  const root = path.join(os.homedir(), '.claude', 'projects');
  for (const d of fs.readdirSync(root)) { const f = path.join(root, d, sid + '.jsonl'); if (fs.existsSync(f)) return f; }
  return null;
}
function dumpTranscript(sid) {
  const f = findTranscript(sid);
  console.log(`--- transcript ${f}`);
  if (!f) return;
  for (const l of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
    const o = JSON.parse(l);
    const m = o.message;
    const blocks = Array.isArray(m?.content) ? m.content.map((b) => (b.type === 'text' ? `text:${JSON.stringify(b.text.slice(0, 60))}` : b.type === 'tool_use' ? `tool_use:${b.name}:${JSON.stringify(b.input).slice(0, 60)}` : b.type === 'tool_result' ? `tool_result(err=${b.is_error}):${JSON.stringify(b.content).slice(0, 60)}` : b.type)) : typeof m?.content === 'string' ? [`str:${JSON.stringify(m.content.slice(0, 80))}`] : [];
    console.log(`  ${o.type}${o.subtype ? '/' + o.subtype : ''}${o.operation ? ' ' + o.operation : ''}${o.promptSource ? ' promptSource=' + o.promptSource : ''}${o.isMeta ? ' meta' : ''} ${blocks.join(' | ')}${o.content && typeof o.content === 'string' ? ' content=' + JSON.stringify(o.content.slice(0, 80)) : ''}`);
  }
}
function registry(pid) {
  const f = path.join(os.homedir(), '.claude', 'sessions', pid + '.json');
  console.log(`--- registry ${f}: ` + (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').replace(/"messagingSocketPath":"[^"]*",?/, '') : 'ABSENT'));
}

const [cmd, a1, a2] = process.argv.slice(2);

if (cmd === 'interrupt') {
  const sid = uuid(); const cwd = path.join(BASE, 't1');
  const c = start('t1-interrupt', { cwd, partial: true, extra: ['--session-id', sid] });
  console.log('sessionId', sid);
  await sleep(2000);
  c.send(user('Count from 1 to 3000, one number per line. No tools, no commentary.'));
  await c.until((e) => e.type === 'stream_event' && JSON.stringify(e).includes('text_delta'), 150000, 'first text_delta');
  await sleep(1500);
  const before = c.deltas;
  c.line(`deltas before interrupt: ${before}`);
  const req = ctl({ subtype: 'interrupt' });
  c.send(req);
  await c.until((e) => e.type === 'control_response' && e.response?.request_id === req.request_id, 15000, 'interrupt control_response');
  await c.until(isResult, 30000, 'result of interrupted turn');
  await sleep(1500);
  c.line(`deltas after interrupt: ${c.deltas - before}`);
  const n = c.events.filter(isResult).length;
  c.send(user('Reply with exactly: PONG2'));
  await c.until((e) => isResult(e) && c.events.filter(isResult).length > n, 60000, 'result of turn 2');
  registry(c.child.pid);
  await c.finish();
  dumpTranscript(sid);
} else if (cmd === 'setmode') {
  const sid = uuid(); const cwd = path.join(BASE, 't2');
  fs.rmSync(path.join(cwd, 'am-mode1.txt'), { force: true }); fs.rmSync(path.join(cwd, 'am-mode2.txt'), { force: true });
  let prompts = [];
  const c = start('t2-setmode', {
    cwd, perm: true, extra: ['--session-id', sid],
    onEvent: (ev, cc) => {
      if (ev.type === 'control_request' && ev.request?.subtype === 'can_use_tool') {
        prompts.push(ev.request.input?.command);
        // answer deny for the touch of turn 2, allow otherwise (nothing must hang)
        const deny = String(ev.request.input?.command ?? '').includes('am-mode2');
        cc.send({ type: 'control_response', response: { subtype: 'success', request_id: ev.request_id, response: deny ? { behavior: 'deny', message: 'Denied by the research host (mode test).' } : { behavior: 'allow', updatedInput: ev.request.input } } });
      }
    },
  });
  console.log('sessionId', sid);
  await sleep(2000);
  const r1 = ctl({ subtype: 'set_permission_mode', mode: 'acceptEdits' });
  c.send(r1);
  await c.until((e) => e.type === 'control_response' && e.response?.request_id === r1.request_id, 10000, 'set_permission_mode(acceptEdits) response');
  c.send(user('Run exactly this Bash command and nothing else: touch am-mode1.txt . Then reply DONE1.'));
  await c.until(isResult, 90000, 'result turn 1');
  c.line(`can_use_tool prompts so far (expect none under acceptEdits): ${JSON.stringify(prompts)}`);
  console.log('am-mode1.txt exists:', fs.existsSync(path.join(cwd, 'am-mode1.txt')));
  registry(c.child.pid);
  const r2 = ctl({ subtype: 'set_permission_mode', mode: 'default' });
  c.send(r2);
  await c.until((e) => e.type === 'control_response' && e.response?.request_id === r2.request_id, 10000, 'set_permission_mode(default) response');
  c.send(user('Run exactly this Bash command and nothing else: touch am-mode2.txt . If refused, do not retry. Then reply DONE2.'));
  await c.until((e) => isResult(e) && c.events.filter(isResult).length >= 2, 90000, 'result turn 2');
  c.line(`can_use_tool prompts total: ${JSON.stringify(prompts)}`);
  console.log('am-mode2.txt exists (expect false, denied):', fs.existsSync(path.join(cwd, 'am-mode2.txt')));
  registry(c.child.pid);
  await c.finish();
} else if (cmd === 'survive-parent') {
  const detached = a1 === '1'; const withMsg = a2 === '1' || a2 === '2'; const longMsg = a2 === '2';
  const cwd = path.join(BASE, `t3-${detached ? 'det' : 'attached'}-${longMsg ? 'longmsg' : withMsg ? 'msg' : 'nomsg'}`);
  fs.mkdirSync(cwd, { recursive: true });
  const outFd = fs.openSync(path.join(cwd, 'child-stdout.ndjson'), 'w');
  const errFd = fs.openSync(path.join(cwd, 'child-stderr.txt'), 'w');
  const child = spawn('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', 'haiku',
    '--session-id', uuid(), '--setting-sources', 'project', '--permission-mode', 'default'],
  { cwd, stdio: ['pipe', outFd, errFd], detached, windowsHide: true });
  console.log(`child pid ${child.pid} detached=${detached} withMsg=${withMsg} parentExitAt=${new Date(Date.now() + 4500).toISOString()} cwd=${cwd}`);
  child.unref();
  await sleep(3000);
  if (withMsg) child.stdin.write(JSON.stringify(user(longMsg ? 'Count from 1 to 3000, one number per line. No tools, no commentary.' : 'Reply with exactly: ALIVE')) + '\n');
  await sleep(1500);
  { let a = true; try { process.kill(child.pid, 0); } catch (e) { a = e.code === 'EPERM'; } console.log('child alive just before parent exit:', a); }
  // exit WITHOUT closing stdin
  process.exit(0);
} else if (cmd === 'watch') {
  const pid = Number(a1); const secs = Number(a2);
  if (!Number.isInteger(pid) || !(secs > 0 && secs <= 40)) throw new Error('usage: watch <pid> <seconds<=40>');
  let last = null;
  for (let i = 0; i <= secs; i++) {
    let alive = true; try { process.kill(pid, 0); } catch (e) { alive = e.code === 'EPERM'; }
    if (alive !== last) console.log(`${new Date().toISOString()} +${i}s pid ${pid} alive=${alive}`);
    last = alive;
    await sleep(1000);
  }
  console.log(`final alive=${last}`);
} else if (cmd === 'kill') {
  const r = spawnSync('taskkill', ['/PID', String(Number(a1)), '/T', '/F'], { encoding: 'utf8' });
  console.log((r.stdout + r.stderr).trim());
} else if (cmd === 'resume-turn' || cmd === 'resume-perm') {
  const perm = cmd === 'resume-perm';
  const sid = uuid(); const cwd = path.join(BASE, perm ? 't4b' : 't4a');
  fs.mkdirSync(cwd, { recursive: true });
  fs.rmSync(path.join(cwd, 'am-pending.txt'), { force: true });
  // phase 1: start the turn, kill the child mid-flight
  let pendingReq = null;
  const c1 = start(perm ? 't4b-first' : 't4a-first', {
    cwd, perm, partial: !perm, extra: ['--session-id', sid],
    onEvent: (ev) => { if (ev.type === 'control_request' && ev.request?.subtype === 'can_use_tool') pendingReq = ev; },
  });
  console.log('sessionId', sid);
  await sleep(2000);
  if (perm) {
    c1.send(user('Run exactly this Bash command and nothing else: touch am-pending.txt . Then reply DONE.'));
    await c1.until((e) => e.type === 'control_request', 60000, 'can_use_tool request');
    await sleep(500);
    c1.line('pending permission request NOT answered; killing the child');
  } else {
    c1.send(user('Count from 1 to 3000, one number per line. No tools, no commentary. (marker: PENDING-TURN-4A)'));
    await c1.until((e) => e.type === 'stream_event' && JSON.stringify(e).includes('text_delta'), 150000, 'first text_delta');
    await sleep(1000);
    c1.line(`deltas so far ${c1.deltas}; killing the child mid-turn`);
  }
  c1.kill();
  await sleep(1500);
  console.log('am-pending.txt exists after kill:', fs.existsSync(path.join(cwd, 'am-pending.txt')));
  registry(c1.child.pid);
  dumpTranscript(sid);
  // phase 2: resume in stream-json
  const c2 = start(perm ? 't4b-resume' : 't4a-resume', {
    cwd, perm, extra: ['--resume', sid],
    onEvent: (ev, cc) => {
      if (ev.type === 'control_request' && ev.request?.subtype === 'can_use_tool') {
        cc.send({ type: 'control_response', response: { subtype: 'success', request_id: ev.request_id, response: { behavior: 'deny', message: 'Denied by the research host (resume test).' } } });
      }
    },
  });
  await sleep(4000);
  c2.line(`events received before any message: ${c2.events.length}`);
  const init = ctl({ subtype: 'initialize' });
  c2.send(init);
  await c2.until((e) => e.type === 'control_response' && e.response?.request_id === init.request_id, 15000, 'initialize response');
  const resp = c2.events.find((e) => e.type === 'control_response');
  if (resp) { const r = resp.response?.response ?? {}; console.log('initialize response keys:', Object.keys(r), 'pending_permission_requests=', JSON.stringify(r.pending_permission_requests)); }
  c2.send(user(perm
    ? 'Without running any tool: what was the last command you tried to run in this conversation, and did it complete? One sentence.'
    : 'Without running any tool: quote in one sentence the last request the user made before this message, and say whether you answered it.'));
  await c2.until(isResult, 90000, 'result of resumed turn');
  console.log('am-pending.txt exists after resume:', fs.existsSync(path.join(cwd, 'am-pending.txt')));
  await c2.finish();
  dumpTranscript(sid);
} else {
  throw new Error('usage: see header of ctl-test.mjs');
}
