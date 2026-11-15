import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ID, modelAttachmentLine, modelCommandLines, modelLine, putSession, transcriptFile, useSandbox, userLine, writeLines } from './apiFixtures.js';
import { makeModule } from './testKit.js';

const box = useSandbox();
const module_ = () => makeModule({ dataDir: box.data });
const rows = async () => (await module_().call('GET', '/sessions')).body.sessions as Record<string, any>[];
const log = (query = '', id = ID(process.pid)) => module_().call('GET', `/sessions/${id}/log${query}`);
const kinds = (entries: { kind: string }[]): string[] => entries.map((entry) => entry.kind);

// Real shapes: the attachment names the model, message.model has no region and no [1m] tag, /model prints "Set model to `X` ...".
describe('GET /sessions: the status line data', () => {
  it('model, context, tokens, duration of a session whose transcript has a model attachment', async () => {
    const id = putSession(box, process.pid, { startedAt: Date.now() - 2 * 3_600_000 - 22 * 60_000 });
    writeLines(transcriptFile(box, id), [
      modelAttachmentLine(0, 'us.anthropic.claude-opus-5-5[1m]', 'Opus 5.5 (1M context)'),
      userLine(1, 'go'),
      modelLine(2, 'claude-opus-5-5', { input: 8, cacheRead: 367_000, cacheCreate: 792, output: 816 }),
    ]);
    const [row] = await rows();
    expect(row!['model']).toEqual({ id: 'us.anthropic.claude-opus-5-5[1m]', displayName: 'Opus 5.5 (1M context)', known: true });
    expect(row!['tokensIn']).toBe(367_800);
    expect(row!['tokensOut']).toBe(816);
    expect(row!['contextUsedPct']).toMatchObject({ value: 37, basis: 'estimate', windowTokens: 1_000_000 });
    expect(row!['contextUsedPct'].note).toContain('1M');
    expect(row!['durationMs']).toBeGreaterThanOrEqual(2 * 3_600_000 + 22 * 60_000);
    expect(row!['statusNote']).toBeUndefined();
  });

  it('a model that is not in the table is shown raw and flagged; the window falls back to 200k and says so', async () => {
    const id = putSession(box, process.pid);
    writeLines(transcriptFile(box, id), [userLine(1, 'go'), modelLine(2, 'claude-mystery-9', { cacheRead: 50_000 })]);
    const [row] = await rows();
    expect(row!['model']).toEqual({ id: 'claude-mystery-9', displayName: 'claude-mystery-9', known: false });
    expect(row!['contextUsedPct']).toMatchObject({ value: 25, basis: 'estimate', windowTokens: 200_000 });
  });

  it('the previous models of the part that was read, the latest one is the model', async () => {
    const id = putSession(box, process.pid);
    writeLines(transcriptFile(box, id), [modelLine(1, 'claude-sonnet-4-6'), ...modelCommandLines(2, 'Set model to `Haiku 5.5` for this session only'), modelLine(3, 'claude-haiku-5-5')]);
    const [row] = await rows();
    expect(row!['model']).toMatchObject({ displayName: 'Haiku 5.5', known: true });
    expect(row!['previousModels']).toEqual([{ id: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', known: true }]);
  });

  it('no transcript: no model, and the reason is stated (never a silent empty)', async () => {
    putSession(box, process.pid);
    const [row] = await rows();
    expect(row!['model']).toBeUndefined();
    expect(row!['statusNote']).toBe('No transcript yet');
  });

  it('a transcript with no assistant message yet says so', async () => {
    const id = putSession(box, process.pid);
    writeLines(transcriptFile(box, id), [userLine(1, 'go')]);
    expect((await rows())[0]!['statusNote']).toContain('No assistant message');
  });

  it('the cache follows the file: a new message changes the figures, an unchanged file keeps them', async () => {
    const id = putSession(box, process.pid);
    const file = transcriptFile(box, id);
    writeLines(file, [modelLine(1, 'claude-sonnet-4-6', { cacheRead: 20_000 })]);
    expect((await rows())[0]!['tokensIn']).toBe(20_110);
    expect((await rows())[0]!['tokensIn']).toBe(20_110);
    writeLines(file, [modelLine(2, 'claude-sonnet-4-6', { cacheRead: 60_000 })], true);
    expect((await rows())[0]!['tokensIn']).toBe(60_110);
  });

  it('a model attachment far before the tail is found once (bounded scan) and gives the exact 1M name', async () => {
    const id = putSession(box, process.pid);
    const file = transcriptFile(box, id);
    // ~600 KB of assistant lines after the attachment: it is outside the 64 KB tail of the digest.
    const filler = Array.from({ length: 60 }, (_v, i) => modelLine(i + 2, 'claude-opus-5-5', {}, 'x'.repeat(10_000)));
    writeLines(file, [modelAttachmentLine(0, 'us.anthropic.claude-opus-5-5[1m]', 'Opus 5.5 (1M context)'), ...filler]);
    const [row] = await rows();
    expect(row!['model']).toMatchObject({ displayName: 'Opus 5.5 (1M context)', known: true });
    expect(row!['contextUsedPct'].windowTokens).toBe(1_000_000);
  });
});

describe('GET /sessions/:id/log: the model-change notice and the status', () => {
  it('a /model command is one notice at the command (not twice), before the first message of the new model; the status is the current model', async () => {
    const id = putSession(box, process.pid);
    writeLines(transcriptFile(box, id), [
      modelAttachmentLine(0, 'claude-sonnet-4-6', 'Sonnet 4.6'),
      userLine(1, 'hello'),
      modelLine(2, 'claude-sonnet-4-6', {}, 'first answer'),
      ...modelCommandLines(3, 'Set model to `Haiku 5.5` and saved as your default for new sessions'),
      userLine(4, 'again'),
      modelLine(5, 'claude-haiku-5-5', {}, 'second answer'),
      modelAttachmentLine(6, 'us.anthropic.claude-haiku-5-5', 'Haiku 5.5'),
    ]);
    const { body } = await log();
    expect(kinds(body.entries)).toEqual(['user-prompt', 'assistant-text', 'user-prompt', 'user-prompt', 'model-change', 'user-prompt', 'assistant-text']);
    const notice = body.entries.find((entry: { kind: string }) => entry.kind === 'model-change');
    expect(notice).toMatchObject({ source: 'command', scope: 'default', text: 'Model changed: Sonnet 4.6 -> Haiku 5.5', from: { displayName: 'Sonnet 4.6' }, to: { displayName: 'Haiku 5.5', known: true } });
    // Neither the usage nor the attachment entries are sent.
    expect(kinds(body.entries)).not.toContain('usage');
    expect(kinds(body.entries)).not.toContain('model-info');
    expect(body.status).toMatchObject({ model: { id: 'us.anthropic.claude-haiku-5-5', displayName: 'Haiku 5.5', known: true }, tokensIn: 1110 });
  });

  it('a model that changes with no command is noticed before the first message of the new model', async () => {
    const id = putSession(box, process.pid);
    writeLines(transcriptFile(box, id), [userLine(1, 'a'), modelLine(2, 'claude-sonnet-5-5', {}, 'one'), userLine(3, 'b'), modelLine(4, 'claude-opus-5', {}, 'two')]);
    const { body } = await log();
    expect(kinds(body.entries)).toEqual(['user-prompt', 'assistant-text', 'user-prompt', 'model-change', 'assistant-text']);
    expect(body.entries[3]).toMatchObject({ source: 'assistant', text: 'Model changed: Sonnet 5.5 -> Opus 5' });
  });

  it('polling: a change that arrives after the cursor is noticed against the model the cursor carries, once', async () => {
    const id = putSession(box, process.pid);
    const file = transcriptFile(box, id);
    writeLines(file, [userLine(1, 'a'), modelLine(2, 'claude-sonnet-5-5', {}, 'one')]);
    const first = (await log()).body;
    expect(kinds(first.entries)).toEqual(['user-prompt', 'assistant-text']);
    writeLines(file, [userLine(3, 'b'), modelLine(4, 'claude-haiku-4-5-20251001', {}, 'two')], true);
    const second = (await log(`?after=${first.cursor}`)).body;
    expect(kinds(second.entries)).toEqual(['user-prompt', 'model-change', 'assistant-text']);
    expect(second.entries[1]).toMatchObject({ from: { displayName: 'Sonnet 5.5' }, to: { displayName: 'Haiku 4.5' } });
    // Nothing new: nothing repeated.
    const third = (await log(`?after=${second.cursor}`)).body;
    expect(third.entries).toEqual([]);
    writeLines(file, [modelLine(5, 'claude-haiku-4-5-20251001', {}, 'more')], true);
    expect(kinds((await log(`?after=${third.cursor}`)).body.entries)).toEqual(['assistant-text']);
  });

  it('polling: the exact name of a model announced by an attachment before its first message survives the cursor (the 1M tag), like a fresh tail load', async () => {
    const id = putSession(box, process.pid);
    const file = transcriptFile(box, id);
    writeLines(file, [modelAttachmentLine(0, 'claude-sonnet-5-5', 'Sonnet 5.5'), userLine(1, 'a'), modelLine(2, 'claude-sonnet-5-5', {}, 'one')]);
    const first = (await log()).body;
    // The user switches model: the attachment is written, then a poll happens BEFORE the first message of the new model.
    writeLines(file, [modelAttachmentLine(3, 'us.anthropic.claude-opus-5-5[1m]', 'Opus 5.5 (1M context)')], true);
    const between = (await log(`?after=${first.cursor}`)).body;
    expect(between.entries).toEqual([]);
    writeLines(file, [userLine(4, 'b'), modelLine(5, 'claude-opus-5-5', {}, 'two')], true);
    const polled = (await log(`?after=${between.cursor}`)).body;
    const notice = polled.entries.find((entry: { kind: string }) => entry.kind === 'model-change');
    expect(notice?.to).toMatchObject({ id: 'us.anthropic.claude-opus-5-5[1m]', displayName: 'Opus 5.5 (1M context)' });
    // The same transcript read fresh gives the same notice.
    const fresh = (await log()).body.entries.find((entry: { kind: string }) => entry.kind === 'model-change');
    expect(fresh?.to).toEqual(notice?.to);
  });

  it('polling: an attachment written before any message (no current model yet) is carried too', async () => {
    const id = putSession(box, process.pid);
    const file = transcriptFile(box, id);
    writeLines(file, [modelAttachmentLine(0, 'us.anthropic.claude-opus-5-5[1m]', 'Opus 5.5 (1M context)')]);
    const first = (await log()).body;
    expect(first.cursor).toBeTruthy();
    writeLines(file, [userLine(1, 'a'), modelLine(2, 'claude-opus-5-5', {}, 'one')], true);
    const polled = (await log(`?after=${first.cursor}`)).body;
    expect(kinds(polled.entries)).toEqual(['user-prompt', 'assistant-text']);
    expect(polled.status.model).toMatchObject({ displayName: 'Opus 5.5 (1M context)' });
  });

  it('a cursor with a malformed list of carried names is refused', async () => {
    putSession(box, process.pid);
    for (const a of [[['x']], 'nope', Array.from({ length: 9 }, () => ['a', 'b'])]) {
      const bad = Buffer.from(JSON.stringify({ o: 1, m: { a } })).toString('base64url');
      expect((await log(`?after=${bad}`)).body.error.code).toBe('cursor-invalid');
    }
  });

  it('a cursor with a malformed model part is refused as a cursor error', async () => {
    putSession(box, process.pid);
    const bad = Buffer.from(JSON.stringify({ o: 1, m: { n: 3 } })).toString('base64url');
    const answer = await log(`?after=${bad}`);
    expect(answer.status).toBe(400);
    expect(answer.body.error.code).toBe('cursor-invalid');
  });

  it('a session with no transcript still answers a status (no model, the note says why)', async () => {
    putSession(box, process.pid);
    const { body } = await log();
    expect(body.entries).toEqual([]);
    expect(body.status.statusNote).toBe('No transcript yet');
  });

  it('a transcript that is overwritten by a shorter one does not keep a stale model (the digest cache follows mtime and size)', async () => {
    const id = putSession(box, process.pid);
    const file = transcriptFile(box, id);
    writeLines(file, [modelLine(1, 'claude-sonnet-5-5', { cacheRead: 5_000 })]);
    expect((await log()).body.status.model.displayName).toBe('Sonnet 5.5');
    writeFileSync(file, '');
    writeLines(file, [modelLine(2, 'claude-opus-5', {})]);
    expect((await log()).body.status.model.displayName).toBe('Opus 5');
  });
});
