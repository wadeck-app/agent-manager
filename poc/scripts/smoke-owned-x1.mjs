// Smoke test of StreamJsonSession against the REAL claude binary: ONE Haiku prompt, then close. No loop, no concurrency, no benchmark.
// Usage (after `npm run build` in packages/agent-manager-core):  node poc/scripts/smoke-owned-x1.mjs [scratch-folder]
// The scratch folder defaults to %TEMP%/am-phase1/smoke-proj (created). Only the child this script starts is ever killed (by session.kill()).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const corePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../packages/agent-manager-core/dist/launch/index.js');
const { StreamJsonSession } = await import(`file://${corePath.replace(/\\/g, '/')}`);

const cwd = process.argv[2] ?? path.join(os.tmpdir(), 'am-phase1', 'smoke-proj');
fs.mkdirSync(cwd, { recursive: true });
const t0 = Date.now();
const say = (text) => console.log(`[+${String(Date.now() - t0).padStart(6)}ms] ${text}`);

const session = await StreamJsonSession.start({ cwd, model: 'haiku', permissionMode: 'default' });
say(`started pid ${session.pid} session ${session.sessionId}`);
say(`argv: claude ${session.args.join(' ')}`);

let deltas = 0;
const seen = [];
session.subscribe((event) => {
  switch (event.kind) {
    case 'text_delta':
      deltas++;
      break;
    case 'lifecycle':
      seen.push(`lifecycle:${event.state}`);
      say(`lifecycle ${event.state} ${event.uuid}`);
      break;
    case 'state':
      seen.push(`state:${event.state}`);
      say(`state ${event.previous} -> ${event.state}`);
      break;
    case 'init':
      say(`init session=${event.sessionId} model=${event.model ?? '?'} tools=${event.tools.length}`);
      break;
    case 'assistant':
      seen.push('assistant');
      say(`assistant ${JSON.stringify(event.text)}`);
      break;
    case 'result':
      seen.push('result');
      say(`result ${event.subtype} isError=${event.isError} stop=${event.stopReason}`);
      break;
    case 'user_replay':
      say(`user_replay ${event.uuid}`);
      break;
    case 'system':
      break;
    case 'protocol_error':
      say(`PROTOCOL ERROR ${event.code}: ${event.detail}`);
      break;
    case 'exit':
      say(`exit ${JSON.stringify({ ...event.info, error: event.info.error?.message })}`);
      break;
    default:
      say(`event ${event.kind}`);
  }
});

// A guard against a hang, never a performance limit: this script ends its own child and fails loudly.
const guard = setTimeout(async () => {
  console.error('SMOKE FAILED: no result within 180 s; killing the child this script started');
  await session.kill();
  process.exit(2);
}, 180_000);

const sent = await session.send('Reply with exactly the word PONG. No tools, no commentary.');
say(`sent ${sent.uuid}`);
await sent.started;
say('delivery: started');
const outcome = await sent.completed;
say(`delivery: ${outcome}`);
const registryFile = path.join(os.homedir(), '.claude', 'sessions', `${session.pid}.json`);
say(`registry file ${registryFile}: ${fs.existsSync(registryFile) ? 'present' : 'ABSENT'}`);
const info = await session.close();
clearTimeout(guard);
say(`closed: cause=${info.cause} code=${info.code} signal=${info.signal} stderrTail=${JSON.stringify(info.stderrTail.slice(-200))}`);

const failures = [];
if (outcome !== 'completed') failures.push(`delivery outcome ${outcome}`);
if (!seen.includes('assistant')) failures.push('no assistant event');
if (info.cause !== 'closed' || info.code !== 0) failures.push(`exit not clean (${info.cause}, ${info.code})`);
if (deltas === 0) failures.push('no text delta');
console.log(`deltas: ${deltas}`);
if (failures.length > 0) {
  console.error(`SMOKE FAILED: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('SMOKE OK');
