// Live-update repro: appends to a fake transcript, in stages while a page is open, the lines a real agent-manager "web reply" produces (shapes and sizes copied
// from a real transcript, contents are filler): queue-operation enqueue/dequeue, the delivered message as a `peer` user entry, a run of big lines the viewer does
// not show (attachment, api-request-shape, api-request-blob), then the assistant answer and the closing system lines.
// Usage: node append-live-peer.mjs <transcript.jsonl> <sessionId> <cwd> [delayAfterDeliveryMs=3000] [delayAfterBigLinesMs=4000]
// Nothing but the given file is written.
import fs from 'node:fs';

const [file, sessionId, cwd, d1 = '3000', d2 = '4000', statusUrl] = process.argv.slice(2);
if (!file || !sessionId || !cwd) {
  throw new Error('Usage: node append-live-peer.mjs <transcript.jsonl> <sessionId> <cwd> [delay1Ms] [delay2Ms]');
}
// The id, text and priority of the message the composer really sent: the newest of the reply status of the page (statusUrl), else fixed test values.
let messageId = 'm-test';
let userText = 'salut';
if (statusUrl) {
  const answer = await (await fetch(statusUrl)).json();
  const latest = answer.messages?.[0];
  if (latest) {
    messageId = latest.messageId;
    userText = latest.text;
  }
}
const marker = '[web reply via agent-manager #' + messageId + ']';
let n = 0;
const uid = () => `22222222-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const stamp = () => new Date().toISOString();
const common = () => ({ uuid: uid(), timestamp: stamp(), userType: 'external', entrypoint: 'cli', cwd, sessionId, version: '2.1.325', gitBranch: 'main' });
const append = (lines) => fs.appendFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const filler = (bytes) => 'x'.repeat(bytes);

// 1. The message is delivered: enqueue, dequeue, then the peer entry (small: the real one was 1.3 KB).
append([
  { type: 'queue-operation', operation: 'enqueue', timestamp: stamp(), sessionId, content: 'Another Claude session sent a message: ' + marker + ' ' + userText },
  { type: 'queue-operation', operation: 'dequeue', timestamp: stamp(), sessionId },
  { type: 'atis-latch', atis: null, sessionId },
  { type: 'tools-used', tools: ['Read', 'Edit'], sessionId },
  {
    parentUuid: uid(), isSidechain: false, promptId: uid(), type: 'user', isMeta: true,
    message: { role: 'user', content: 'Another Claude session sent a message:\n' + marker + '\n' + userText + '\n\nThis came from another Claude session. Reply to it with the tool provided for that.' },
    ...common(), permissionMode: 'default', origin: { kind: 'peer', from: 'unknown' }, promptSource: 'system', queueSkipSlashCommands: true, turnOrigin: 'peer', turnPosition: { promptIndex: 1, turnIndex: 0 },
  },
]);
console.log('delivered');
await sleep(Number(d1));
// 2. A run of big lines the viewer does not show (sizes of the real ones: 27 KB, 3 KB, 37 KB, 16 KB).
append([
  { parentUuid: uid(), isSidechain: false, attachment: { type: 'x', content: filler(13_000) }, type: 'attachment', rendered: filler(13_000), renderedRole: 'user', session_id: sessionId, ...common() },
  { parentUuid: uid(), isSidechain: false, attachment: { type: 'x', content: filler(1300) }, type: 'attachment', rendered: filler(1600), renderedRole: 'user', session_id: sessionId, ...common() },
  { type: 'api-request-shape', sessionId, shapeHash: filler(64), timestamp: stamp(), version: '2.1.325', shape: filler(36_800) },
  { type: 'api-request-blob', sessionId, hash: filler(64), message: filler(16_300) },
  { type: 'last-prompt', leafUuid: uid(), sessionId },
]);
console.log('big lines');
await sleep(Number(d2));
// 3. The answer, then the closing lines.
append([
  {
    parentUuid: uid(), isSidechain: false, type: 'assistant', requestId: 'req_live', apiBlockIndex: 1,
    message: { id: 'msg_live_peer', type: 'message', role: 'assistant', model: 'claude-fake-1', content: [{ type: 'text', text: 'Salut ! I got your message through agent-manager (#' + messageId + '). It only says "' + userText + '".' }], stop_reason: 'end_turn', usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 5000, output_tokens: 60 } },
    ...common(),
  },
  { parentUuid: uid(), isSidechain: false, attachment: { type: 'x', content: filler(53_700) }, type: 'attachment', session_id: sessionId, ...common() },
  { parentUuid: uid(), isSidechain: false, type: 'system', subtype: 'turn_duration', durationMs: 4000, messageCount: 2, isMeta: false, ...common() },
]);
console.log('answer');
