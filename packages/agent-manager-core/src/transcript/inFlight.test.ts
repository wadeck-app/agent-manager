import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { scanInFlight } from './inFlight.js';
import { readTail } from './windows.js';
import { assistantLine, humanPrompt, injectedPrompt, jsonl, makeTempDir, queueLine, removeDir, taskNotificationPrompt, textBlock, toolResultLine, toolUseBlock, writeText } from './testFixtures.js';
import type { Obj } from './testFixtures.js';

/*
 * The in-flight facts of a transcript tail (#71 phase 1): what would be lost if the host of the session were stopped now. Fixtures use the shapes measured on
 * real transcripts (research/adopt-host-switch.md, "Phase 1 measurements"): a `dequeue` has no content and no id, a task notification is a queue-operation
 * enqueue whose content holds <tool-use-id> and <status>.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    removeDir(dir);
  }
});

/** Writes the lines to a file and reads the whole of it back as a tail window, like the readers do. */
async function scan(lines: Obj[], options: { startsAtFileStart?: boolean } = {}) {
  const dir = makeTempDir('am-inflight-');
  dirs.push(dir);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'session.jsonl');
  writeText(file, jsonl(lines));
  const tail = await readTail(file, { bytes: 1024 * 1024 });
  expect(tail.error).toBeUndefined();
  return scanInFlight(tail.entries, { startsAtFileStart: options.startsAtFileStart ?? !tail.hasMoreBefore });
}

const notification = (id: string, status: string | undefined): string =>
  `<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<output-file>C:\\tmp\\b1.output</output-file>\n${status === undefined ? '' : `<status>${status}</status>\n`}<summary>x</summary>\n</task-notification>`;

describe('foreground tool calls', () => {
  it('a tool_use without result is an open call, with its name and summary', async () => {
    const facts = await scan([humanPrompt(1, 'go'), assistantLine(2, 'm1', 0, toolUseBlock('t1', 'Bash', { command: 'node wait.mjs' }))]);
    expect(facts.openCalls).toEqual([expect.objectContaining({ id: 't1', name: 'Bash', summary: 'node wait.mjs', background: false })]);
    expect(facts.backgroundOpen).toEqual([]);
  });

  it('a tool_use with its result is not open', async () => {
    const facts = await scan([humanPrompt(1, 'go'), assistantLine(2, 'm1', 0, toolUseBlock('t1', 'Bash', { command: 'ls' })), toolResultLine(3, [{ id: 't1', content: 'ok' }]), assistantLine(4, 'm2', 0, textBlock('done'))]);
    expect(facts.openCalls).toEqual([]);
    expect(facts.backgroundOpen).toEqual([]);
  });

  it('an orphan result (its call is before the window) is not an open call', async () => {
    const facts = await scan([humanPrompt(1, 'go'), toolResultLine(3, [{ id: 'older', content: 'ok' }])]);
    expect(facts.openCalls).toEqual([]);
  });
});

describe('background calls', () => {
  const started = (id: string, name = 'Bash', input: Obj = { command: 'npm run watch', run_in_background: true }): Obj[] => [
    humanPrompt(1, 'go'),
    assistantLine(2, 'm1', 0, toolUseBlock(id, name, input)),
    toolResultLine(3, [{ id, content: 'Command running in background with ID: b1' }]),
    assistantLine(4, 'm2', 0, textBlock('started')),
  ];

  it('a run_in_background call whose result came back but with no task notification is open', async () => {
    const facts = await scan(started('t1'));
    expect(facts.openCalls).toEqual([]);
    expect(facts.backgroundOpen).toEqual([expect.objectContaining({ id: 't1', name: 'Bash', background: true })]);
  });

  it('is closed by a notification (queue-operation enqueue) of the same tool-use id with a final status', async () => {
    for (const status of ['completed', 'failed', 'killed', 'stopped']) {
      const facts = await scan([...started('t1'), queueLine(5, 'enqueue', { content: notification('t1', status) }), queueLine(6, 'dequeue')]);
      expect(facts.backgroundOpen, status).toEqual([]);
    }
  });

  it('is closed by a task-notification user line as well', async () => {
    const facts = await scan([...started('t1'), taskNotificationPrompt(5, notification('t1', 'completed'))]);
    expect(facts.backgroundOpen).toEqual([]);
  });

  it('a notification of ANOTHER tool-use id does not close it', async () => {
    const facts = await scan([...started('t1'), queueLine(5, 'enqueue', { content: notification('other', 'completed') }), queueLine(6, 'dequeue')]);
    expect(facts.backgroundOpen).toHaveLength(1);
  });

  it('a notification with no status (a monitor event, the task goes on) does not close it', async () => {
    const facts = await scan([...started('t1', 'Monitor', { command: 'tail -f log' }), queueLine(5, 'enqueue', { content: notification('t1', undefined) }), queueLine(6, 'dequeue')]);
    expect(facts.backgroundOpen).toEqual([expect.objectContaining({ id: 't1', name: 'Monitor' })]);
  });

  it('a Monitor call is background without run_in_background', async () => {
    const facts = await scan(started('t2', 'Monitor', { command: 'tail -f log', description: 'Watch the log' }));
    expect(facts.backgroundOpen).toEqual([expect.objectContaining({ id: 't2', name: 'Monitor', background: true })]);
  });

  it('a run_in_background call still running (no result yet) is one open call, counted once', async () => {
    const facts = await scan([humanPrompt(1, 'go'), assistantLine(2, 'm1', 0, toolUseBlock('t3', 'Bash', { command: 'x', run_in_background: true }))]);
    expect(facts.openCalls.length + facts.backgroundOpen.length).toBe(1);
  });
});

describe('queued messages (queue-operation)', () => {
  it('counts enqueue minus dequeue and remove', async () => {
    const lines = (ops: string[]): Obj[] => [humanPrompt(1, 'go'), ...ops.map((operation, index) => queueLine(2 + index, operation, operation === 'enqueue' ? { content: 'typed while busy' } : {}))];
    expect((await scan(lines(['enqueue']))).queuedMessages).toBe(1);
    expect((await scan(lines(['enqueue', 'dequeue']))).queuedMessages).toBe(0);
    expect((await scan(lines(['enqueue', 'remove']))).queuedMessages).toBe(0);
    expect((await scan(lines(['enqueue', 'enqueue', 'dequeue']))).queuedMessages).toBe(1);
  });

  it('a dequeue whose enqueue is before the window never makes the count negative', async () => {
    const facts = await scan([humanPrompt(1, 'go'), queueLine(2, 'dequeue'), queueLine(3, 'enqueue', { content: 'x' })]);
    expect(facts.queuedMessages).toBe(1);
  });

  it('an enqueue without content is counted too (133 of them in the real transcripts)', async () => {
    expect((await scan([humanPrompt(1, 'go'), queueLine(2, 'enqueue')])).queuedMessages).toBe(1);
  });
});

describe('reachedStart', () => {
  it('is the startsAtFileStart of the window, whatever prompt it holds', async () => {
    expect((await scan([humanPrompt(1, 'go')], { startsAtFileStart: true })).reachedStart).toBe(true);
    expect((await scan([humanPrompt(1, 'go')], { startsAtFileStart: false })).reachedStart).toBe(false);
  });
});

describe('does the window cover the last turn', () => {
  it('yes when it starts at the beginning of the file', async () => {
    expect((await scan([assistantLine(2, 'm1', 0, textBlock('hi'))], { startsAtFileStart: true })).coversLastTurn).toBe(true);
  });

  it('yes when it holds a prompt of the person, a peer or a task notification', async () => {
    expect((await scan([humanPrompt(1, 'go'), assistantLine(2, 'm1', 0, textBlock('hi'))], { startsAtFileStart: false })).coversLastTurn).toBe(true);
    expect((await scan([taskNotificationPrompt(1, notification('x', 'completed'))], { startsAtFileStart: false })).coversLastTurn).toBe(true);
  });

  it('no when it starts mid-file and holds only assistant lines, tool results and injected lines', async () => {
    const facts = await scan([assistantLine(2, 'm1', 0, textBlock('hi')), toolResultLine(3, [{ id: 'older', content: 'x' }]), injectedPrompt(4, 'reminder')], { startsAtFileStart: false });
    expect(facts.coversLastTurn).toBe(false);
  });
});
