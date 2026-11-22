import { afterEach, describe, expect, it, vi } from 'vitest';
import { ID, putSession, useSandbox } from './apiFixtures.js';
import { journalLine, putCounters, putJournal, useHome } from './guardrailsFixtures.js';
import { guardrailBlocksFor } from './guardrailsRoutes.js';
import { readJournalTail } from './guardrailsJournal.js';
import { RECENT_BLOCK_WINDOW_MS } from '../commons/guardrails.js';
import { makeModule } from './testKit.js';

// The "recent" blocks of the list badge: counted from the journal records (their `ts`), against the clock of each poll. Nothing of the real ~/.claude is read.
const box = useSandbox();
const home = useHome();

const NOW = Date.parse('2026-11-22T12:00:00.000Z');
const MIN = 60_000;
const at = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();
const SESSION = ID(4242);
const PREFIX = SESSION.slice(0, 8);

const put = (lines: readonly unknown[]): void => {
  putJournal(home.journalDir, '2026-11-22', lines);
};

describe('RECENT_BLOCK_WINDOW_MS', () => {
  it('is 30 minutes', () => {
    expect(RECENT_BLOCK_WINDOW_MS).toBe(30 * MIN);
  });
});

describe('readJournalTail sinceMs', () => {
  it('stops at the first record older than the window and does not call that truncated', async () => {
    put([journalLine({ ts: at(-3 * 60 * MIN) }), journalLine({ ts: at(-40 * MIN) }), journalLine({ ts: at(-5 * MIN) }), journalLine({ ts: at(-1 * MIN) })]);
    const tail = await readJournalTail(home.journalDir, { limit: 1000, budgetBytes: 1024 * 1024, sinceMs: NOW - RECENT_BLOCK_WINDOW_MS });
    expect(tail.records.map((record) => record.at)).toEqual([NOW - MIN, NOW - 5 * MIN]);
    expect(tail.truncated).toBe(false);
  });

  it('says truncated when the byte budget ends before the window start was reached', async () => {
    put(Array.from({ length: 50 }, () => journalLine({ ts: at(-2 * MIN) })));
    const tail = await readJournalTail(home.journalDir, { limit: 1000, budgetBytes: 600, sinceMs: NOW - RECENT_BLOCK_WINDOW_MS });
    expect(tail.truncated).toBe(true);
  });
});

describe('guardrailBlocksFor: recent blocks', () => {
  function rowsOf(project: string): { sessionId: string; cwd: string }[] {
    return [{ sessionId: SESSION, cwd: project }];
  }

  it('counts the denials of the session (sub-agents included) that are inside the window, by category, and not the old ones, the asks, nor another session', async () => {
    const project = home.project('recent');
    putCounters(project, { requests: { [SESSION]: { block_counts: { rm: 37 } } } });
    put([
      journalLine({ ts: at(-2 * 60 * MIN), session: `${PREFIX}:M`, trigger: 'rm' }),
      journalLine({ ts: at(-2 * 60 * MIN), session: `${PREFIX}:M`, trigger: 'rm' }),
      journalLine({ ts: at(-5 * MIN), session: `${PREFIX}:M`, trigger: 'rm' }),
      journalLine({ ts: at(-4 * MIN), session: `${PREFIX}:A:a2a5:general-purpose`, trigger: 'kill' }),
      journalLine({ ts: at(-3 * MIN), session: `${PREFIX}:M`, trigger: 'kill' }),
      journalLine({ ts: at(-3 * MIN), session: `${PREFIX}:M`, trigger: 'eval', decision: 'ask' }),
      journalLine({ ts: at(-3 * MIN), session: 'ffffffff:M', trigger: 'rm' }),
    ]);
    const result = await guardrailBlocksFor(rowsOf(project), NOW, home.journalDir);
    expect(result.byId.get(SESSION)).toEqual({ total: 37, categories: [{ category: 'rm', count: 37 }], timeout: false, recent: { total: 3, categories: [{ category: 'kill', count: 2 }, { category: 'rm', count: 1 }] } });
    expect(result.errorText).toBe('');
  });

  it('is evaluated against the clock of each call: the same journal gives a count, then none once the window has passed (a record exactly 30 min old is still inside)', async () => {
    const project = home.project('clock');
    putCounters(project, { requests: { [SESSION]: { block_counts: { rm: 4 } } } });
    put([journalLine({ ts: at(-5 * MIN), session: `${PREFIX}:M` })]);
    const rows = rowsOf(project);
    expect((await guardrailBlocksFor(rows, NOW, home.journalDir)).byId.get(SESSION)?.recent.total).toBe(1);
    expect((await guardrailBlocksFor(rows, NOW + 25 * MIN, home.journalDir)).byId.get(SESSION)?.recent.total).toBe(1);
    expect((await guardrailBlocksFor(rows, NOW + 25 * MIN + 1, home.journalDir)).byId.get(SESSION)?.recent.total).toBe(0);
    const later = (await guardrailBlocksFor(rows, NOW + 26 * MIN, home.journalDir)).byId.get(SESSION);
    expect(later).toEqual({ total: 4, categories: [{ category: 'rm', count: 4 }], timeout: false, recent: { total: 0, categories: [] } });
  });

  it('a session with recent denials and no counters still gets its recent count (the counters only hold denials that carry a bypass hint); one with neither gets nothing', async () => {
    const project = home.project('nocounters');
    put([journalLine({ ts: at(-1 * MIN), session: `${PREFIX}:M`, trigger: 'protected-file' })]);
    // ID(n) always starts with 00000000: another prefix for the quiet session, or the two would be ambiguous.
    const quiet = '11111111-0000-4000-8000-000000000777';
    const result = await guardrailBlocksFor([...rowsOf(project), { sessionId: quiet, cwd: project }], NOW, home.journalDir);
    expect(result.byId.get(SESSION)).toEqual({ total: 0, categories: [], timeout: false, recent: { total: 1, categories: [{ category: 'protected-file', count: 1 }] } });
    expect(result.byId.has(quiet)).toBe(false);
  });

  it('a record without a usable timestamp is not recent, and the journal says so (never counted silently)', async () => {
    const project = home.project('nots');
    putCounters(project, { requests: { [SESSION]: { block_counts: { rm: 1 } } } });
    put([{ ...journalLine({ session: `${PREFIX}:M` }), ts: undefined }, journalLine({ ts: 'yesterday', session: `${PREFIX}:M` }), journalLine({ ts: at(-1 * MIN), session: `${PREFIX}:M` })]);
    const result = await guardrailBlocksFor(rowsOf(project), NOW, home.journalDir);
    expect(result.byId.get(SESSION)?.recent.total).toBe(1);
    expect(result.errorText).toMatch(/do not have the known shape/);
  });

  it('two sessions with the same 8 characters cannot be told apart in the journal: no recent count for either', async () => {
    const project = home.project('ambiguous');
    const other = `${PREFIX}-1111-4000-8000-aaaaaaaaaaaa`;
    putCounters(project, { requests: { [SESSION]: { block_counts: { rm: 2 } }, [other]: { block_counts: { rm: 3 } } } });
    put([journalLine({ ts: at(-1 * MIN), session: `${PREFIX}:M` })]);
    const result = await guardrailBlocksFor([{ sessionId: SESSION, cwd: project }, { sessionId: other, cwd: project }], NOW, home.journalDir);
    expect(result.byId.get(SESSION)?.recent.total).toBe(0);
    expect(result.byId.get(other)?.recent.total).toBe(0);
  });

  it('no journal folder is the normal state of a machine without the plugin: no message', async () => {
    const project = home.project('nojournal');
    putCounters(project, { requests: { [SESSION]: { block_counts: { rm: 1 } } } });
    const result = await guardrailBlocksFor(rowsOf(project), NOW, `${home.journalDir}-missing`);
    expect(result.errorText).toBe('');
    expect(result.byId.get(SESSION)?.recent.total).toBe(0);
  });
});

describe('GET /sessions: the badge window follows the clock of the poll', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('the recent count is there on one poll and gone on the poll after the window passed, with no new journal line', async () => {
    const project = home.project('route');
    putSession(box, process.pid, { cwd: project });
    const id = ID(process.pid);
    putCounters(project, { requests: { [id]: { block_counts: { rm: 9 } } } });
    put([journalLine({ ts: new Date(Date.now() - 5 * MIN).toISOString(), session: `${id.slice(0, 8)}:M` })]);
    const module = makeModule({ dataDir: box.data, options: { guardrails: { homeDir: home.home } } });
    const find = (body: { sessions: { pid: number; guardrailBlocks?: { total: number; recent: { total: number } } }[] }) => body.sessions.find((s) => s.pid === process.pid)?.guardrailBlocks;
    expect(find((await module.call('GET', '/sessions')).body)).toMatchObject({ total: 9, recent: { total: 1 } });
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 26 * MIN });
    expect(find((await module.call('GET', '/sessions')).body)).toMatchObject({ total: 9, recent: { total: 0 } });
  });
});
