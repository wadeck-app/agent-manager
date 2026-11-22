import { describe, expect, it } from 'vitest';
import type { RuleCategoryDto } from '../shared.js';
import { addableCategories, categoryOptions, confirmLine, decisionWords, MODE_CHOICES, modeWords, rationaleProblem, sourceWords } from './grantForm.js';

const rule = (name: string, over: Partial<RuleCategoryDto> = {}): RuleCategoryDto => ({ name, decision: 'deny', source: 'default', bypassable: true, hardcoded: false, ...over });

describe('the Add bypass form', () => {
  it('offers the four modes of the plugin, once first', () => {
    expect(MODE_CHOICES.map((choice) => choice.value)).toEqual(['once', '10m', '30m', '4h']);
    expect(modeWords('once')).toBe('once');
    expect(modeWords('10m')).toBe('10 min');
    expect(modeWords('30m')).toBe('30 min');
    expect(modeWords('4h')).toBe('4 h');
  });

  it('lists only the bypassable categories, in the order of the plugin', () => {
    const rules = [rule('rm'), rule('ssh-config', { bypassable: false, hardcoded: true, source: 'hardcoded' }), rule('git-push', { decision: 'ask', source: 'config' })];
    expect(addableCategories(rules).map((item) => item.name)).toEqual(['rm', 'git-push']);
  });

  it('the select options carry the current decision and the source, in words', () => {
    const options = categoryOptions([rule('rm'), rule('git-push', { decision: 'ask', source: 'config' }), rule('x', { decision: 'allow' })]);
    expect(options).toEqual([
      { value: 'rm', label: 'rm: denied (default)' },
      { value: 'git-push', label: 'git-push: asks (config)' },
      { value: 'x', label: 'x: allowed (default)' },
    ]);
    expect(decisionWords('deny')).toBe('denied');
    expect(sourceWords('hardcoded')).toBe('hardcoded');
  });

  it('a rationale is required, one line of plain text, at most 300 characters; the problem is said in words, empty when fine', () => {
    expect(rationaleProblem('')).toMatch(/Say why/);
    expect(rationaleProblem('   ')).toMatch(/Say why/);
    expect(rationaleProblem('clean the build folder')).toBe('');
    expect(rationaleProblem('x'.repeat(300))).toBe('');
    expect(rationaleProblem('x'.repeat(301))).toBe('The reason has 301 characters, the limit is 300.');
    expect(rationaleProblem('one\ntwo')).toMatch(/one line/);
    expect(rationaleProblem('a\u0007b')).toMatch(/control character/);
  });

  it('the confirm line names the category, the duration, the session and the folder', () => {
    expect(confirmLine('rm', '10m', 'shop-owner', '/w/shop')).toBe('Allow rm for 10 min in shop-owner (/w/shop)');
    expect(confirmLine('rm', 'once', 'shop-owner', '/w/shop')).toBe('Allow rm once in shop-owner (/w/shop)');
    expect(confirmLine('rm', '4h', '', '/w/shop')).toBe('Allow rm for 4 h in this session (/w/shop)');
  });
});
