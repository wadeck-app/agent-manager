import type { OwnedHostKind, SessionRowDto } from '../shared.js';
import { isLiveWeb, isOwned } from './owned.js';

/*
 * The Move button of a session (#71): where it moves, and how it looks. The look is the readiness of the row, and the words say the same (the label counts what
 * is interrupted, the title lists it): the colour is never the only signal. The row's readiness is a hint; the daemon computes it again when the switch is asked.
 */

export type SwitchTarget = Extract<OwnedHostKind, 'stream-json' | 'hc'>;

export interface SwitchView {
  target: SwitchTarget;
  /** What the button says. Busy and unknown say so in the label: "Move to herdr-core (interrupts 2 running items)". */
  label: string;
  /** The tooltip: nothing runs, or every reason on its own line. */
  title: string;
  readiness: 'free' | 'busy' | 'unknown';
  /** neutral: free. warning: something runs or cannot be told (amber, with a warning icon). */
  tone: 'neutral' | 'warning';
  /** Busy and unknown need the user's confirmation (a dialog with the reasons) before anything is sent with force. */
  needsConfirm: boolean;
  reasons: string[];
  /** The session is stopped after a move that failed: the button starts it on the target (no process to interrupt), and the page shows why it failed. */
  recovery?: boolean;
}

const NO_READINESS = 'This page has no readiness for the session (an older module answered the list): the session is treated as busy.';

/** Where the session can move to, and the label of that move; undefined when it cannot move (a discovered, background or ended session). */
function targetOf(session: SessionRowDto): { target: SwitchTarget; base: string } | undefined {
  if (!isOwned(session)) {
    return undefined;
  }
  if (isLiveWeb(session)) {
    return { target: 'hc', base: 'Move to herdr-core' };
  }
  // A terminal the daemon started: its state comes from the registry, so "alive" is the registry's.
  if (session.host === 'hc' && session.alive) {
    return { target: 'stream-json', base: 'Move to Web' };
  }
  return undefined;
}

const TARGET_LABEL: Record<SwitchTarget, string> = { hc: 'herdr-core', 'stream-json': 'Web' };

/** A stopped owned session whose last move failed: nothing runs, so there is nothing to interrupt; the start is the same switch route. */
function recoveryOf(session: SessionRowDto): SwitchView | undefined {
  const failure = session.switchFailure;
  if (failure === undefined || !isOwned(session) || session.alive || (session.host !== 'stream-json' && session.host !== 'hc') || (failure.target !== 'stream-json' && failure.target !== 'hc') || failure.target === session.host) {
    return undefined;
  }
  return {
    target: failure.target,
    label: `Start on ${TARGET_LABEL[failure.target]}`,
    title: `The last move to ${TARGET_LABEL[failure.target]} failed: ${failure.reason}\nNothing runs now: this starts the same conversation there.`,
    readiness: 'free',
    tone: 'warning',
    needsConfirm: false,
    reasons: [],
    recovery: true,
  };
}

export function switchViewOf(session: SessionRowDto): SwitchView | undefined {
  const recovery = recoveryOf(session);
  if (recovery !== undefined) {
    return recovery;
  }
  const where = targetOf(session);
  if (where === undefined) {
    return undefined;
  }
  const readiness = (session as Partial<SessionRowDto>).adoptReadiness ?? { state: 'unknown' as const, reasons: [NO_READINESS] };
  if (readiness.state === 'free') {
    return { target: where.target, label: where.base, title: 'Nothing is running. The conversation moves as is.', readiness: 'free', tone: 'neutral', needsConfirm: false, reasons: [] };
  }
  const count = readiness.reasons.length;
  const label = readiness.state === 'busy' ? `${where.base} (interrupts ${count} running item${count === 1 ? '' : 's'})` : `${where.base} (cannot tell what runs)`;
  return { target: where.target, label, title: readiness.reasons.join('\n'), readiness: readiness.state, tone: 'warning', needsConfirm: true, reasons: readiness.reasons };
}
