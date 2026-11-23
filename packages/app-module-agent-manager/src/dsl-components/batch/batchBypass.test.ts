import { describe, expect, it } from 'vitest';
import type { BatchGrantResult, CliGrantDto, RuleCategoryDto } from '../shared.js';
import { commonCategories, grantBlockText, grantConfirmLine, grantSummaryText, groupGrants, retryableGrantIds, revokeConfirmLine, revokeSummaryText, type GrantEntry } from './batchBypass.js';

const rule = (name: string, over: Partial<RuleCategoryDto> = {}): RuleCategoryDto => ({ name, decision: 'deny', source: 'default', bypassable: true, hardcoded: false, ...over });
const result = (sessionId: string, status: BatchGrantResult['status'], code = ''): BatchGrantResult => ({ sessionId, name: sessionId, status, code, text: '' });
const grant = (id: string, category: string): CliGrantDto => ({ id, category, mode: 'once', sessionId: 's', expiresAt: 0, remainingMs: 0, remainingText: '1 min', usesLeft: 1, reason: '', origin: 'ui' });
const entry = (sessionId: string, name: string, id: string, category: string): GrantEntry => ({ sessionId, name, grant: grant(id, category) });

describe('commonCategories', () => {
  it('keeps the categories that a bypass can lift in EVERY folder, in the order of the first', () => {
    const first = [rule('rm'), rule('git-push'), rule('ssh-config', { bypassable: false })];
    const second = [rule('git-push'), rule('rm'), rule('ssh-config', { bypassable: true })];
    const third = [rule('rm', { bypassable: false }), rule('git-push')];
    expect(commonCategories([first, second]).map((item) => item.name)).toEqual(['rm', 'git-push']);
    expect(commonCategories([first, second, third]).map((item) => item.name)).toEqual(['git-push']);
  });
  it('is empty with no list, never every category', () => {
    expect(commonCategories([])).toEqual([]);
  });
});

describe('the grant sentences', () => {
  it('the confirm line names the category, the duration and the number of sessions', () => {
    expect(grantConfirmLine('rm', 'once', 3)).toBe('Allow rm once in 3 sessions');
    expect(grantConfirmLine('git-push', '30m', 1)).toBe('Allow git-push for 30 min in 1 session');
  });
  it('says why the button is off, in order of importance', () => {
    expect(grantBlockText({ count: 0, category: 'rm', reasonProblem: '', loading: false })).toMatch(/Select/);
    expect(grantBlockText({ count: 21, category: 'rm', reasonProblem: '', loading: false })).toMatch(/at most 20.*untick 1/);
    expect(grantBlockText({ count: 2, category: 'rm', reasonProblem: '', loading: true })).toMatch(/Reading the categories/);
    expect(grantBlockText({ count: 2, category: '', reasonProblem: '', loading: false })).toMatch(/category/);
    expect(grantBlockText({ count: 2, category: 'rm', reasonProblem: 'Say why', loading: false })).toBe('Say why');
    expect(grantBlockText({ count: 2, category: 'rm', reasonProblem: '', loading: false })).toBe('');
  });
  it('summarizes the results by status', () => {
    expect(grantSummaryText([result('a', 'granted'), result('b', 'granted'), result('c', 'refused'), result('d', 'not-attempted')])).toBe('2 granted, 1 refused, 1 not attempted');
  });
  it('retries the not-attempted sessions and the ones that failed on the PIN, never a refusal or another failure', () => {
    const results = [result('a', 'granted'), result('b', 'not-attempted', 'pin-expired'), result('c', 'failed', 'pin-expired'), result('d', 'failed', 'plugin-error'), result('e', 'refused', 'not-bypassable')];
    expect(retryableGrantIds(results)).toEqual(['b', 'c']);
  });
});

describe('the revoke list', () => {
  const entries = [entry('s1', 'one', 'aaaaaaa1', 'rm'), entry('s2', 'two', 'aaaaaaa2', 'git-push'), entry('s3', 'three', 'aaaaaaa3', 'rm')];
  it('groups the grants by category, the most numerous first, then by name', () => {
    expect(groupGrants(entries).map((group) => [group.category, group.entries.length])).toEqual([
      ['rm', 2],
      ['git-push', 1],
    ]);
  });
  it('the confirm line counts the bypasses, the categories and the sessions', () => {
    expect(revokeConfirmLine(entries)).toBe('Remove 3 bypasses (rm 2, git-push 1) from 3 sessions');
    expect(revokeConfirmLine([entries[0] as GrantEntry])).toBe('Remove 1 bypass (rm 1) from 1 session');
  });
  it('summarizes the revoke results', () => {
    expect(revokeSummaryText([{ sessionId: 'a', name: 'a', grantId: 'x', category: 'rm', status: 'revoked', code: '', text: '' }, { sessionId: 'b', name: 'b', grantId: 'y', category: '', status: 'failed', code: 'plugin-error', text: '' }])).toBe('1 revoked, 1 failed');
  });
});
