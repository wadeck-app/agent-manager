import { describe, expect, it } from 'vitest';
import type { GrantDto, SessionBlocksDto } from '../shared.js';
import { overview } from './permissionsFixtures.js';
import { GUARDRAILS_WRITE_ENABLED, GUARDRAILS_WRITE_NEEDS, permissionsOf, sameFolder } from './permissions.js';

const SID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const grant = (id: string, sessionId: string, project: string, overrides: Partial<GrantDto> = {}): GrantDto => ({ id, category: 'rm', mode: 'once', expiresAt: 10_000, remainingMs: 5000, sessionId, sessionName: '', project, rationale: 'because', used: 0, maxUses: 1, ...overrides });
const blocks = (sessionId: string): SessionBlocksDto => ({ sessionId, prefix: sessionId.slice(0, 8), sessionName: '', project: '/w/shop', blocks: [{ category: 'rm', count: 2 }], total: 2, refusedCount: 1, timeoutUntil: null, lastRequestAt: null });
describe('the write switch', () => {
  it('is off, with the reason the tooltips give: no API to list, revoke or grant exists yet', () => {
    expect(GUARDRAILS_WRITE_ENABLED).toBe(false);
    expect(GUARDRAILS_WRITE_NEEDS).toBe('Needs the w-guardrails API (list/revoke/grant): not available yet');
  });
});

describe('sameFolder', () => {
  it('ignores case, the kind of slash and a trailing slash (Windows paths)', () => {
    expect(sameFolder('w\\Shop\\', 'W/shop')).toBe(true);
    expect(sameFolder('w\\shop', 'w\\shop2')).toBe(false);
    expect(sameFolder('', '')).toBe(false);
  });
});

describe('permissionsOf', () => {
  it('splits the grants into this session and the other sessions of its project; the badge counts both', () => {
    const view = permissionsOf(overview([grant('1', SID, '/w/shop'), grant('2', OTHER, '/W/shop'), grant('3', OTHER, '/w/blog')], [blocks(SID)]), SID, '/w/shop');
    expect(view.mine.map((g) => g.id)).toEqual(['1']);
    expect(view.project.map((g) => g.id)).toEqual(['2']);
    expect(view.active).toBe(2);
    expect(view.session?.refusedCount).toBe(1);
  });

  it('the session id matches whatever the case; a session with no grants and no counters has an empty view, not an error', () => {
    const view = permissionsOf(overview([grant('1', SID.toUpperCase(), '/w/other')]), SID, '/w/shop');
    expect(view.mine).toHaveLength(1);
    expect(permissionsOf(overview([]), SID, '/w/shop')).toEqual({ mine: [], project: [], active: 0, session: undefined });
  });
});
