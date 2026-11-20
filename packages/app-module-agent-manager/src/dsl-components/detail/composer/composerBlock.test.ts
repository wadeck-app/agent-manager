import { describe, expect, it } from 'vitest';
import { composerBlock } from './composerBlock.js';
import { needsPolling } from './deliveryItems.js';
import { statusFixture } from './fixtures.js';

describe('composerBlock', () => {
  it('lets a living session with an available transport send', () => {
    expect(composerBlock({ alive: true, loading: false, status: statusFixture() })).toBeUndefined();
  });
  it('says why a dead session cannot receive', () => {
    expect(composerBlock({ alive: false, loading: false, status: statusFixture() })?.text).toMatch(/has ended/);
    expect(composerBlock({ alive: true, loading: false, status: statusFixture({ sessionAlive: false }) })?.text).toMatch(/has ended/);
  });
  it('shows the reason and the fix of an unavailable transport', () => {
    const block = composerBlock({ alive: true, loading: false, status: statusFixture({ transportAvailable: false }) });
    expect(block?.kind).toBe('blocked');
    expect(block?.text).toMatch(/socket transport cannot reach this session: no token file\. create the token file/);
  });
  it('is not an alarm while loading, and explains an unreadable status', () => {
    expect(composerBlock({ alive: true, loading: true })?.kind).toBe('checking');
    expect(composerBlock({ alive: true, loading: false, error: 'HTTP 500' })?.text).toMatch(/could not be read.*HTTP 500/);
  });
});

describe('needsPolling', () => {
  it('polls only for recent messages not seen yet', () => {
    const now = 1_000_000;
    const local = (state: 'sending' | 'seen', sentAt: number) => [{ messageId: 'a', sessionId: 's', text: '', imageCount: 0, sentAt, state }];
    expect(needsPolling([], local('sending', now - 1000), now)).toBe(true);
    expect(needsPolling([], local('seen', now - 1000), now)).toBe(false);
    expect(needsPolling([], local('sending', now - 10 * 60_000), now)).toBe(false);
  });
});

describe('composerBlock: a session launched from agent-manager that ended', () => {
  it('points to Resume instead of "start it again"', () => {
    for (const ownedState of ['interrupted', 'exited']) {
      const block = composerBlock({ alive: false, loading: false, status: statusFixture(), ownedState });
      expect(block?.kind).toBe('blocked');
      expect(block?.text).toMatch(new RegExp(`is ${ownedState}.*Use Resume in the header`));
    }
  });
});
