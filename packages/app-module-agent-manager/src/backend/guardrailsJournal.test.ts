import { describe, expect, it } from 'vitest';
import { listJournalDays, parseJournalLine, readJournalTail } from './guardrailsJournal.js';
import { journalLine, putJournal, useHome } from './guardrailsFixtures.js';

const BIG = 5 * 1024 * 1024;

describe('parseJournalLine (shape version 1)', () => {
  it('reads a record, the session prefix and the optional nulls', () => {
    const record = parseJournalLine(JSON.stringify(journalLine({ session: '287760ca:A:a2a5:general-purpose', command: null, file: '/x/y.ts', tool: 'Write' })), '2026-11-21');
    expect(record).toMatchObject({ record: { prefix: '287760ca', decision: 'deny', category: 'rm', command: null, file: '/x/y.ts', day: '2026-11-21' } });
  });

  it('names what is wrong instead of guessing', () => {
    expect(parseJournalLine('{nope', 'd')).toEqual({ error: expect.stringMatching(/^not JSON/) });
    expect(parseJournalLine('[1]', 'd')).toEqual({ error: 'not a JSON object' });
    expect(parseJournalLine(JSON.stringify(journalLine({ schema: 2 })), 'd')).toEqual({ error: "unknown field 'schema'" });
    expect(parseJournalLine(JSON.stringify(journalLine({ decision: 'allow' })), 'd')).toEqual({ error: expect.stringMatching(/'decision' is "allow"/) });
    expect(parseJournalLine(JSON.stringify(journalLine({ ts: 'yesterday' })), 'd')).toEqual({ error: expect.stringMatching(/'ts'/) });
    expect(parseJournalLine(JSON.stringify(journalLine({ command: 5 })), 'd')).toEqual({ error: expect.stringMatching(/'command'/) });
  });
});

describe('readJournalTail', () => {
  const home = useHome();

  it('says visibly that the journal folder is missing', async () => {
    const tail = await readJournalTail(`${home.journalDir}-none`, { limit: 10, budgetBytes: BIG });
    expect(tail.records).toEqual([]);
    expect(tail.problems[0]!.message).toMatch(/does not exist/);
  });

  it('lists the day files newest first and ignores other names', async () => {
    putJournal(home.journalDir, '2026-11-19', [journalLine()]);
    putJournal(home.journalDir, '2026-11-21', [journalLine()]);
    putJournal(home.journalDir, '2026-11-20', [journalLine()]);
    expect((await listJournalDays(home.journalDir)).days).toEqual(['2026-11-21', '2026-11-20', '2026-11-19']);
  });

  it('returns the newest records first, across days, up to the limit, and says older ones exist', async () => {
    putJournal(home.journalDir, '2026-11-20', [journalLine({ command: 'a' }), journalLine({ command: 'b' })]);
    putJournal(home.journalDir, '2026-11-21', [journalLine({ command: 'c' }), journalLine({ command: 'd' })]);
    const all = await readJournalTail(home.journalDir, { limit: 10, budgetBytes: BIG });
    expect(all.records.map((r) => r.command)).toEqual(['d', 'c', 'b', 'a']);
    expect(all.truncated).toBe(false);
    const two = await readJournalTail(home.journalDir, { limit: 2, budgetBytes: BIG });
    expect(two.records.map((r) => r.command)).toEqual(['d', 'c']);
    expect(two.truncated).toBe(true);
  });

  it('filters by day, category and session prefix, and offers the categories it saw', async () => {
    putJournal(home.journalDir, '2026-11-20', [journalLine({ trigger: 'kill', session: 'aaaaaaaa:M' })]);
    putJournal(home.journalDir, '2026-11-21', [journalLine({ trigger: 'rm', session: 'bbbbbbbb:M' }), journalLine({ trigger: 'kill', session: 'bbbbbbbb:A:1234:x' })]);
    expect((await readJournalTail(home.journalDir, { day: '2026-11-20', limit: 10, budgetBytes: BIG })).records).toHaveLength(1);
    expect((await readJournalTail(home.journalDir, { category: 'kill', limit: 10, budgetBytes: BIG })).records).toHaveLength(2);
    const bySession = await readJournalTail(home.journalDir, { sessionPrefix: 'bbbb', limit: 10, budgetBytes: BIG });
    expect(bySession.records).toHaveLength(2);
    expect(bySession.categories).toEqual(['kill', 'rm']);
  });

  it('reads only the tail within the budget, never cuts a line in two, and says it did not read everything', async () => {
    // 3000 lines of about 200 bytes: 600 KB, read with a 100 KB budget in 64 KB chunks.
    const lines = Array.from({ length: 3000 }, (_, i) => journalLine({ command: `cmd-${String(i).padStart(5, '0')}-${'x'.repeat(120)}` }));
    putJournal(home.journalDir, '2026-11-21', lines);
    const tail = await readJournalTail(home.journalDir, { limit: 500, budgetBytes: 100 * 1024 });
    expect(tail.skipped.count).toBe(0);
    expect(tail.problems).toEqual([]);
    expect(tail.truncated).toBe(true);
    expect(tail.bytesRead).toBeLessThanOrEqual(100 * 1024);
    expect(tail.records[0]!.command).toMatch(/^cmd-02999-/);
    // The records are consecutive: a line cut at a chunk boundary would break the sequence or be skipped.
    const numbers = tail.records.map((r) => Number(/^cmd-(\d+)/.exec(r.command ?? '')![1]));
    expect(numbers.every((n, i) => i === 0 || n === numbers[i - 1]! - 1)).toBe(true);
  });

  it('reads a whole small file including its first line', async () => {
    putJournal(home.journalDir, '2026-11-21', [journalLine({ command: 'first' }), journalLine({ command: 'last' })]);
    const tail = await readJournalTail(home.journalDir, { limit: 10, budgetBytes: BIG });
    expect(tail.records.map((r) => r.command)).toEqual(['last', 'first']);
  });

  it('does not skip lines silently: an unknown shape is counted, named and reported as a problem', async () => {
    putJournal(home.journalDir, '2026-11-21', [journalLine({ command: 'ok' }), journalLine({ extra: 1 }), 'not json at all']);
    const tail = await readJournalTail(home.journalDir, { limit: 10, budgetBytes: BIG });
    expect(tail.records.map((r) => r.command)).toEqual(['ok']);
    expect(tail.skipped.count).toBe(2);
    expect(tail.skipped.example).toMatch(/unknown field 'extra'|not JSON/);
    expect(tail.problems.some((p) => p.message.includes('2 line(s) of the journal do not have the known shape'))).toBe(true);
  });
});
