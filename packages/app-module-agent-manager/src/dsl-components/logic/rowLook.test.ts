import { afterEach, describe, expect, it } from 'vitest';
import {
  ACTIVE_BACKGROUNDS,
  DEFAULT_ROW_LOOK,
  HIGHLIGHT_COLORS,
  ROW_LOOK_STORAGE_KEY,
  STATE_HUES,
  activeImage,
  isQuietRow,
  nameClasses,
  parseRowLook,
  readRowLook,
  rowLookProblemText,
  rowLookVars,
  saveRowLook,
} from './rowLook.js';

afterEach(() => window.localStorage.clear());

describe('the defaults are the look the page had before the settings existed', () => {
  it('red, orange and theme-blue backgrounds; a gold outline and a gold gradient strong on the left; a plain name for every agent', () => {
    expect(DEFAULT_ROW_LOOK).toEqual({ needs: 'red', flag: 'orange', unread: 'accent', focusBg: 'gradient', focusBar: false, focusOutline: true, focusColor: 'gold', gradientColor: 'gold', boldActive: false, dimIdle: false });
  });

  it('the default variables are the ones of styles/agents.css (the gold of the open row: 30 % fading to 2 %)', () => {
    const vars = rowLookVars(DEFAULT_ROW_LOOK);
    expect(vars['--am-herdr-active-edge']).toBe('#d4a017');
    expect(vars['--am-herdr-active-bg']).toBe('linear-gradient(90deg, color-mix(in srgb, #d4a017 30%, transparent), color-mix(in srgb, #d4a017 2%, transparent))');
    expect(vars['--am-herdr-needs-bg']).toBe('color-mix(in srgb, var(--color-hue-red-text, #b91c1c) 20%, transparent)');
    expect(vars['--am-herdr-unseen-bg']).toBe('color-mix(in srgb, var(--color-primary, #2563eb) 12%, transparent)');
    expect(vars['--am-herdr-flag-bg']).toBe('var(--color-hue-orange-bg)');
  });
});

describe('parseRowLook: a schema with an explicit error, never a silent fallback', () => {
  it('nothing stored is the defaults and no problem', () => {
    expect(parseRowLook(null)).toEqual({ look: DEFAULT_ROW_LOOK, problems: [] });
  });

  it('keeps every valid value, the Herdr key names included', () => {
    const stored = { needs: 'off', flag: 'purple', unread: 'cyan', focusBg: 'gradient-rtl', focusBar: true, focusOutline: false, focusColor: 'accent', gradientColor: 'green', boldActive: true, dimIdle: true };
    expect(parseRowLook(JSON.stringify(stored))).toEqual({ look: stored, problems: [] });
  });

  it('a missing key is its default without a problem (a look saved before a setting existed)', () => {
    expect(parseRowLook(JSON.stringify({ boldActive: true }))).toEqual({ look: { ...DEFAULT_ROW_LOOK, boldActive: true }, problems: [] });
  });

  it('an invalid value takes its default AND is reported with the key, the value and what was expected; the valid ones are kept', () => {
    const { look, problems } = parseRowLook(JSON.stringify({ needs: 'magenta', flag: 'off', boldActive: 'yes', focusBg: 3 }));
    expect(look).toEqual({ ...DEFAULT_ROW_LOOK, flag: 'off' });
    expect(problems).toHaveLength(3);
    expect(problems.join('|')).toContain('"needs" is "magenta", expected one of red');
    expect(problems.join('|')).toContain('"boldActive" is "yes", expected true or false');
    expect(problems.join('|')).toContain('"focusBg" is 3');
  });

  it('an unknown key, a text that is not JSON and a value that is not an object are reported', () => {
    expect(parseRowLook(JSON.stringify({ rowLayout: 'x' })).problems).toEqual(['"rowLayout" is not a row look setting']);
    expect(parseRowLook('{nope').problems[0]).toMatch(/not JSON/);
    expect(parseRowLook('[1]').problems).toEqual(['the stored value is not an object']);
    expect(parseRowLook('null').look).toEqual(DEFAULT_ROW_LOOK);
  });

  it('the notice text names the storage key and the way out', () => {
    const text = rowLookProblemText(['"needs" is "x", expected one of red']);
    expect(text).toContain(ROW_LOOK_STORAGE_KEY);
    expect(text).toContain('Reset');
  });
});

describe('persistence', () => {
  it('saves and reads back the same look', () => {
    const look = { ...DEFAULT_ROW_LOOK, needs: 'off' as const, boldActive: true, focusBg: 'fill' as const };
    expect(saveRowLook(look)).toBeUndefined();
    expect(JSON.parse(window.localStorage.getItem(ROW_LOOK_STORAGE_KEY) ?? 'null')).toEqual(look);
    expect(readRowLook()).toEqual({ look, problems: [] });
  });

  it('a stored invalid look is read with its problems (the page shows them)', () => {
    window.localStorage.setItem(ROW_LOOK_STORAGE_KEY, JSON.stringify({ dimIdle: 'maybe' }));
    const read = readRowLook();
    expect(read.look).toEqual(DEFAULT_ROW_LOOK);
    expect(read.problems).toHaveLength(1);
  });

  it('a storage that refuses is said, with what to do (no silent loss)', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    try {
      expect(saveRowLook(DEFAULT_ROW_LOOK)).toMatch(/could not be saved \(quota\).*Allow site data/);
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe('the variables and classes', () => {
  it('an "off" state has no variable (its class is not applied either)', () => {
    const vars = rowLookVars({ ...DEFAULT_ROW_LOOK, needs: 'off' });
    expect(vars['--am-herdr-needs-bg']).toBeUndefined();
    expect(vars['--am-herdr-flag-bg']).toBeDefined();
  });

  it('the outline off makes the edge transparent; the bar is a 3 px hard stop under the gradient; none with no bar is no image', () => {
    expect(rowLookVars({ ...DEFAULT_ROW_LOOK, focusOutline: false })['--am-herdr-active-edge']).toBe('transparent');
    const bar = activeImage({ ...DEFAULT_ROW_LOOK, focusBar: true });
    expect(bar.startsWith('linear-gradient(90deg, #d4a017 0, #d4a017 3px, transparent 3px), linear-gradient(90deg, color-mix')).toBe(true);
    expect(activeImage({ ...DEFAULT_ROW_LOOK, focusBg: 'none' })).toBe('none');
    expect(activeImage({ ...DEFAULT_ROW_LOOK, focusBg: 'none', focusBar: true })).toBe('linear-gradient(90deg, #d4a017 0, #d4a017 3px, transparent 3px)');
  });

  it('each background draws differently: fill is flat, the two gradients run opposite ways, the gradient color is its own', () => {
    const images = ACTIVE_BACKGROUNDS.map((focusBg) => activeImage({ ...DEFAULT_ROW_LOOK, focusBg, gradientColor: 'green' }));
    expect(new Set(images).size).toBe(ACTIVE_BACKGROUNDS.length);
    expect(images[2]).toContain('90deg');
    expect(images[3]).toContain('270deg');
    expect(images[2]).toContain('--color-hue-green-text');
    expect(images[1]).toContain('#d4a017');
  });

  it('every palette entry gives a variable', () => {
    for (const hue of STATE_HUES) {
      expect(rowLookVars({ ...DEFAULT_ROW_LOOK, needs: hue })['--am-herdr-needs-bg']).toMatch(/var\(--color-/);
    }
    for (const color of HIGHLIGHT_COLORS) {
      expect(rowLookVars({ ...DEFAULT_ROW_LOOK, focusColor: color })['--am-herdr-active-edge']).not.toBe('transparent');
    }
  });

  it('nameClasses: bold and dim only when the setting is on, and only for the open row (bold) or the quiet one (dim)', () => {
    const on = { ...DEFAULT_ROW_LOOK, boldActive: true, dimIdle: true };
    expect(nameClasses(DEFAULT_ROW_LOOK, true, true, 'regular')).toBe('font-normal text-content');
    expect(nameClasses(on, true, false, 'regular')).toBe('font-semibold text-content');
    expect(nameClasses(on, false, true, 'regular')).toBe('font-normal text-muted-tint');
    expect(nameClasses(DEFAULT_ROW_LOOK, false, false, 'strong')).toBe('font-semibold text-content');
    expect(nameClasses(on, true, false, 'strong')).toBe('font-bold text-content');
  });

  it('isQuietRow: idle, not open, not unread', () => {
    expect(isQuietRow({ state: 'idle', unread: false }, false)).toBe(true);
    expect(isQuietRow({ state: 'idle', unread: false }, true)).toBe(false);
    expect(isQuietRow({ state: 'idle', unread: true }, false)).toBe(false);
    expect(isQuietRow({ state: 'working', unread: false }, false)).toBe(false);
  });
});
