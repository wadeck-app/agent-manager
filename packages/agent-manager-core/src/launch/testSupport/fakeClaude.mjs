// Test-only fake of `claude -p --input-format stream-json --output-format stream-json ...` (never the real one). It speaks the frames measured in
// research/session-launch-options.md (rounds 1-3): nothing on stdout before the first message, then command_lifecycle queued/started, system/init,
// the user replay, stream_event deltas, assistant, result, command_lifecycle completed; control_request interrupt / set_permission_mode; can_use_tool
// and its control_response. It touches no file outside FAKE_CLAUDE_LOG and sends nothing anywhere.
//
// Trigger words in the text of a user message:
//   PERMIT    asks can_use_tool (Bash) and answers ALLOWED or DENIED:<message> after the control_response
//   SLOW      starts a long turn (a delta, then waits up to 30 s) that only an interrupt ends (result error_during_execution, lifecycle cancelled)
//   CRASH     writes "fake claude crashed: boom" to stderr and exits with code 3
//   EXITCLEAN exits with code 0 at once (nobody closed stdin)
//   SPLIT     writes its assistant line in two chunks 50 ms apart (a line split across reads)
//   GARBAGE   writes a non-JSON line and a JSON array line before the turn
//   UNKNOWNEVENT writes a line of an unknown type and a system/thinking_tokens line, then answers normally
//   CTLREQ    writes a control_request of a subtype the host does not handle, then answers normally
//   BIGLINE   writes one 300000-character line of garbage before the turn
// Environment: FAKE_CLAUDE_LOG (ndjson file: argv and every received line), FAKE_CLAUDE_HANG_ON_CLOSE=1 (ignores the end of stdin and never exits),
// FAKE_CLAUDE_IGNORE_CONTROL=1 (never answers a control_request). The mode word "refuse" is answered with a control_response of subtype error.
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const argv = process.argv.slice(2);
const log = (entry) => {
  if (process.env.FAKE_CLAUDE_LOG) {
    appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify(entry)}\n`);
  }
};
const argOf = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};
log({ argv, cwd: process.cwd() });

const sessionId = argOf('--session-id') ?? argOf('--resume') ?? randomUUID();
let mode = argOf('--permission-mode') ?? 'default';
const out = (value) => process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const queue = [];
let running = false;
let interrupted = false;
let stdinEnded = false;
let permissionWaiter;
let slowWaiter;

const textOf = (content) => (typeof content === 'string' ? content : content.filter((block) => block.type === 'text').map((block) => block.text).join(''));
const imagesOf = (content) => (typeof content === 'string' ? [] : content.filter((block) => block.type === 'image').map((block) => block.source.media_type));

function lifecycle(uuid, state) {
  out({ type: 'command_lifecycle', command_uuid: uuid, state });
}

function assistant(text) {
  return { type: 'assistant', message: { role: 'assistant', model: 'fake-claude', content: [{ type: 'text', text }], stop_reason: 'end_turn' }, session_id: sessionId };
}

function delta(text) {
  out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, session_id: sessionId });
}

function result(subtype, isError, text, stopReason) {
  out({ type: 'result', subtype, is_error: isError, stop_reason: stopReason, result: text, session_id: sessionId, total_cost_usd: 0 });
}

async function runTurn(message) {
  const { uuid } = message;
  const content = message.message.content;
  const text = textOf(content);
  lifecycle(uuid, 'started');
  out({ type: 'system', subtype: 'init', cwd: process.cwd(), session_id: sessionId, model: 'fake-claude', tools: ['Bash', 'Read'], permissionMode: mode });
  out({ type: 'user', message: message.message, session_id: sessionId, parent_tool_use_id: null, uuid, isReplay: true });
  if (text.includes('CRASH')) {
    process.stderr.write('fake claude crashed: boom\n');
    process.exit(3);
  }
  if (text.includes('EXITCLEAN')) {
    process.exit(0);
  }
  if (text.includes('GARBAGE')) {
    out('this is not json');
    out('[1,2,3]');
  }
  if (text.includes('BIGLINE')) {
    out('x'.repeat(300000));
  }
  if (text.includes('UNKNOWNEVENT')) {
    out({ type: 'brand_new_event', payload: 1 });
    out({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 5, user_message_uuid: uuid });
  }
  if (text.includes('CTLREQ')) {
    out({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'hook_callback', callback_id: 'x' } });
  }
  if (text.includes('SLOW')) {
    delta('partial ');
    const ended = await new Promise((resolve) => {
      slowWaiter = resolve;
      setTimeout(() => resolve('timeout'), 30000);
    });
    slowWaiter = undefined;
    if (ended === 'interrupt') {
      out(assistant('partial '));
      out({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] }, session_id: sessionId });
      result('error_during_execution', true, undefined, null);
      lifecycle(uuid, 'cancelled');
      return;
    }
  } else if (text.includes('PERMIT')) {
    const requestId = randomUUID();
    out({
      type: 'control_request',
      request_id: requestId,
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Bash',
        display_name: 'Bash',
        input: { command: 'touch fake.txt', description: 'Create fake.txt' },
        description: 'Create fake.txt',
        permission_suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
        blocked_path: 'fake.txt',
        tool_use_id: 'toolu_fake1',
      },
    });
    const answer = await new Promise((resolve) => {
      permissionWaiter = { requestId, resolve };
    });
    permissionWaiter = undefined;
    const verdict = answer.behavior === 'allow' ? `ALLOWED ${JSON.stringify(answer.updatedInput)}` : `DENIED:${answer.message}`;
    out(assistant(verdict));
  } else {
    const images = imagesOf(content);
    const reply = `ECHO: ${text}${images.length > 0 ? ` [images: ${images.join(',')}]` : ''} [mode: ${mode}]`;
    delta(reply.slice(0, 5));
    delta(reply.slice(5));
    if (text.includes('SPLIT')) {
      const line = JSON.stringify(assistant(reply));
      process.stdout.write(line.slice(0, 20));
      await sleep(50);
      process.stdout.write(`${line.slice(20)}\n`);
    } else {
      out(assistant(reply));
    }
  }
  result('success', false, 'done', 'end_turn');
  lifecycle(uuid, 'completed');
}

async function drain() {
  if (running) {
    return;
  }
  running = true;
  while (queue.length > 0) {
    interrupted = false;
    await runTurn(queue.shift());
  }
  running = false;
  if (stdinEnded && process.env.FAKE_CLAUDE_HANG_ON_CLOSE !== '1') {
    process.exit(0);
  }
}

function onControlRequest(frame) {
  if (process.env.FAKE_CLAUDE_IGNORE_CONTROL === '1') {
    return;
  }
  const respond = (response) => out({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id, response } });
  switch (frame.request?.subtype) {
    case 'interrupt':
      respond({ still_queued: queue.map((entry) => entry.uuid) });
      if (slowWaiter) {
        interrupted = true;
        slowWaiter('interrupt');
      }
      break;
    case 'set_permission_mode':
      if (frame.request.mode === 'refuse') {
        out({ type: 'control_response', response: { subtype: 'error', request_id: frame.request_id, error: 'mode refused by the fake' } });
        break;
      }
      mode = frame.request.mode;
      respond({ mode });
      break;
    default:
      out({ type: 'control_response', response: { subtype: 'error', request_id: frame.request_id, error: `unknown subtype ${frame.request?.subtype}` } });
  }
}

function onLine(line) {
  log({ received: line });
  const frame = JSON.parse(line);
  if (frame.type === 'user') {
    lifecycle(frame.uuid, 'queued');
    queue.push(frame);
    void drain();
  } else if (frame.type === 'control_request') {
    onControlRequest(frame);
  } else if (frame.type === 'control_response') {
    // The echo of the answer, as the real claude does (measured), then the turn goes on.
    out(frame);
    if (permissionWaiter && frame.response.request_id === permissionWaiter.requestId) {
      permissionWaiter.resolve(frame.response.response);
    }
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim() !== '') {
      onLine(line);
    }
  }
});
process.stdin.on('end', () => {
  stdinEnded = true;
  log({ stdinEnded: true });
  if (process.env.FAKE_CLAUDE_HANG_ON_CLOSE === '1') {
    // Keep the process (and the event loop) alive forever.
    setInterval(() => undefined, 1000);
    return;
  }
  if (!running) {
    process.exit(0);
  }
});
