import { describe, expect, it } from 'vitest';
import { fitItems, fitRows, hiddenSummary, LINE_PRIORITY } from './lineFit.js';

const widths = { folder: 196, model: 124, context: 39, move: 132, tokens: 104, pid: 50 };
const base = { widths, order: ['folder', 'context', 'move', 'model', 'tokens', 'pid'], gap: 8, moreWidth: 36 };

describe('which chips of the header line fit', () => {
  it('shows everything, and no +N chip, when everything fits', () => {
    const total = Object.values(widths).reduce((sum, width) => sum + width + 8, 0);
    expect([...fitItems({ ...base, available: total })].sort()).toEqual(Object.keys(widths).sort());
  });

  it('keeps a narrow chip that fits even when a wider one before it in the priority does not (the old fit dropped everything after the folder)', () => {
    // 87 px free: the folder (196) cannot fit, the context (39) can once the +N chip (36 + gap) is reserved.
    const shown = fitItems({ ...base, available: 87 + 8 + 36 });
    expect([...shown]).toEqual(['context']);
  });

  it('keeps the highest priorities first when only some fit', () => {
    // folder 196 + gap, context 39 + gap = 251, plus the +N chip 44 = 295: the move (132) and the others do not fit.
    const shown = fitItems({ ...base, available: 295 });
    expect([...shown].sort()).toEqual(['context', 'folder']);
  });

  it('drops everything, with the +N chip alone, when not even the first chip fits', () => {
    expect(fitItems({ ...base, available: 30 }).size).toBe(0);
  });

  it('never keeps a chip whose width was not measured', () => {
    expect(fitItems({ ...base, widths: { folder: 100 }, order: ['folder', 'ghost'], available: 1000 }).has('ghost')).toBe(false);
  });

  it('has one documented priority: folder, context, model, role, program, tokens, duration, session id, pid', () => {
    expect(LINE_PRIORITY).toEqual(['folder', 'context', 'model', 'role', 'harness', 'tokens', 'duration', 'session', 'pid']);
  });
});

describe('what the +N tooltip lists', () => {
  it('writes every hidden item with its value', () => {
    expect(
      hiddenSummary([
        { label: 'context', value: '38% of the way to auto-compact' },
        { label: 'pid', value: '4242' },
      ]),
    ).toBe('context 38% of the way to auto-compact; pid 4242');
  });

  it('omits an entry without a value instead of printing a bare label such as "context used"', () => {
    const text = hiddenSummary([
      { label: 'context used', value: '' },
      { label: 'model', value: '   ' },
      { label: 'pid', value: '7' },
    ]);
    expect(text).toBe('pid 7');
    expect(text).not.toContain('context used');
  });
});

describe('the second row of the header line', () => {
  it('puts the chips in order: the first row stops at the first chip that does not fit and the second row continues from it, before any +N chip', () => {
    // 100 px free next to the name: the wide folder (196) does not fit, so nothing narrower jumps ahead of it; the second row (400 px, minus the +N chip) takes the folder and the context, then what still fits (the second row keeps the order too).
    const rows = fitRows({ ...base, available: 100, secondAvailable: 400 });
    expect([...rows.first]).toEqual([]);
    expect([...rows.second]).toEqual(['folder', 'context', 'tokens']);
  });

  it('reads the same order whatever the widths: the first row is a prefix of the priority order', () => {
    const rows = fitRows({ ...base, available: 196 + 8 + 39 + 8 + 5, secondAvailable: 400 });
    expect([...rows.first]).toEqual(['folder', 'context']);
    expect([...rows.second][0]).toBe('move');
  });

  it('leaves only what does not fit on the second row either to the +N chip (the second row reserves its room)', () => {
    const rows = fitRows({ ...base, available: 100, secondAvailable: 250 });
    expect([...rows.first, ...rows.second].length).toBeLessThan(Object.keys(widths).length);
    expect(rows.second.size).toBeGreaterThan(0);
  });

  it('draws no second row when everything fits on the first one', () => {
    const rows = fitRows({ ...base, available: 2000, secondAvailable: 400 });
    expect(rows.second.size).toBe(0);
    expect(rows.first.size).toBe(Object.keys(widths).length);
  });

  it('without a width for the second row (no layout) it is the first row alone with its +N chip, as before', () => {
    expect([...fitRows({ ...base, available: 87 + 8 + 36, secondAvailable: 0 }).first]).toEqual(['context']);
    expect(fitRows({ ...base, available: 87 + 8 + 36, secondAvailable: 0 }).second.size).toBe(0);
  });
});
