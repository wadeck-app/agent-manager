import { describe, expect, it } from 'vitest';
import { row } from './fixtures.js';
import { filterSessions, fuzzyScore, parseQuery, resolveState } from './fuzzy.js';
import { countByState, flatten, groupSessions } from './grouping.js';
import { firstNonEmptyTab, nextNeedingYou, tabCounts, tabSessions } from './inbox.js';
import { isTypingTarget, navTarget } from './nav.js';
import { orderedSessionIds } from './order.js';
import { agentId, worstState } from './states.js';
import { compactDuration, describeTimeInState, timeInState } from './time.js';
import { buildTree, parentPath, quietFolders } from './tree.js';

describe('groupSessions (decisions 44 and 46)', () => {
  const sessions = [
    row({ folder: 'a-idle-old', state: 'idle', statusUpdatedAt: 100 }),
    row({ folder: 'b-idle-new', state: 'idle', statusUpdatedAt: 900 }),
    row({ folder: 'c-need-new', state: 'needs-you', statusUpdatedAt: 800 }),
    row({ folder: 'd-need-old', state: 'needs-you', statusUpdatedAt: 200 }),
    row({ folder: 'e-done-new', state: 'done', statusUpdatedAt: 700 }),
    row({ folder: 'f-done-old', state: 'done', statusUpdatedAt: 300 }),
    row({ folder: 'g-work-old', state: 'working', statusUpdatedAt: 400 }),
    row({ folder: 'h-work-new', state: 'working', statusUpdatedAt: 600 }),
    row({ folder: 'z-pinned', state: 'working', pinned: true, pinOrder: 0, statusUpdatedAt: 50 }),
    row({ folder: 'y-pinned', state: 'idle', pinned: true, pinOrder: 1, statusUpdatedAt: 60 }),
    row({ folder: 'gone', state: 'ended', alive: false }),
    row({ folder: 'odd', state: 'other', status: 'weird' }),
  ];
  const groups = groupSessions(sessions);

  it('orders the groups Pinned, Needs you, Done, Working, Idle, Other, Ended', () => {
    expect(groups.map((group) => group.id)).toEqual(['pinned', 'needs-you', 'done', 'working', 'idle', 'other', 'ended']);
  });

  it('sorts Needs you and Done oldest first, Working and Idle newest first', () => {
    const folders = (id: string): string[] => groups.find((group) => group.id === id)?.sessions.map((session) => session.folder) ?? [];
    expect(folders('needs-you')).toEqual(['d-need-old', 'c-need-new']);
    expect(folders('done')).toEqual(['f-done-old', 'e-done-new']);
    expect(folders('working')).toEqual(['h-work-new', 'g-work-old']);
    expect(folders('idle')).toEqual(['b-idle-new', 'a-idle-old']);
  });

  it('lists a pinned session once, in Pinned only, in pin order (pinOrder), not by folder or time', () => {
    expect(groups[0]?.sessions.map((session) => session.folder)).toEqual(['z-pinned', 'y-pinned']);
    expect(flatten(groups)).toHaveLength(sessions.length);
    expect(groups.find((group) => group.id === 'working')?.sessions.some((session) => session.pinned)).toBe(false);
  });

  it('drops empty groups and keeps a session without time last', () => {
    const list = groupSessions([row({ state: 'idle', statusUpdatedAt: undefined, folder: 'late' }), row({ state: 'idle', statusUpdatedAt: 5, folder: 'early' })]);
    expect(list).toHaveLength(1);
    expect(list[0]?.sessions.map((session) => session.folder)).toEqual(['early', 'late']);
  });

  it('counts by state, pinned ones under their state', () => {
    expect(countByState(sessions)).toEqual({ 'needs-you': 2, done: 2, working: 3, idle: 3, other: 1, ended: 1 });
  });
});

describe('fuzzy filter', () => {
  const sessions = [
    row({ folder: 'shop', displayName: 'checkout-fix', state: 'working', lastActivity: 'Bash: npm test' }),
    row({ folder: 'billing', displayName: 'billing', state: 'needs-you' }),
    row({ folder: 'docs', displayName: '$sources.x', state: 'idle', cwd: '/work/docs' }),
  ];

  it('scores a subsequence and rejects letters out of order', () => {
    expect(fuzzyScore('shp', 'shop')).toBeGreaterThan(0);
    expect(fuzzyScore('pohs', 'shop')).toBeUndefined();
  });

  it('prefers consecutive letters and word starts', () => {
    expect(fuzzyScore('co', 'checkout')).toBeLessThan(fuzzyScore('ch', 'checkout') ?? 0);
    expect(fuzzyScore('cf', 'checkout-fix') ?? 0).toBeGreaterThan(fuzzyScore('cf', 'xxcxxxfxx') ?? 0);
  });

  it('parses state: and project: filters, negation and free words', () => {
    const query = parseQuery('state:work !project:bill fix');
    expect(query.states).toEqual([{ negate: false, state: 'working' }]);
    expect(query.projects).toEqual([{ negate: true, value: 'bill' }]);
    expect(query.terms).toEqual(['fix']);
    expect(query.problems).toEqual([]);
  });

  it('reports an unknown state and an empty value instead of ignoring them', () => {
    expect(parseQuery('state:zzz').problems[0]).toContain("'zzz' is not a state");
    expect(parseQuery('state:').problems[0]).toContain('needs a value');
    expect(parseQuery('project:').problems[0]).toContain('needs a folder name');
  });

  it('resolves a unique prefix only', () => {
    expect(resolveState('nee')).toBe('needs-you');
    expect(resolveState('id')).toBe('idle');
    expect(resolveState('o')).toBe('other');
    expect(resolveState('')).toBeUndefined();
    expect(resolveState('x')).toBeUndefined();
  });

  it('filters by state, by project, by negation and by free word in the name, the path or the activity', () => {
    expect(filterSessions(sessions, parseQuery('state:needs')).map((session) => session.folder)).toEqual(['billing']);
    expect(filterSessions(sessions, parseQuery('!state:idle')).map((session) => session.folder)).toEqual(['shop', 'billing']);
    expect(filterSessions(sessions, parseQuery('project:sh')).map((session) => session.folder)).toEqual(['shop']);
    expect(filterSessions(sessions, parseQuery('npm')).map((session) => session.folder)).toEqual(['shop']);
    expect(filterSessions(sessions, parseQuery('$src')).map((session) => session.folder)).toEqual(['docs']);
    expect(filterSessions(sessions, parseQuery('qqq'))).toEqual([]);
  });

  it('keeps the list order without free words and ranks with them', () => {
    expect(filterSessions(sessions, parseQuery('')).map((session) => session.folder)).toEqual(['shop', 'billing', 'docs']);
    const ranked = filterSessions([row({ folder: 'x-shop-y', displayName: 'x-shop-y' }), row({ folder: 'shop', displayName: 'shop' })], parseQuery('shop'));
    expect(ranked[0]?.folder).toBe('shop');
  });
});

describe('folder tree', () => {
  const sessions = [
    row({ folder: 'shop', cwd: '/a/shop', state: 'idle' }),
    row({ folder: 'shop', cwd: '/a/shop', state: 'needs-you', statusUpdatedAt: 5 }),
    row({ folder: 'shop', cwd: '/b/shop', state: 'working' }),
    row({ folder: 'docs', cwd: '/a/docs', state: 'done' }),
    row({ folder: 'old', cwd: '/a/old', state: 'idle' }),
  ];
  const nodes = buildTree(sessions);

  it('rolls up the worst child state and orders the folders by urgency', () => {
    expect(nodes.map((node) => `${node.cwd}:${node.rollup}`)).toEqual(['/a/shop:needs-you', '/a/docs:done', '/b/shop:working', '/a/old:idle']);
    expect(nodes[0]?.sessions.map((session) => session.state)).toEqual(['needs-you', 'idle']);
  });

  it('shows the parent path only for folders with the same name', () => {
    expect(nodes.filter((node) => node.disambiguation !== '').map((node) => node.disambiguation).sort()).toEqual(['/a', '/b']);
    expect(nodes.find((node) => node.folder === 'docs')?.disambiguation).toBe('');
  });

  it('lists the folders that do not need you', () => {
    expect(quietFolders(nodes).sort()).toEqual(['/a/old', '/b/shop']);
  });

  it('cuts a path with either separator', () => {
    expect(parentPath('/a/shop')).toBe('/a');
    expect(parentPath('/home/me/shop/')).toBe('/home/me');
    expect(parentPath('shop')).toBe('');
  });

  it('ranks the worst state', () => {
    expect(worstState(['idle', 'working'])).toBe('working');
    expect(worstState(['working', 'needs-you', 'done'])).toBe('needs-you');
    expect(worstState([])).toBeUndefined();
  });
});

describe('inbox', () => {
  const sessions = [
    row({ state: 'needs-you', statusUpdatedAt: 10 }),
    row({ state: 'needs-you', statusUpdatedAt: 20 }),
    row({ state: 'needs-you', statusUpdatedAt: 30 }),
    row({ state: 'done' }),
    row({ state: 'working' }),
    row({ state: 'idle' }),
  ];

  it('counts the tabs and All counts everything', () => {
    expect(tabCounts(sessions)).toEqual({ 'needs-you': 3, done: 1, working: 1, all: 6 });
  });

  it('lists the attention states first in All', () => {
    expect(tabSessions(sessions, 'all').map((session) => session.state)).toEqual(['needs-you', 'needs-you', 'needs-you', 'done', 'working', 'idle']);
    expect(tabSessions(sessions, 'done')).toHaveLength(1);
  });

  it('opens the first non-empty tab', () => {
    expect(firstNonEmptyTab({ 'needs-you': 0, done: 2, working: 1, all: 3 })).toBe('done');
    expect(firstNonEmptyTab({ 'needs-you': 0, done: 0, working: 0, all: 3 })).toBe('all');
  });

  it('finds the next row needing you after a reply, wrapping around, never the replied one', () => {
    const ordered = tabSessions(sessions, 'needs-you');
    const [first, second, third] = ordered;
    expect(nextNeedingYou(ordered, first!.sessionId)?.sessionId).toBe(second!.sessionId);
    expect(nextNeedingYou(ordered, third!.sessionId)?.sessionId).toBe(first!.sessionId);
    expect(nextNeedingYou([first!], first!.sessionId)).toBeUndefined();
    expect(nextNeedingYou(ordered, 'unknown')?.sessionId).toBe(first!.sessionId);
  });
});

describe('keyboard navigation', () => {
  const ids = ['a', 'b', 'c'];

  it('moves with j, k and the arrows, clamped at both ends', () => {
    expect(navTarget('j', ids, 'a')).toBe('b');
    expect(navTarget('ArrowDown', ids, 'c')).toBe('c');
    expect(navTarget('k', ids, 'b')).toBe('a');
    expect(navTarget('ArrowUp', ids, 'a')).toBe('a');
    expect(navTarget('Home', ids, 'c')).toBe('a');
    expect(navTarget('End', ids, 'a')).toBe('c');
  });

  it('starts at the top when nothing (or something no longer listed) is selected', () => {
    expect(navTarget('j', ids, undefined)).toBe('a');
    expect(navTarget('j', ids, 'gone')).toBe('a');
    expect(navTarget('k', ids, undefined)).toBe('a');
  });

  it('ignores other keys and an empty list', () => {
    expect(navTarget('x', ids, 'a')).toBeUndefined();
    expect(navTarget('j', [], undefined)).toBeUndefined();
  });

  it('knows an editable target', () => {
    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('button'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('time in state', () => {
  it('is compact', () => {
    expect(compactDuration(30_000)).toBe('<1m');
    expect(compactDuration(3 * 60_000)).toBe('3m');
    expect(compactDuration(44 * 60_000)).toBe('44m');
    expect(compactDuration(7 * 3_600_000)).toBe('7h');
    expect(compactDuration(50 * 3_600_000)).toBe('2d');
  });

  it('is empty when the time is unknown or in the future by an invalid amount', () => {
    expect(timeInState(undefined, 1000)).toBe('');
    expect(compactDuration(Number.NaN)).toBe('');
    expect(compactDuration(-5)).toBe('');
    expect(describeTimeInState(undefined, 1)).toContain('no time');
    expect(describeTimeInState(0, 125_000)).toBe('In this state for 2 min');
  });
});

describe('orderedSessionIds (the order of the keyboard, from the data)', () => {
  const rows = [
    row({ sessionId: 'aaaaaaaa-0000-0000-0000-000000000001', folder: 'shop', cwd: '/w/shop', state: 'idle' }),
    row({ sessionId: 'bbbbbbbb-0000-0000-0000-000000000002', folder: 'api', cwd: '/w/api', state: 'needs-you' }),
    row({ sessionId: 'cccccccc-0000-0000-0000-000000000003', folder: 'shop', cwd: '/w/shop', state: 'working' }),
  ];
  const options = { tree: { grouping: 'workspace', expansion: 'all' }, groups: { preview: true }, inbox: { autoNext: false }, subagents: { show: false } } as const;

  it('tree by workspace: folder by folder, the most urgent folder first; flat: most urgent first', () => {
    const byFolder = orderedSessionIds('tree', rows, options, null);
    expect(byFolder[0]).toBe(agentId(rows[1]!));
    expect(byFolder).toHaveLength(3);
    const flat = orderedSessionIds('tree', rows, { ...options, tree: { grouping: 'none', expansion: 'all' } }, null);
    expect(flat).toEqual([rows[1], rows[2], rows[0]].map((session) => agentId(session!)));
  });

  it('groups: in the order of the groups; inbox: the rows of the tab (an unknown tab gives the first non-empty one)', () => {
    expect(orderedSessionIds('groups', rows, options, null)).toEqual([rows[1], rows[2], rows[0]].map((session) => agentId(session!)));
    expect(orderedSessionIds('inbox', rows, options, 'working')).toEqual([agentId(rows[2]!)]);
    expect(orderedSessionIds('inbox', rows, options, 'nope')).toEqual([agentId(rows[1]!)]);
    expect(orderedSessionIds('inbox', [rows[0]!], options, 'done')).toEqual([]);
  });
});
