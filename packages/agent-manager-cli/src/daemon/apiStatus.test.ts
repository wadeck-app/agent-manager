import { describe, expect, it } from 'vitest';
import { statusOfLaunchError } from './apiServer.js';

describe('HTTP status of the thread error codes', () => {
  it.each([
    ['fork-anchor-not-found', 404],
    ['too-many-threads', 409],
    ['invalid-resume-session-at', 400],
    ['resume-at-without-fork', 400],
    ['invalid-quote', 400],
    ['quote-without-anchor', 400],
    // The daemon could not read a file it needs (permissions, a lock): its own trouble, not the caller's.
    ['fork-anchor-unreadable', 500],
  ])('%s answers %i', (code, status) => {
    expect(statusOfLaunchError(code)).toBe(status);
  });
});
