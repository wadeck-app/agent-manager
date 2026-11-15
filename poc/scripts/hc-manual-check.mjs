// Manual check of the hc transport against ONE terminal started by hand with `hc run` (argument: its cwd). Probes, then (with --send) sends one message.
// Throwaway: it runs the REAL hc, so it is never part of the test suite.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readSessionRegistry } from '../../packages/agent-manager-core/dist/index.js';
import { createHcTransport, composeMessageText, wireMsgId } from '../../packages/agent-manager-core/dist/reply/index.js';

const [cwd, ...flags] = process.argv.slice(2);
if (cwd === undefined) {
  throw new Error('usage: node hc-manual-check.mjs <cwd of the session> [--send]');
}
const registry = await readSessionRegistry(join(homedir(), '.claude', 'sessions'));
if (!registry.ok) {
  throw new Error(registry.error.message);
}
const found = registry.sessions.filter((session) => session.alive && session.cwd.toLowerCase() === cwd.toLowerCase());
if (found.length !== 1) {
  throw new Error(`expected exactly one live session in ${cwd}, found ${found.length}`);
}
const session = found[0];
console.log('session', session.sessionId, 'pid', session.pid, 'status', session.status);
// HC_TERMINAL_ID is set in this shell on purpose: the transport must remove it.
console.log('HC_TERMINAL_ID in this process:', process.env.HC_TERMINAL_ID);
const transport = createHcTransport();
const probe = await transport.probe(session);
console.log('probe', JSON.stringify(probe, null, 1));
if (flags.includes('--send')) {
  const id = `m-manual-${Date.now()}`;
  const text = composeMessageText({ text: 'Reply with exactly the word PONG-HC and nothing else.\nSecond line of the same prompt.', imagePaths: [], id });
  const result = await transport.send(session, { id, text, imagePaths: [], priority: 'next', origin: 'web' });
  console.log('send', JSON.stringify(result), 'id', id, 'wire', wireMsgId(id));
}
