import { mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ID, SLUG, putSession, textLine, toolResultLine, toolUseLine, transcriptFile, useSandbox, userLine, writeLines } from './apiFixtures.js';
import { LOG_LIMITS, RUNNING_FRESH_MS } from './logRoute.js';
import { makeModule } from './testKit.js';

const box = useSandbox();

const log = (query = '', id = ID(process.pid)) => makeModule({ dataDir: box.data }).call('GET', `/sessions/${id}/log${query}`);

/** n alternating prompts and answers, `chars` characters each, named #0 .. #n-1. */
function conversation(n: number, chars = 20): Record<string, unknown>[] {
  return Array.from({ length: n }, (_v, i) => (i % 2 === 0 ? userLine(i, `#${i} `.padEnd(chars, 'x')) : textLine(i, `#${i} `.padEnd(chars, 'y'))));
}
const texts = (entries: { kind: string; text?: string }[]): string[] => entries.filter((e) => e.text !== undefined).map((e) => (e.text as string).split(' ')[0]!);

describe('GET /sessions/:sessionId/log: errors', () => {
  it.each(['abc', '../../x', '%24sources', ID(1) + 'x'])('an unsafe session id %s is a 404 with a hint', async (id) => {
    const answer = await log('', encodeURIComponent(id));
    expect(answer.status).toBe(404);
    expect(answer.body).toMatchObject({ ok: false, error: { code: 'unknown-session', message: expect.any(String), hint: expect.stringContaining('GET /sessions') } });
  });

  it('a session that is not in the registry is a 404 with a hint', async () => {
    putSession(box, process.pid);
    const answer = await log('', ID(999_999));
    expect(answer.status).toBe(404);
    expect(answer.body.error.hint).toContain('refresh');
  });

  it('an unreadable registry is an inline error with the registry hint', async () => {
    process.env['AGENT_MANAGER_SESSIONS_DIR'] = join(box.registry, 'missing');
    const answer = await log();
    expect(answer).toMatchObject({ status: 200, body: { ok: false, error: { code: 'registry-unreadable' } } });
    expect(answer.body.error.hint).toContain('AGENT_MANAGER_SESSIONS_DIR');
  });

  it.each([['limit=0'], ['limit=501'], ['limit=abc'], ['limit=1.5']])('refuses %s with a 400 that says the range', async (query) => {
    putSession(box, process.pid);
    const answer = await log(`?${query}`);
    expect(answer.status).toBe(400);
    expect(answer.body).toMatchObject({ ok: false, error: { code: 'bad-request', hint: expect.stringContaining('limit') } });
  });

  it('refuses before and after together, and a cursor that is not one', async () => {
    putSession(box, process.pid);
    const both = await log('?before=a&after=b');
    expect(both).toMatchObject({ status: 400, body: { error: { code: 'bad-request' } } });
    for (const query of ['?after=garbage', '?before=e30', `?after=${Buffer.from('{"o":-1}').toString('base64url')}`]) {
      const answer = await log(query);
      expect(answer, query).toMatchObject({ status: 400, body: { ok: false, error: { code: 'cursor-invalid' } } });
    }
  });

  it('a cursor beyond the end of the transcript is a cursor-stale error that says to reload', async () => {
    const id = putSession(box, process.pid);
    writeLines(transcriptFile(box, id), conversation(2));
    const stale = Buffer.from(JSON.stringify({ o: 10_000_000 })).toString('base64url');
    const answer = await log(`?after=${stale}`);
    expect(answer).toMatchObject({ status: 200, body: { ok: false, error: { code: 'cursor-stale', hint: expect.stringContaining('without a cursor') } } });
  });
});

describe('GET /sessions/:sessionId/log: reading', () => {
  it('a transcript that appears after an empty answer is read from its end, not from byte 0', async () => {
    const id = putSession(box, process.pid);
    const empty = (await log()).body;
    expect(empty.cursor).toBeNull();
    writeLines(transcriptFile(box, id), conversation(1500, 2000));
    // the client sends no cursor again: the tail comes back with the cursor at the end of the file
    const body = (await log('?limit=20')).body;
    expect(texts(body.entries).at(-1)).toBe('#1499');
    expect(body.entries).toHaveLength(20);
    expect(body.cursor).toEqual(expect.any(String));
    expect(JSON.parse(Buffer.from(body.cursor, 'base64url').toString()).o).toBe(statSync(transcriptFile(box, id)).size);
  });

  it('a session with no transcript yet is ok with no entries and a note', async () => {
    putSession(box, process.pid);
    const answer = await log();
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ ok: true, entries: [], olderCursor: null, subagents: [], note: expect.stringContaining('No transcript yet') });
    // no cursor: the client asks for the tail again once the transcript exists
    expect(answer.body.cursor).toBeNull();
  });

  it('the newest entries, with a tool call merged with its result, the activity and the limits', async () => {
    const id = putSession(box, process.pid);
    writeLines(transcriptFile(box, id), [userLine(1, 'run the tests'), toolUseLine(2, 'toolu_1', 'Bash', { command: 'npm test' }), toolResultLine(3, 'toolu_1', 'all green'), textLine(4, 'done')]);
    const { status, body } = await log();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.sessionId).toBe(id);
    expect(body.entries.map((e: { kind: string }) => e.kind)).toEqual(['user-prompt', 'tool-call', 'assistant-text']);
    expect(body.entries[1]).toMatchObject({ name: 'Bash', inputSummary: 'npm test', status: 'ok', resultPreview: 'all green', key: 'call:toolu_1' });
    expect(body.olderCursor).toBeNull();
    expect(body.more).toBe(false);
    expect(body.note).toBe('');
    expect(body.activity).toMatchObject({ scope: 'window', lastToolSummary: 'Bash: npm test', turnsCount: 1, runningToolCalls: [] });
    expect(body.truncated).toEqual({ fieldsCut: 0, bodyCapped: false, unreadableLines: 0 });
    expect(body.limits).toEqual(LOG_LIMITS);
    // usage entries are not sent (the context size is in the activity)
    expect(JSON.stringify(body.entries)).not.toContain('"usage"');
  });

  it('pages backwards without gap or duplicate, across several reads of the file, until the start', async () => {
    const id = putSession(box, process.pid);
    // 200 entries of about 2 KB: 400 KB, more than one 256 KB page
    writeLines(transcriptFile(box, id), conversation(200, 2000));
    const first = (await log('?limit=150')).body;
    expect(first.entries).toHaveLength(150);
    expect(texts(first.entries)[0]).toBe('#50');
    expect(texts(first.entries).at(-1)).toBe('#199');
    expect(first.olderCursor).toEqual(expect.any(String));
    const second = (await log(`?before=${first.olderCursor}&limit=150`)).body;
    expect(second.cursor).toBeNull();
    expect(texts(second.entries)).toEqual(Array.from({ length: 50 }, (_v, i) => `#${i}`));
    expect(second.olderCursor).toBeNull();
  });

  it('a limit smaller than the transcript gives an olderCursor, and the last page has none', async () => {
    const id = putSession(box, process.pid);
    writeLines(transcriptFile(box, id), conversation(12));
    const pages: string[][] = [];
    let query = '?limit=5';
    for (let guard = 0; guard < 5; guard += 1) {
      const body = (await log(query)).body;
      pages.unshift(texts(body.entries));
      if (body.olderCursor === null) {
        break;
      }
      query = `?limit=5&before=${body.olderCursor}`;
    }
    expect(pages.map((p) => p.length)).toEqual([2, 5, 5]);
    expect(pages.flat()).toEqual(Array.from({ length: 12 }, (_v, i) => `#${i}`));
  });

  it('after: only what was written since the cursor; a running call is sent again, complete, with the same key', async () => {
    const id = putSession(box, process.pid);
    const file = transcriptFile(box, id);
    writeLines(file, [userLine(1, 'go'), toolUseLine(2, 'toolu_1', 'Bash', { command: 'sleep 5' })]);
    const first = (await log()).body;
    expect(first.entries.map((e: { kind: string; status?: string }) => e.status ?? e.kind)).toEqual(['user-prompt', 'running']);
    expect(first.activity.runningToolCalls).toHaveLength(1);

    const idle = (await log(`?after=${first.cursor}`)).body;
    expect(idle.entries.map((e: { status?: string }) => e.status)).toEqual(['running']);

    writeLines(file, [toolResultLine(3, 'toolu_1', 'woke up'), textLine(4, 'finished')], true);
    const next = (await log(`?after=${first.cursor}`)).body;
    expect(next.entries.map((e: { kind: string; status?: string }) => e.status ?? e.kind)).toEqual(['ok', 'assistant-text']);
    expect(next.entries[0]).toMatchObject({ key: 'call:toolu_1', name: 'Bash', resultPreview: 'woke up' });
    expect(next.more).toBe(false);

    // nothing new: no entry, the cursor stays valid
    const none = (await log(`?after=${next.cursor}`)).body;
    expect(none).toMatchObject({ ok: true, entries: [], more: false });
    writeLines(file, [userLine(5, 'thanks')], true);
    expect(texts((await log(`?after=${none.cursor}`)).body.entries)).toEqual(['thanks']);
  });

  it('the older page holds a call and its result as one complete entry', async () => {
    const id = putSession(box, process.pid);
    writeLines(transcriptFile(box, id), [userLine(1, 'a'), toolUseLine(2, 'toolu_1', 'Read', { file_path: 'a.txt' }), toolResultLine(3, 'toolu_1', 'content'), userLine(4, 'b')]);
    const tail = (await log('?limit=1')).body;
    expect(texts(tail.entries)).toEqual(['b']);
    const older = (await log(`?before=${tail.olderCursor}&limit=1`)).body;
    expect(older.entries).toHaveLength(1);
    expect(older.entries[0]).toMatchObject({ kind: 'tool-call', status: 'ok', resultPreview: 'content' });
  });

  it('shortens a long text to the limit, says so on the entry and in the counters', async () => {
    const id = putSession(box, process.pid);
    writeLines(transcriptFile(box, id), [textLine(1, 'z'.repeat(LOG_LIMITS.textChars + 500))]);
    const body = (await log()).body;
    expect(body.entries[0].text).toHaveLength(LOG_LIMITS.textChars);
    expect(body.entries[0]).toMatchObject({ textTruncated: true, textBytes: LOG_LIMITS.textChars + 500 });
    expect(body.truncated.fieldsCut).toBe(1);
  });

  it('replaces a large tool input by its summary and flags it', async () => {
    const id = putSession(box, process.pid);
    writeLines(transcriptFile(box, id), [toolUseLine(1, 'toolu_1', 'Write', { file_path: 'a.ts', content: 'q'.repeat(LOG_LIMITS.inputChars + 100) })]);
    const body = (await log()).body;
    expect(body.entries[0]).toMatchObject({ input: {}, inputTruncated: true, inputSummary: 'a.ts' });
    expect(body.truncated.fieldsCut).toBe(1);
  });

  it('never answers more than the body cap: the newest entries that fit, with an olderCursor for the rest', async () => {
    const id = putSession(box, process.pid);
    writeLines(transcriptFile(box, id), conversation(300, LOG_LIMITS.textChars - 100));
    const answer = await log('?limit=300');
    const size = JSON.stringify(answer.body.entries).length;
    expect(size).toBeLessThanOrEqual(LOG_LIMITS.maxBodyBytes);
    expect(answer.body.truncated.bodyCapped).toBe(true);
    expect(answer.body.entries.length).toBeLessThan(300);
    expect(texts(answer.body.entries).at(-1)).toBe('#299');
    expect(answer.body.olderCursor).toEqual(expect.any(String));
    const older = (await log(`?limit=300&before=${answer.body.olderCursor}`)).body;
    expect(texts(older.entries).at(-1)).toBe(`#${300 - answer.body.entries.length - 1}`);
  });

  it('the body cap counts bytes, not UTF-16 units: multibyte text is capped', async () => {
    const id = putSession(box, process.pid);
    // three bytes in UTF-8, one UTF-16 unit
    const EURO = String.fromCharCode(0x20ac);
    const lines = Array.from({ length: 100 }, (_v, i) => (i % 2 === 0 ? userLine(i, `#${i} `.padEnd(3900, EURO)) : textLine(i, `#${i} `.padEnd(3900, EURO))));
    writeLines(transcriptFile(box, id), lines);
    const { body } = await log('?limit=100');
    const json = JSON.stringify(body.entries);
    // fewer than maxBodyBytes UTF-16 units, more than maxBodyBytes bytes: only the byte count caps it
    expect(json.length).toBeLessThan(LOG_LIMITS.maxBodyBytes);
    expect(Buffer.byteLength(json, 'utf8')).toBeLessThanOrEqual(LOG_LIMITS.maxBodyBytes);
    expect(body.truncated.bodyCapped).toBe(true);
    expect(body.entries.length).toBeLessThan(100);
  });

  it('after: a line longer than the read window is skipped with a visible marker and the cursor advances', async () => {
    const id = putSession(box, process.pid);
    const file = transcriptFile(box, id);
    const head = userLine(1, 'before');
    const huge = JSON.stringify(userLine(2, 'h'.repeat(1_300_000)));
    writeFileSync(file, `${JSON.stringify(head)}
${huge}
${JSON.stringify(textLine(3, 'after the huge line'))}
`);
    const o = Buffer.byteLength(JSON.stringify(head)) + 1;
    let cursor = Buffer.from(JSON.stringify({ o })).toString('base64url');
    const seen: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const { body } = await log(`?after=${cursor}`);
      expect(body.ok).toBe(true);
      if (i > 0) {
        expect(body.cursor).not.toBe(cursor);
      }
      seen.push(...body.entries.map((e: { kind: string; text?: string }) => e.text ?? e.kind));
      cursor = body.cursor;
      if (!body.more) {
        break;
      }
    }
    expect(seen).toEqual(['oversize', 'after the huge line']);
  });

  it('reports lines the reader cannot show instead of dropping them', async () => {
    const id = putSession(box, process.pid);
    writeFileSync(transcriptFile(box, id), `${JSON.stringify(userLine(1, 'ok'))}\nthis is not json\n`);
    const body = (await log()).body;
    expect(body.entries.map((e: { kind: string }) => e.kind)).toEqual(['user-prompt', 'unparsable']);
    expect(body.truncated.unreadableLines).toBe(1);
  });

  it('lists the sub-agents as a tree and links the call that started each, without exposing local paths', async () => {
    const id = putSession(box, process.pid);
    writeLines(transcriptFile(box, id), [userLine(1, 'go'), toolUseLine(2, 'toolu_a', 'Agent', { description: 'look around', prompt: 'p' })]);
    const dir = join(box.projects, SLUG, id, 'subagents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'look around', toolUseId: 'toolu_a' }));
    writeFileSync(join(dir, 'agent-a2.meta.json'), '{not json');
    const body = (await log()).body;
    // No transcript of its own yet: just started, so running, and no time is invented.
    expect(body.subagents).toEqual([{ agentId: 'a1', status: 'active', agentType: 'Explore', description: 'look around', finished: false, isFork: false, toolUseId: 'toolu_a', usageNote: expect.stringMatching(/no transcript yet/i), children: [] }]);
    expect(body.entries[1]).toMatchObject({ kind: 'tool-call', subagentId: 'a1' });
    expect(body.subagentsNote).toContain('agent-a2.meta.json');
    expect(JSON.stringify(body)).not.toContain(JSON.stringify(box.projects).slice(1, -1));
  });

  it('reads a bounded part of a large transcript', async () => {
    const id = putSession(box, process.pid);
    const file = transcriptFile(box, id);
    // about 3 MB: the newest 20 entries come back, the rest is behind olderCursor
    writeLines(file, conversation(1500, 2000));
    expect(statSync(file).size).toBeGreaterThan(3_000_000);
    const body = (await log('?limit=20')).body;
    expect(body.entries).toHaveLength(20);
    expect(texts(body.entries).at(-1)).toBe('#1499');
    expect(body.olderCursor).toEqual(expect.any(String));
  });

  describe('sub-agent status and times', () => {
    function meta(id: string, fields: Record<string, unknown>, lastWrite?: number): void {
      const dir = join(box.projects, SLUG, sessionOf.id, 'subagents');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'general-purpose', description: id, ...fields }));
      if (lastWrite !== undefined) {
        const file = join(dir, `agent-${id}.jsonl`);
        writeFileSync(file, JSON.stringify({ type: 'user', timestamp: new Date(lastWrite - 90_000).toISOString(), message: { role: 'user', content: 'x' } }) + '\n');
        utimesSync(file, new Date(lastWrite), new Date(lastWrite));
      }
    }
    const sessionOf = { id: '' };

    it('says active (a guess: no end marker, written lately), finished, failed or idle from the meta and the time of the last write, with start and end times from the transcript', async () => {
      sessionOf.id = putSession(box, process.pid);
      writeLines(transcriptFile(box, sessionOf.id), [userLine(1, 'go')]);
      const now = Date.now();
      meta('run', {}, now - 30_000);
      meta('fin', { finished: true }, now - 120_000);
      meta('bad', { stoppedByUser: true }, now - 60_000);
      meta('old', {}, now - RUNNING_FRESH_MS - 60_000);
      const byId = Object.fromEntries((await log()).body.subagents.map((s: { agentId: string }) => [s.agentId, s]));
      expect(byId.run).toMatchObject({ status: 'active', lastActivityAt: expect.any(Number), startedAt: expect.any(Number) });
      expect(byId.run.endedAt).toBeUndefined();
      expect(byId.fin).toMatchObject({ status: 'finished', finished: true });
      expect(byId.fin.endedAt).toBe(byId.fin.lastActivityAt);
      expect(byId.fin.endedAt - byId.fin.startedAt).toBeGreaterThan(80_000);
      expect(byId.bad).toMatchObject({ status: 'failed', failureReason: 'Stopped by the user' });
      expect(byId.bad.endedAt).toBe(byId.bad.lastActivityAt);
      // Not marked finished and silent for longer than the freshness window: idle, with no end time (nothing says it ended).
      expect(byId.old.status).toBe('idle');
      expect(byId.old.endedAt).toBeUndefined();
    });

    it('adds the model, tokens and context share of each sub-agent from its own transcript, and says why when there is none', async () => {
      sessionOf.id = putSession(box, process.pid);
      writeLines(transcriptFile(box, sessionOf.id), [userLine(1, 'go')]);
      const now = Date.now();
      meta('run', { model: 'sonnet' }, now - 30_000);
      const file = join(box.projects, SLUG, sessionOf.id, 'subagents', 'agent-run.jsonl');
      writeFileSync(file, `${JSON.stringify({ isSidechain: true, agentId: 'run', type: 'assistant', uuid: 'u1', timestamp: new Date(now - 60_000).toISOString(), message: { id: 'm1', model: 'claude-sonnet-4-6', role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 40 } } })}
`);
      utimesSync(file, new Date(now - 30_000), new Date(now - 30_000));
      meta('bare', {}, now - 30_000);
      const byId = Object.fromEntries((await log()).body.subagents.map((s: { agentId: string }) => [s.agentId, s]));
      expect(byId.run.model).toBe('sonnet');
      expect(byId.run.usage).toMatchObject({ model: { displayName: 'Sonnet 4.6' }, tokensIn: 1002, tokensOut: 40, contextUsedPct: { usedTokens: 1002, windowTokens: 200_000 } });
      expect(byId.run.usageNote).toBeUndefined();
      expect(byId.bare.usage).toBeUndefined();
      expect(byId.bare.usageNote).toMatch(/no assistant message with usage/i);
    });

    it('says "unknown" with the reason when a transcript exists but cannot be read, never "active"', async () => {
      sessionOf.id = putSession(box, process.pid);
      writeLines(transcriptFile(box, sessionOf.id), [userLine(1, 'go')]);
      meta('bro', {});
      // A folder where the transcript should be: not "no such file", so not "just started".
      mkdirSync(join(box.projects, SLUG, sessionOf.id, 'subagents', 'agent-bro.jsonl'));
      const bro = (await log()).body.subagents.find((s: { agentId: string }) => s.agentId === 'bro');
      expect(bro).toMatchObject({ status: 'unknown', readError: expect.stringMatching(/could not be (opened|read)/) });
      expect(bro.lastActivityAt).toBeUndefined();
    });
  });
});

describe('GET /sessions/:sessionId/log: live polling across big lines', () => {
  const cursorAt = (o: number): string => Buffer.from(JSON.stringify({ o })).toString('base64url');

  it('after: a 95 KB line between two entries arrives (shortened, flagged), with the entries around it, and the cursor ends at the end of the file', async () => {
    const id = putSession(box, process.pid);
    const file = transcriptFile(box, id);
    const head = JSON.stringify(userLine(1, 'sent from the page'));
    const big = JSON.stringify(userLine(2, 'b'.repeat(95_000)));
    const answerLine = JSON.stringify(textLine(3, 'Salut, the answer'));
    writeFileSync(file, `${head}\n${big}\n${answerLine}\n`);
    const { body } = await log(`?after=${cursorAt(Buffer.byteLength(head) + 1)}`);
    expect(body.ok).toBe(true);
    expect(body.entries.map((e: { kind: string; text?: string }) => (e.text ?? e.kind).slice(0, 12))).toEqual(['bbbbbbbbbbbb', 'Salut, the a']);
    expect(body.entries[0]).toMatchObject({ textTruncated: true });
    expect(body.truncated.fieldsCut).toBe(1);
    expect(body.more).toBe(false);
    // The cursor also carries the model of the transcript at that point (see CursorModel in logRoute.ts): only its offset is compared here.
    expect(JSON.parse(Buffer.from(body.cursor, 'base64url').toString()).o).toBe(statSync(file).size);
  });

  it('after: a line still being written is not delivered half, and arrives whole once it is complete', async () => {
    const id = putSession(box, process.pid);
    const file = transcriptFile(box, id);
    const head = JSON.stringify(userLine(1, 'hello'));
    writeFileSync(file, `${head}\n`);
    let cursor = cursorAt(Buffer.byteLength(head) + 1);
    const full = JSON.stringify(textLine(2, 'the answer that was written in two parts'));
    writeFileSync(file, `${head}\n${full.slice(0, 40)}`);
    const partial = (await log(`?after=${cursor}`)).body;
    expect(partial.entries).toEqual([]);
    cursor = partial.cursor;
    writeFileSync(file, `${head}\n${full}\n`);
    const complete = (await log(`?after=${cursor}`)).body;
    expect(texts(complete.entries)).toEqual(['the']);
  });

  it('after: a cursor in the middle of a line is refused as stale with the way out, not read from the middle', async () => {
    const id = putSession(box, process.pid);
    const file = transcriptFile(box, id);
    writeLines(file, [userLine(1, 'a'.repeat(300)), textLine(2, 'b')]);
    const answer = await log(`?after=${cursorAt(100)}`);
    expect(answer.body).toMatchObject({ ok: false, error: { code: 'cursor-stale', hint: expect.stringContaining('without a cursor') } });
  });
});

describe('GET /sessions/:sessionId/log/locate', () => {
  const locate = (toolUseId: string, id = ID(process.pid)) => makeModule({ dataDir: box.data }).call('GET', `/sessions/${id}/log/locate?toolUseId=${encodeURIComponent(toolUseId)}`);

  it('finds the line of a call far back, and the offset is the offset of its entry in the log', async () => {
    const id = putSession(box, process.pid);
    const lines = [...conversation(400, 2000), toolUseLine(500, 'toolu_far', 'Agent', { description: 'far call', prompt: 'p' }), toolResultLine(501, 'toolu_far', 'done'), ...conversation(400, 2000)];
    writeLines(transcriptFile(box, id), lines);
    const answer = await locate('toolu_far', id);
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ ok: true, toolUseId: 'toolu_far', found: true, offset: expect.any(Number) });
    // Paging back until that offset is reached holds the call, with exactly that offset.
    let page = (await log('?limit=500', id)).body;
    let entries = page.entries as { kind: string; id?: string; offset: number }[];
    while (page.olderCursor !== null && entries[0]!.offset > answer.body.offset) {
      page = (await log(`?limit=500&before=${encodeURIComponent(page.olderCursor)}`, id)).body;
      entries = [...page.entries, ...entries];
    }
    expect(entries.find((entry) => entry.kind === 'tool-call' && entry.id === 'toolu_far')?.offset).toBe(answer.body.offset);
  });

  it('finds a call at the very start of the transcript (offset 0) and across a chunk boundary', async () => {
    const id = putSession(box, process.pid);
    writeLines(transcriptFile(box, id), [toolUseLine(1, 'toolu_first', 'Agent', {}), ...conversation(900, 3000), toolUseLine(2, 'toolu_edge', 'Agent', {})]);
    expect((await locate('toolu_first', id)).body).toMatchObject({ found: true, offset: 0 });
    const edge = (await locate('toolu_edge', id)).body;
    expect(edge.found).toBe(true);
    expect(edge.offset).toBeGreaterThan(2_000_000);
  });

  it('says not found, plainly, for a call no line has, and does not match a result that only names it', async () => {
    const id = putSession(box, process.pid);
    writeLines(transcriptFile(box, id), [userLine(1, 'go'), toolResultLine(2, 'toolu_only_result', 'x')]);
    expect((await locate('toolu_missing', id)).body).toMatchObject({ ok: true, found: false, transcriptBytes: expect.any(Number) });
    expect((await locate('toolu_only_result', id)).body.found).toBe(false);
  });

  it('skips a line that only holds the id bytes (a result that embeds the id) and finds the real call after it', async () => {
    const id = putSession(box, process.pid);
    // The first line has `"id":"toolu_dup"` as a key of a tool_result line: the bytes match, the line is not the call.
    const embedded = { ...toolResultLine(1, 'toolu_other', 'x'), extra: { id: 'toolu_dup' } };
    writeLines(transcriptFile(box, id), [userLine(0, 'go'), embedded, toolUseLine(3, 'toolu_dup', 'Agent', {})]);
    const answer = (await locate('toolu_dup', id)).body;
    expect(answer.found).toBe(true);
    // Not the offset of the embedding line: it is the third line.
    const lines = readFileSync(transcriptFile(box, id), 'utf8').split('\n');
    expect(answer.offset).toBe(Buffer.byteLength(lines[0] + '\n' + lines[1] + '\n'));
  });

  it('says not found when only a non-call line has the id bytes', async () => {
    const id = putSession(box, process.pid);
    writeLines(transcriptFile(box, id), [{ ...toolResultLine(1, 'toolu_other', 'x'), extra: { id: 'toolu_dup' } }]);
    expect((await locate('toolu_dup', id)).body.found).toBe(false);
  });

  it('finds a call in spaced JSON ("id": "<id>")', async () => {
    const id = putSession(box, process.pid);
    const spaced = JSON.stringify(toolUseLine(2, 'toolu_sp', 'Agent', {})).replace('"id":"toolu_sp"', '"id": "toolu_sp"');
    expect(spaced).toContain('"id": "toolu_sp"');
    writeFileSync(transcriptFile(box, id), JSON.stringify(userLine(1, 'go')) + '\n' + spaced + '\n');
    const answer = (await locate('toolu_sp', id)).body;
    expect(answer).toMatchObject({ found: true });
    expect(answer.offset).toBeGreaterThan(0);
  });

  it('answers not found for a session without a transcript, and refuses a malformed id', async () => {
    const id = putSession(box, process.pid);
    expect((await locate('toolu_x', id)).body).toMatchObject({ ok: true, found: false, transcriptBytes: 0 });
    for (const bad of ['', 'a b', '../x', 'x'.repeat(200)]) {
      const answer = await locate(bad, id);
      expect(answer.status).toBe(400);
      expect(answer.body).toMatchObject({ ok: false, error: { code: 'bad-request', hint: expect.stringContaining('toolUseId') } });
    }
    expect((await locate('toolu_x', ID(999_999))).status).toBe(404);
  });
});
