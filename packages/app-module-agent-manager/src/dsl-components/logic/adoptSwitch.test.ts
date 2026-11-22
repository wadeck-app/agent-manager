import { describe, expect, it } from 'vitest';
import type { AdoptReadinessDto } from '../shared.js';
import { applyOwnedDto } from './owned.js';
import { moveStatusOf, switchViewOf } from './adoptSwitch.js';
import { ownedDto, ownedRow, row } from './fixtures.js';

/** What the button of a session says and how it looks (#71): the readiness is the colour AND the words, never the colour alone. */

const FREE: AdoptReadinessDto = { state: 'free', reasons: [] };

describe('switchViewOf: where the action exists', () => {
  it('a discovered session, a background session and an ended one have none', () => {
    expect(switchViewOf(row())).toBeUndefined();
    expect(switchViewOf(ownedRow({ host: 'bg', ownedState: 'idle' }))).toBeUndefined();
    expect(switchViewOf(ownedRow({ ownedState: 'exited', alive: false }))).toBeUndefined();
    expect(switchViewOf(ownedRow({ ownedState: 'interrupted', alive: false }))).toBeUndefined();
    expect(switchViewOf(ownedRow({ host: 'hc', ownedState: 'unobserved', alive: false }))).toBeUndefined();
  });

  it('a live Web session moves to herdr-core, a live terminal session moves to Web', () => {
    expect(switchViewOf(ownedRow({ adoptReadiness: FREE }))).toMatchObject({ target: 'hc', label: 'Move to Terminal' });
    expect(switchViewOf(ownedRow({ host: 'hc', ownedState: 'unobserved', alive: true, adoptReadiness: FREE }))).toMatchObject({ target: 'stream-json', label: 'Move to Web' });
  });
});

describe('switchViewOf: the readiness is the look and the words', () => {
  it('free: neutral, no confirmation, the title says nothing runs', () => {
    expect(switchViewOf(ownedRow({ adoptReadiness: FREE }))).toMatchObject({ readiness: 'free', tone: 'neutral', needsConfirm: false, reasons: [], title: 'Nothing is running. The conversation moves as is.' });
  });

  it('busy: warning, confirmation, the label counts what is interrupted and the reasons are kept', () => {
    const reasons = ['A turn is running: its partial answer is lost', 'Tool Bash `node wait.mjs` is running: its process may keep running unseen after the stop'];
    const view = switchViewOf(ownedRow({ adoptReadiness: { state: 'busy', reasons } }));
    expect(view).toMatchObject({ readiness: 'busy', tone: 'warning', needsConfirm: true, label: 'Move to Terminal (interrupts 2 running items)', reasons });
    expect(view?.title).toContain('node wait.mjs');
    expect(switchViewOf(ownedRow({ adoptReadiness: { state: 'busy', reasons: ['one thing'] } }))?.label).toBe('Move to Terminal (interrupts 1 running item)');
  });

  it('unknown: warning too (never free), and it says it cannot tell', () => {
    const view = switchViewOf(ownedRow({ host: 'hc', ownedState: 'unobserved', alive: true, adoptReadiness: { state: 'unknown', reasons: ['Cannot tell whether something is running (no transcript yet). Treated as busy.'] } }));
    expect(view).toMatchObject({ readiness: 'unknown', tone: 'warning', needsConfirm: true, label: 'Move to Web (cannot tell what runs)' });
  });

  it('a row with no readiness (an older module) is unknown with a reason, never free', () => {
    const view = switchViewOf({ ...ownedRow(), adoptReadiness: undefined } as never);
    expect(view).toMatchObject({ readiness: 'unknown', tone: 'warning', needsConfirm: true });
    expect(view?.reasons[0]).toMatch(/no readiness/i);
  });
});

describe('applyOwnedDto after a switch', () => {
  it('takes the new host from the daemon and does not keep the old readiness (it is read again at the next refresh)', () => {
    const moved = applyOwnedDto(ownedRow({ adoptReadiness: FREE }), ownedDto({ hostKind: 'hc', state: 'unobserved' }));
    expect(moved.host).toBe('hc');
    expect(moved.adoptReadiness.state).toBe('unknown');
    expect(moved.adoptReadiness.reasons[0]).toMatch(/just moved/i);
  });

  it('leaves the readiness alone when the host did not change (a stop, a resume)', () => {
    const same = applyOwnedDto(ownedRow({ adoptReadiness: FREE }), ownedDto({ state: 'idle' }));
    expect(same.adoptReadiness).toEqual(FREE);
  });
});

describe('switchViewOf: starting a stopped session whose last move failed (#71 recovery)', () => {
  const FAILURE = { at: 1, target: 'hc' as const, reason: 'hc run refused (busy)' };

  it('offers "Start on <target>" for a stopped Web record, amber, with the failure in the title, and no confirmation', () => {
    const view = switchViewOf(ownedRow({ host: 'stream-json', ownedState: 'exited', alive: false, switchFailure: FAILURE }));
    expect(view).toMatchObject({ target: 'hc', label: 'Start on Terminal', tone: 'warning', needsConfirm: false, recovery: true });
    expect(view?.title).toContain('hc run refused (busy)');
  });

  it('offers it for a stopped hc record too (the one that was moved to Web and did not start)', () => {
    const view = switchViewOf(ownedRow({ host: 'hc', ownedState: 'unobserved', alive: false, switchFailure: { ...FAILURE, target: 'stream-json' } }));
    expect(view).toMatchObject({ target: 'stream-json', label: 'Start on Web', recovery: true });
  });

  it('a stopped record with no failure, and a background one, still have no action', () => {
    expect(switchViewOf(ownedRow({ host: 'stream-json', ownedState: 'exited', alive: false }))).toBeUndefined();
    expect(switchViewOf(ownedRow({ host: 'bg', ownedState: 'exited', alive: false, switchFailure: FAILURE }))).toBeUndefined();
  });

  it('applyOwnedDto keeps the failure of the daemon and drops it once the session runs again', () => {
    const stopped = applyOwnedDto(ownedRow({ host: 'stream-json' }), ownedDto({ status: 'exited', state: 'exited', switchFailure: FAILURE }));
    expect(stopped.switchFailure).toEqual(FAILURE);
    const running = applyOwnedDto(stopped, ownedDto({ status: 'live', state: 'idle' }));
    expect(running.switchFailure).toBeUndefined();
  });
});

describe('moveStatusOf: the readiness badge of every session and why moving is unavailable', () => {
  const BUSY: AdoptReadinessDto = { state: 'busy', reasons: ['A turn is running: its partial answer is lost', 'Tool Bash `node wait.mjs` is running'] };

  it('a discovered live session shows its readiness and says moving needs adoption, which is not built yet', () => {
    const status = moveStatusOf(row({ adoptReadiness: FREE }), false);
    expect(status.badge).toMatchObject({ tone: 'free', label: 'Free to move' });
    expect(status.unavailable).toBe('Not launched by agent-manager: moving needs adoption (not built yet)');
    const busy = moveStatusOf(row({ adoptReadiness: BUSY }), false);
    expect(busy.badge).toMatchObject({ tone: 'busy', label: 'Busy: 2 running' });
    expect(busy.badge?.title).toBe(BUSY.reasons.join('\n'));
  });

  it('unknown names what is unknown and keeps the reasons in the tooltip', () => {
    const status = moveStatusOf(row({ adoptReadiness: { state: 'unknown', reasons: ['Cannot tell whether something is running (no transcript yet).'] } }), false);
    expect(status.badge).toMatchObject({ tone: 'unknown', label: 'Unknown: cannot tell what runs' });
    expect(status.badge?.title).toContain('no transcript yet');
  });

  it('a row of an older module without readiness is unknown, never free', () => {
    const old = { ...row(), adoptReadiness: undefined } as unknown as ReturnType<typeof row>;
    expect(moveStatusOf(old, false).badge?.tone).toBe('unknown');
  });

  it('a live Web session shows its badge and, while the daemon is up, no reason (the Move button is there)', () => {
    const status = moveStatusOf(ownedRow({ adoptReadiness: BUSY }), false);
    expect(status.badge?.label).toBe('Busy: 2 running');
    expect(status.unavailable).toBeUndefined();
  });

  it('a live Web session with the daemon down says so with the fix', () => {
    expect(moveStatusOf(ownedRow({ adoptReadiness: FREE }), true).unavailable).toBe('Daemon not running: agent-manager start --detach');
  });

  it('a background session says the supervisor hosts it', () => {
    expect(moveStatusOf(ownedRow({ host: 'bg', ownedState: 'idle', adoptReadiness: FREE }), false).unavailable).toMatch(/Background session.*cannot move/);
  });

  it('an ended session has neither badge nor line (nothing runs, nothing moves)', () => {
    expect(moveStatusOf(row({ alive: false }), false)).toEqual({});
    expect(moveStatusOf(ownedRow({ ownedState: 'exited', alive: false }), false)).toEqual({});
  });
});
