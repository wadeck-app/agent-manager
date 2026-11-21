import { describe, expect, it } from 'vitest';
import { classifyReadiness, isSubagentRunning, RUNNING_FRESH_MS, SETTLE_MS } from './readiness.js';
import type { ReadinessInput } from './readiness.js';
import type { InFlightFacts } from './inFlight.js';

/*
 * The adopt readiness rule (research/adopt-host-switch.md, "Readiness for the button"): free / busy / unknown. A signal that cannot be read is `unknown`,
 * never `free`. Every reason names WHAT would be lost.
 */

const NOW = 1_000_000_000;
const QUIET: InFlightFacts = { openCalls: [], backgroundOpen: [], queuedMessages: 0, coversLastTurn: true, reachedStart: true };

/** An input where everything is read and nothing runs. */
function free(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    now: NOW,
    turn: { status: 'idle', ageMs: SETTLE_MS + 5000, alive: true },
    transcript: { ok: true, facts: QUIET },
    subagents: { ok: true, infos: [] },
    ...overrides,
  };
}

const withFacts = (facts: Partial<InFlightFacts>): ReadinessInput => free({ transcript: { ok: true, facts: { ...QUIET, ...facts } } });
const call = (name: string, summary: string, background = false) => ({ id: `t-${name}`, name, summary, background, startedAt: NOW - 60_000 });

describe('free', () => {
  it('is free when everything is read and nothing runs, with no reason', () => {
    expect(classifyReadiness(free())).toEqual({ state: 'free', reasons: [] });
  });

  it('a finished sub-agent, a stopped one and an old idle one do not count', () => {
    const infos = [
      { agentId: 'a1', finished: true, stoppedByUser: false, lastWriteAt: NOW - 1000 },
      { agentId: 'a2', finished: false, stoppedByUser: true, lastWriteAt: NOW - 1000 },
      { agentId: 'a3', finished: false, stoppedByUser: false, lastWriteAt: NOW - RUNNING_FRESH_MS - 1 },
    ];
    expect(classifyReadiness(free({ subagents: { ok: true, infos } })).state).toBe('free');
  });

  it('an hc terminal that is idle or done is quiet', () => {
    expect(classifyReadiness(free({ hcTerminal: { found: true, state: 'done' } })).state).toBe('free');
    expect(classifyReadiness(free({ hcTerminal: { found: true, state: 'idle' } })).state).toBe('free');
  });
});

describe('busy: one reason per thing that would be lost', () => {
  it('a running turn (registry busy)', () => {
    const readiness = classifyReadiness(free({ turn: { status: 'busy', ageMs: 10_000, alive: true } }));
    expect(readiness.state).toBe('busy');
    expect(readiness.reasons).toEqual([expect.stringMatching(/turn is running.*partial answer is lost/i)]);
  });

  it('a session waiting on a permission prompt names what it waits on', () => {
    const readiness = classifyReadiness(free({ turn: { status: 'waiting', waitingFor: 'permission prompt', ageMs: 9000, alive: true } }));
    expect(readiness.state).toBe('busy');
    expect(readiness.reasons[0]).toMatch(/permission prompt.*not replayed/i);
  });

  it('an unmatched tool call names the tool and its command, and says its process may live on', () => {
    const readiness = classifyReadiness(withFacts({ openCalls: [call('Bash', 'node wait.mjs')] }));
    expect(readiness.state).toBe('busy');
    expect(readiness.reasons).toEqual([expect.stringContaining('Bash')]);
    expect(readiness.reasons[0]).toContain('node wait.mjs');
    expect(readiness.reasons[0]).toMatch(/keep running unseen|orphan/i);
  });

  it('a running Agent call is worded as a sub-agent, not as a process', () => {
    const readiness = classifyReadiness(withFacts({ openCalls: [call('Agent', 'research the thing')] }));
    expect(readiness.reasons[0]).toMatch(/sub-agent/i);
  });

  it('a background task without completion: not restored, its result will never reach the conversation', () => {
    const readiness = classifyReadiness(withFacts({ backgroundOpen: [call('Monitor', 'tail -f log', true)] }));
    expect(readiness.state).toBe('busy');
    expect(readiness.reasons[0]).toMatch(/Monitor/);
    expect(readiness.reasons[0]).toMatch(/not restored/i);
  });

  it('queued messages not yet absorbed, counted', () => {
    const readiness = classifyReadiness(withFacts({ queuedMessages: 2 }));
    expect(readiness.state).toBe('busy');
    expect(readiness.reasons[0]).toMatch(/2 queued messages/);
  });

  it('active sub-agents, counted, with the "did not finish" consequence', () => {
    const infos = [
      { agentId: 'a1', finished: false, stoppedByUser: false, lastWriteAt: NOW - 1000 },
      { agentId: 'a2', finished: false, stoppedByUser: false },
    ];
    const readiness = classifyReadiness(free({ subagents: { ok: true, infos } }));
    expect(readiness.state).toBe('busy');
    expect(readiness.reasons[0]).toMatch(/2 sub-agents active.*did not finish/i);
  });

  it('pending permission requests of the X1 child', () => {
    const readiness = classifyReadiness(free({ pendingPermissions: 1 }));
    expect(readiness.state).toBe('busy');
    expect(readiness.reasons[0]).toMatch(/1 permission request.*not replayed/i);
  });

  it('an hc terminal that is working or blocked', () => {
    expect(classifyReadiness(free({ hcTerminal: { found: true, state: 'working' } })).state).toBe('busy');
    const blocked = classifyReadiness(free({ hcTerminal: { found: true, state: 'blocked', kind: 'question' } }));
    expect(blocked.state).toBe('busy');
    expect(blocked.reasons[0]).toMatch(/question/);
  });

  it('a bg session that works or waits', () => {
    expect(classifyReadiness(free({ bg: { state: 'working' } })).state).toBe('busy');
    expect(classifyReadiness(free({ bg: { state: 'blocked', waitingFor: 'input needed' } })).reasons[0]).toMatch(/input needed/);
  });

  it('the same thing seen by two signals is said once (registry busy and terminal working)', () => {
    const readiness = classifyReadiness(free({ turn: { status: 'busy', ageMs: 9000, alive: true }, hcTerminal: { found: true, state: 'working' } }));
    expect(readiness.reasons).toHaveLength(1);
  });

  it('lists every reason when several things run', () => {
    const readiness = classifyReadiness(
      free({
        turn: { status: 'busy', ageMs: 9000, alive: true },
        transcript: { ok: true, facts: { ...QUIET, openCalls: [call('Bash', 'x')], queuedMessages: 1 } },
      }),
    );
    expect(readiness.state).toBe('busy');
    expect(readiness.reasons).toHaveLength(3);
  });
});

describe('unknown: a signal that cannot be read is never free', () => {
  it('no turn signal (no registry entry)', () => {
    const readiness = classifyReadiness(free({ turn: { unavailable: 'no registry entry for this session' } }));
    expect(readiness.state).toBe('unknown');
    expect(readiness.reasons[0]).toMatch(/Cannot tell.*no registry entry.*Treated as busy/i);
  });

  it('the process is not alive', () => {
    expect(classifyReadiness(free({ turn: { status: 'idle', ageMs: 10_000, alive: false } })).state).toBe('unknown');
  });

  it('a registry status this version does not know', () => {
    const readiness = classifyReadiness(free({ turn: { status: 'frobnicating', ageMs: 10_000, alive: true } }));
    expect(readiness.state).toBe('unknown');
    expect(readiness.reasons[0]).toContain('frobnicating');
  });

  it('an idle status that changed less than SETTLE_MS ago is still settling', () => {
    const readiness = classifyReadiness(free({ turn: { status: 'idle', ageMs: SETTLE_MS - 1, alive: true } }));
    expect(readiness.state).toBe('unknown');
    expect(readiness.reasons[0]).toMatch(/settling/i);
  });

  it('an idle status with no age is unknown (the registry gave no time)', () => {
    expect(classifyReadiness(free({ turn: { status: 'idle', alive: true } })).state).toBe('unknown');
  });

  it('an unreadable transcript, with the reason', () => {
    const readiness = classifyReadiness(free({ transcript: { ok: false, reason: 'the file is locked' } }));
    expect(readiness.state).toBe('unknown');
    expect(readiness.reasons[0]).toContain('the file is locked');
  });

  it('a tail window that does not hold the last user message (an older open call could hide)', () => {
    const readiness = classifyReadiness(withFacts({ coversLastTurn: false }));
    expect(readiness.state).toBe('unknown');
    expect(readiness.reasons[0]).toMatch(/last user message/i);
  });

  it('a window that did not reach the start of the file: a background task started before it cannot be seen', () => {
    const readiness = classifyReadiness(withFacts({ reachedStart: false }));
    expect(readiness.state).toBe('unknown');
    expect(readiness.reasons.join(' ')).toContain('older background tasks could not be checked');
  });

  it('sub-agents that cannot be listed', () => {
    expect(classifyReadiness(free({ subagents: { ok: false, reason: 'folder unreadable' } })).state).toBe('unknown');
  });

  it('a sub-agent whose transcript cannot be read is unknown, never just started', () => {
    const infos = [{ agentId: 'a1', finished: false, stoppedByUser: false, readError: 'EACCES' }];
    expect(classifyReadiness(free({ subagents: { ok: true, infos } })).state).toBe('unknown');
  });

  it('an hc session whose terminal was not found', () => {
    const readiness = classifyReadiness(free({ hcTerminal: { found: false, reason: 'no terminal runs pid 12' } }));
    expect(readiness.state).toBe('unknown');
    expect(readiness.reasons[0]).toContain('no terminal runs pid 12');
  });

  it('an hc terminal state this version does not know', () => {
    expect(classifyReadiness(free({ hcTerminal: { found: true, state: 'sparkling' } })).state).toBe('unknown');
    expect(classifyReadiness(free({ hcTerminal: { found: true } })).state).toBe('unknown');
  });

  it('busy wins over unknown, and both reasons are kept', () => {
    const readiness = classifyReadiness(free({ turn: { status: 'busy', ageMs: 9000, alive: true }, transcript: { ok: false, reason: 'locked' } }));
    expect(readiness.state).toBe('busy');
    expect(readiness.reasons).toHaveLength(2);
  });
});

describe('isSubagentRunning (the 10 minute heuristic of the log route)', () => {
  const base = { agentId: 'a', finished: false, stoppedByUser: false };
  it('finished, stopped and stale are not running; fresh and never written are', () => {
    expect(isSubagentRunning({ ...base, finished: true }, NOW)).toBe(false);
    expect(isSubagentRunning({ ...base, stoppedByUser: true }, NOW)).toBe(false);
    expect(isSubagentRunning({ ...base, lastWriteAt: NOW - RUNNING_FRESH_MS - 1 }, NOW)).toBe(false);
    expect(isSubagentRunning({ ...base, lastWriteAt: NOW - 1 }, NOW)).toBe(true);
    expect(isSubagentRunning(base, NOW)).toBe(true);
  });
});
