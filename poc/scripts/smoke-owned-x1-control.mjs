// ONE run, ONE Haiku session driven by StreamJsonSession: interrupt during a long answer, set_permission_mode acceptEdits then default with a touch call,
// can_use_tool allow and deny. 4 turns, sequential, no loop, no concurrency. Usage (after the core build): node poc/scripts/smoke-owned-x1-control.mjs [folder]
// The folder defaults to %TEMP%/am-phase1/smoke-control (recreated files only: am-*.txt). Only the child this script starts is ever killed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const corePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../packages/agent-manager-core/dist/launch/index.js');
const { StreamJsonSession } = await import(`file://${corePath.replace(/\\/g, '/')}`);

const cwd = process.argv[2] ?? path.join(os.tmpdir(), 'am-phase1', 'smoke-control');
fs.mkdirSync(cwd, { recursive: true });
for (const name of ['am-mode1.txt', 'am-allow.txt', 'am-deny.txt']) fs.rmSync(path.join(cwd, name), { force: true });
const exists = (name) => fs.existsSync(path.join(cwd, name));
const t0 = Date.now();
const say = (text) => console.log(`[+${String(Date.now() - t0).padStart(6)}ms] ${text}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const session = await StreamJsonSession.start({ cwd, model: 'haiku', permissionMode: 'default' });
say(`started pid ${session.pid} session ${session.sessionId}`);

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  say(`CHECK ${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ` (${detail})`}`);
};

let deltas = 0;
const permissionRequests = [];
session.subscribe((event) => {
  switch (event.kind) {
    case 'text_delta': deltas++; break;
    case 'lifecycle': say(`lifecycle ${event.state}`); break;
    case 'state': say(`state ${event.previous} -> ${event.state}`); break;
    case 'assistant': if (event.text !== '') say(`assistant ${JSON.stringify(event.text.slice(0, 80))}${event.toolUses.map((use) => ` tool_use ${use.name} ${JSON.stringify(use.input).slice(0, 80)}`).join('')}`); break;
    case 'result': say(`result ${event.subtype} isError=${event.isError}`); break;
    case 'permission_request': {
      const command = String(event.request.input?.command ?? '');
      permissionRequests.push(command);
      // Decision by the file the command touches; anything else is denied.
      const allow = command.includes('am-allow');
      say(`permission_request ${event.request.toolName} ${JSON.stringify(command)} -> ${allow ? 'allow' : 'deny'}`);
      const answer = allow ? session.allow(event.request.requestId) : session.deny(event.request.requestId, 'Denied by the smoke script.');
      answer.catch((error) => say(`ANSWER FAILED ${error.message}`));
      break;
    }
    case 'permission_resolved': say(`permission_resolved ${event.behavior}`); break;
    case 'protocol_error': say(`PROTOCOL ERROR ${event.code}: ${event.detail}`); break;
    case 'exit': say(`exit ${event.info.cause} code=${event.info.code}`); break;
    default: break;
  }
});

const guard = setTimeout(async () => {
  console.error('SMOKE FAILED: guard of 300 s reached; killing the child this script started');
  await session.kill();
  process.exit(2);
}, 300_000);

try {
  // 1. interrupt during a long answer
  say('--- 1. interrupt');
  const slow = await session.send('Count from 1 to 3000, one number per line. No tools, no commentary.');
  await new Promise((resolve) => { const stop = session.subscribe((event) => { if (event.kind === 'text_delta') { stop(); resolve(); } }); });
  await sleep(1500);
  const receipt = await session.interrupt();
  say(`interrupt receipt ${JSON.stringify(receipt)}`);
  const outcome = await slow.completed;
  check('interrupt: receipt has stillQueued []', Array.isArray(receipt.stillQueued) && receipt.stillQueued.length === 0);
  check('interrupt: the message ends cancelled', outcome === 'cancelled', outcome);
  check('interrupt: deltas were streamed before', deltas > 0, `${deltas} deltas`);

  // 2. acceptEdits: a touch needs no permission request
  say('--- 2. set_permission_mode acceptEdits');
  const mode1 = await session.setPermissionMode('acceptEdits');
  check('set_permission_mode acceptEdits answered', mode1 === 'acceptEdits', mode1);
  const before = permissionRequests.length;
  await (await session.send('Run exactly this Bash command and nothing else: touch am-mode1.txt . Then reply DONE1.')).completed;
  check('acceptEdits: no can_use_tool request', permissionRequests.length === before, JSON.stringify(permissionRequests.slice(before)));
  check('acceptEdits: am-mode1.txt exists', exists('am-mode1.txt'));

  // 3. back to default: allow
  say('--- 3. default + can_use_tool allow');
  const mode2 = await session.setPermissionMode('default');
  check('set_permission_mode default answered', mode2 === 'default', mode2);
  await (await session.send('Run exactly this Bash command and nothing else: touch am-allow.txt . Then reply DONE2.')).completed;
  check('default: can_use_tool was asked for am-allow', permissionRequests.some((command) => command.includes('am-allow')), JSON.stringify(permissionRequests));
  check('allow: am-allow.txt exists', exists('am-allow.txt'));

  // 4. deny
  say('--- 4. can_use_tool deny');
  await (await session.send('Run exactly this Bash command and nothing else: touch am-deny.txt . If it is refused, do not retry, just reply DONE3.')).completed;
  check('deny: can_use_tool was asked for am-deny', permissionRequests.some((command) => command.includes('am-deny')), JSON.stringify(permissionRequests));
  check('deny: am-deny.txt does not exist', !exists('am-deny.txt'));
} finally {
  const info = await session.close();
  clearTimeout(guard);
  say(`closed: cause=${info.cause} code=${info.code} stderrTail=${JSON.stringify(info.stderrTail.slice(-200))}`);
  check('close: clean exit', info.cause === 'closed' && info.code === 0, `${info.cause} ${info.code}`);
}
const failed = checks.filter((entry) => !entry.ok);
console.log(failed.length === 0 ? `SMOKE CONTROL OK (${checks.length} checks)` : `SMOKE CONTROL FAILED: ${failed.map((entry) => entry.name).join('; ')}`);
process.exit(failed.length === 0 ? 0 : 1);
