import { beforeEach, describe, expect, it } from 'vitest';
import { actionSummary, dismissNotice, fixOf, guardrailsNotices, isDismissed, readDismissed, registryNotices, workspaceNotices, SUMMARY_MAX } from './notices.js';

const DOWN = '2 owned sessions are listed in C:\\cfg\\owned-sessions.json but the daemon is not running: Stop, Resume and Move are unavailable and they show as plain rows. Fix: run `agent-manager start --detach`';
const DOWN_ONE = '1 owned session is listed in C:\\cfg\\owned-sessions.json but the daemon is not running: Stop, Resume and Move are unavailable and it shows as a plain row. Fix: run `agent-manager start --detach`';

beforeEach(() => window.sessionStorage.clear());

describe('fixOf', () => {
  it('takes the first command between backticks', () => {
    expect(fixOf(DOWN)).toBe('agent-manager start --detach');
  });
  it('is undefined when the text holds no command', () => {
    expect(fixOf('nothing to run here')).toBeUndefined();
  });
});

describe('workspaceNotices', () => {
  const none = { ownedDownText: '', ownedStateErrorText: '', unreadableText: '', guardrailsErrorText: '', userStateError: '' };
  it('is empty when there is nothing to say', () => {
    expect(workspaceNotices(none)).toEqual([]);
  });
  it('says the daemon is off in one short sentence, with the copyable fix and the full text as details', () => {
    const [notice] = workspaceNotices({ ...none, ownedDownText: DOWN });
    expect(notice).toMatchObject({ summary: 'Daemon off: 2 owned sessions unavailable', fix: 'agent-manager start --detach', details: DOWN, tone: 'warning' });
    expect(workspaceNotices({ ...none, ownedDownText: DOWN_ONE })[0]?.summary).toBe('Daemon off: 1 owned session unavailable');
  });
  it('a daemon that runs but fails is not called off', () => {
    const text = '1 owned session is listed in X but the daemon cannot be asked (boom): Stop are unavailable. Fix: restart it';
    expect(workspaceNotices({ ...none, ownedDownText: text })[0]?.summary).toBe('Daemon not answering: 1 owned session unavailable');
  });
  it('every summary stays within the limit and every message keeps its full text', () => {
    const all = workspaceNotices({ ownedDownText: DOWN, ownedStateErrorText: 'x'.repeat(400), unreadableText: '3 registry files could not be read, the sessions in them are not shown: a (b)', guardrailsErrorText: 'g'.repeat(300), userStateError: 'u'.repeat(300) });
    expect(all).toHaveLength(5);
    for (const notice of all) {
      expect(notice.summary.length).toBeLessThanOrEqual(SUMMARY_MAX);
      expect(notice.details.length).toBeGreaterThan(notice.summary.length);
    }
    expect(all.map((notice) => notice.summary)).toContain('3 registry files unreadable');
  });
});

describe('registryNotices and guardrailsNotices', () => {
  it('the table page: the registry error is an error, the unreadable files a warning', () => {
    const items = registryNotices({ errorText: 'The folder C:\\x cannot be read. Fix it.', unreadableText: '1 registry file could not be read, the sessions in them are not shown: a (b)' });
    expect(items.map((item) => [item.tone, item.summary])).toEqual([['error', 'Sessions cannot be listed'], ['warning', '1 registry file unreadable']]);
  });
  it('the guardrails page: one notice per problem, the file in the details', () => {
    const items = guardrailsNotices({ errorText: '', killSwitchError: 'cannot read kill switch', problems: [{ file: '/a/rules.json', message: 'not valid JSON', hint: 'Fix it.' }] });
    expect(items).toHaveLength(2);
    expect(items[1]?.details).toContain('/a/rules.json');
    expect(items[1]?.details).toContain('Fix it.');
    expect(items[1]?.summary.length).toBeLessThanOrEqual(SUMMARY_MAX);
  });
});

describe('dismissal', () => {
  it('is remembered per message text for the browser session and comes back when the text changes', () => {
    const [notice] = workspaceNotices({ ownedDownText: DOWN, ownedStateErrorText: '', unreadableText: '', guardrailsErrorText: '', userStateError: '' });
    expect(isDismissed(notice!, readDismissed())).toBe(false);
    dismissNotice(notice!);
    expect(isDismissed(notice!, readDismissed())).toBe(true);
    expect(isDismissed({ ...notice!, details: DOWN.replace('2 owned', '3 owned') }, readDismissed())).toBe(false);
  });
  it('a storage that throws means nothing is dismissed (the notice stays visible)', () => {
    const real = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('denied');
    };
    try {
      expect(readDismissed()).toEqual([]);
    } finally {
      Storage.prototype.getItem = real;
    }
  });
});

describe('actionSummary', () => {
  it('keeps what failed and drops the long reason', () => {
    expect(actionSummary('Could not pin the session: the state file is not valid JSON')).toBe('Could not pin the session');
    expect(actionSummary('x'.repeat(200)).length).toBeLessThanOrEqual(SUMMARY_MAX);
  });
});
