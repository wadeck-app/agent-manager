import { describe, expect, it } from 'vitest';
import { literal, sessionCard } from './cards.js';
import { compareVersions, emptyText, harnessBadges, hiddenDeadText, latestVersion, presentSession, summarize, unreadableText } from './present.js';
import type { Session } from '@wadeck-app/agent-manager-core';

function session(overrides: Partial<Session> = {}): Session {
  return { file: '1.json', pid: 1, sessionId: 's', cwd: '/work/shop', folder: 'shop', status: 'idle', statusGroup: 'idle', alive: true, livenessCheck: 'pid-only', ...overrides };
}

describe('literal', () => {
  it('leaves normal text alone', () => {
    expect(literal('shop-owner')).toBe('shop-owner');
    expect(literal('a $ in the middle')).toBe('a $ in the middle');
  });

  it.each(['$sources.secret', '  $x', '!$a || $b', ' !x'])('puts an invisible character before %j so that the renderer does not evaluate it', (text) => {
    const shown = literal(text);
    expect(shown.endsWith(text)).toBe(true);
    expect(shown.length).toBe(text.length + 1);
    // What the renderer tests (resolveExpressionValue): a `$` at the very start, or a `!` after leading blanks
    expect(shown.startsWith('$')).toBe(false);
    expect(shown.trimStart().startsWith('!')).toBe(false);
  });
});

describe('sessionCard', () => {
  it('shows the name, the status with its semantic variant, the folder, pid, version and the relative status time', () => {
    const card = sessionCard(presentSession(session({ name: 'shop-owner', status: 'waiting', statusGroup: 'other', waitingFor: 'permission prompt', version: '2.1.323', statusUpdatedAt: 42 })));
    const json = JSON.stringify(card);
    expect(json).toContain('"label":"shop-owner"');
    expect(json).toContain('"label":"waiting: permission prompt","variant":"warning"');
    expect(json).toContain('"label":"pid 1"');
    // No latest version is passed here, so this version counts as an older one: orange (the green case is in the harness tests below).
    expect(json).toContain('"label":"Claude Code 2.1.323","variant":"warning"');
    expect(json).toContain('{"$type":"DateText","value":42,"relative":true}');
    expect(json).not.toContain('"dead"');
  });

  it('falls back to the folder when the session has no name, marks a dead session, and has no date line without statusUpdatedAt', () => {
    const json = JSON.stringify(sessionCard(presentSession(session({ alive: false }))));
    expect(json).toContain('"label":"shop"');
    expect(json).toContain('"label":"dead","variant":"danger"');
    expect(json).not.toContain('DateText');
    // No version in the registry: the harness is shown without one, neither green nor orange.
    expect(json).toContain('"label":"Claude Code","variant":"default"');
  });

  it('never lets a session name be evaluated as an expression', () => {
    const json = JSON.stringify(sessionCard(presentSession(session({ name: '$sources.sessions.cards' }))));
    expect(json).not.toContain('"label":"$');
  });
});

describe('harness badge', () => {
  it('marks the most recent version seen green and every older one orange', () => {
    const sessions = [session({ version: '2.1.325' }), session({ version: '2.1.322' }), session({ version: '2.1.321', alive: false }), session({ version: undefined })];
    const latest = latestVersion(sessions);
    const rows = sessions.map((s) => presentSession(s, latest));
    expect(latest).toBe('2.1.325');
    expect(rows.map((r) => [r.harness, r.harnessVariant])).toEqual([
      ['Claude Code 2.1.325', 'success'],
      ['Claude Code 2.1.322', 'warning'],
      ['Claude Code 2.1.321', 'warning'],
      ['Claude Code', 'default'],
    ]);
    expect(harnessBadges(rows)).toEqual({ 'Claude Code 2.1.325': 'success', 'Claude Code 2.1.322': 'warning', 'Claude Code 2.1.321': 'warning', 'Claude Code': 'default' });
  });

  it('compares versions numerically, not as text', () => {
    expect(compareVersions('2.1.325', '2.1.322')).toBeGreaterThan(0);
    expect(compareVersions('2.1.9', '2.1.10')).toBeLessThan(0);
    expect(compareVersions('2.1', '2.1.0')).toBe(0);
    expect(latestVersion([session({ version: '2.1.9' }), session({ version: '2.1.10' })])).toBe('2.1.10');
  });

  it('is not moved by hidden dead sessions: the latest comes from every session of the registry', () => {
    expect(latestVersion([session({ version: '2.1.330', alive: false }), session({ version: '2.1.322' })])).toBe('2.1.330');
  });
});

describe('summarize', () => {
  it('counts the alive sessions by group and the dead ones apart', () => {
    const sessions = [
      session({ pid: 1, statusGroup: 'busy' }),
      session({ pid: 2, statusGroup: 'idle' }),
      session({ pid: 3, statusGroup: 'idle' }),
      session({ pid: 4, statusGroup: 'other' }),
      session({ pid: 5, statusGroup: 'busy', alive: false }),
    ];
    expect(summarize(sessions)).toEqual({ busy: 1, idle: 2, other: 1, alive: 4, dead: 1 });
  });
});

describe('texts', () => {
  it('unreadableText is empty without a problem, and names each file with its reason', () => {
    expect(unreadableText([])).toBe('');
    expect(unreadableText([{ file: '1.json', reason: 'bad' }, { file: '2.json', reason: 'worse' }])).toBe('2 registry files could not be read, the sessions in them are not shown: 1.json (bad); 2.json (worse)');
  });

  it('hiddenDeadText and emptyText are empty when there is nothing to say', () => {
    expect(hiddenDeadText(0)).toBe('');
    expect(hiddenDeadText(2)).toContain('2 dead sessions are hidden');
    expect(emptyText(1, 0)).toBe('');
    expect(emptyText(0, 1)).toBe('No session is alive.');
    expect(emptyText(0, 0)).toContain('No Claude Code session is registered');
  });
});
