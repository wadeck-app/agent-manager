import { describe, expect, it, vi } from 'vitest';
import { putSession, useSandbox } from './apiFixtures.js';
import { grantEntry, journalLine, putCounters, putGrants, putJournal, putRules, useHome } from './guardrailsFixtures.js';
import { ioStats } from './guardrailsFiles.js';
import { makeModule } from './testKit.js';

// The overview is polled every 5 s: what did not change is not read again (temp folders only).
const box = useSandbox();
const home = useHome();

function mod(): ReturnType<typeof makeModule> {
  return makeModule({ dataDir: box.data, options: { guardrails: { homeDir: home.home } } });
}

describe('the caches of the overview', () => {
  it('does not read an unchanged file again, reads a changed one, and keeps the folder list while nothing changed', async () => {
    const project = home.project('cached');
    putSession(box, 4242, { cwd: project });
    putGrants(project, { overrides: [grantEntry({ id: 'one' })] });
    putCounters(project, { requests: { s1: { block_counts: { rm: 1 } } } });
    putRules(project, { categories: { rm: 'deny' } });
    const m = mod();
    const first = (await m.call('GET', '/guardrails/overview')).body;
    const afterFirst = { ...ioStats };
    expect(afterFirst.discoveries).toBeGreaterThan(0);
    expect(first.grants).toHaveLength(1);
    const reads = afterFirst.jsonReads;
    await m.call('GET', '/guardrails/overview');
    expect(ioStats).toEqual(afterFirst);
    // The grants file changes (another size): that file alone is read again, and the page sees it.
    putGrants(project, { overrides: [grantEntry({ id: 'one' }), grantEntry({ id: 'two', category: 'kill' })] });
    const third = (await m.call('GET', '/guardrails/overview')).body;
    expect(ioStats.jsonReads).toBe(reads + 1);
    expect(ioStats.discoveries).toBe(afterFirst.discoveries);
    expect(third.grants.map((g: { id: string }) => g.id).sort()).toEqual(['one', 'two']);
  });

  it('drops the folder list when the journal gets a new line, and after the time limit', async () => {
    const project = home.project('journal-cache');
    putSession(box, 4242, { cwd: project });
    putJournal(home.journalDir, '2026-11-21', [journalLine({ project })]);
    const m = mod();
    await m.call('GET', '/guardrails/overview');
    const base = ioStats.discoveries;
    await m.call('GET', '/guardrails/overview');
    expect(ioStats.discoveries).toBe(base);
    putJournal(home.journalDir, '2026-11-21', [journalLine({ project }), journalLine({ project, command: 'a new denial' })]);
    await m.call('GET', '/guardrails/overview');
    expect(ioStats.discoveries).toBe(base + 1);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 11_000 });
    try {
      await m.call('GET', '/guardrails/overview');
      expect(ioStats.discoveries).toBe(base + 2);
    } finally {
      vi.useRealTimers();
    }
  });
});
