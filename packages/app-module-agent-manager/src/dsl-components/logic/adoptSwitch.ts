import type { OwnedHostKind, SessionRowDto } from '../shared.js';
import { isLiveWeb, isOwned } from './owned.js';

/*
 * The hand-over button of a session (#71): the session is taken over by the other host (Web <-> herdr-core terminal), same session id and same conversation, what runs
 * is interrupted. Its words say the readiness (the label counts what is interrupted, the tooltip lists it by kind) and its glyph changes in a part only: no colour is the
 * signal. The row's readiness is a hint; the daemon computes it again when the switch is asked. ("Adopt" stays the word of the deferred import of an external session.)
 */

export type SwitchTarget = Extract<OwnedHostKind, 'stream-json' | 'hc'>;

export interface SwitchView {
  target: SwitchTarget;
  /** What the button says. Busy and unknown say so in the label: "Hand over to Terminal (interrupts 2 running items)". */
  label: string;
  /** The tooltip: nothing runs, or every reason on its own line. */
  title: string;
  readiness: 'free' | 'busy' | 'unknown';
  /** neutral: free. warning: something runs or cannot be told (amber, with a warning icon). */
  tone: 'neutral' | 'warning';
  /** Busy and unknown need the user's confirmation (a dialog with the reasons) before anything is sent with force. */
  needsConfirm: boolean;
  reasons: string[];
  /** The session is stopped after a hand-over that failed: the button starts it on the target (no process to interrupt), and the page shows why it failed. */
  recovery?: boolean;
}

const NO_READINESS = 'This page has no readiness for the session (an older module answered the list): the session is treated as busy.';

/** Where the session can be handed over to, and the label of that action; undefined when it cannot be (a discovered, background or ended session). */
function targetOf(session: SessionRowDto): { target: SwitchTarget; base: string } | undefined {
  if (!isOwned(session)) {
    return undefined;
  }
  if (isLiveWeb(session)) {
    return { target: 'hc', base: 'Hand over to Terminal' };
  }
  // A terminal the daemon started: its state comes from the registry, so "alive" is the registry's.
  if (session.host === 'hc' && session.alive) {
    return { target: 'stream-json', base: 'Hand over to Web' };
  }
  return undefined;
}

const TARGET_LABEL: Record<SwitchTarget, string> = { hc: 'Terminal', 'stream-json': 'Web' };

/** A stopped owned session whose last hand-over failed: nothing runs, so there is nothing to interrupt; the start is the same switch route. */
function recoveryOf(session: SessionRowDto): SwitchView | undefined {
  const failure = session.switchFailure;
  if (failure === undefined || !isOwned(session) || session.alive || (session.host !== 'stream-json' && session.host !== 'hc') || (failure.target !== 'stream-json' && failure.target !== 'hc') || failure.target === session.host) {
    return undefined;
  }
  return {
    target: failure.target,
    label: `Start on ${TARGET_LABEL[failure.target]}`,
    title: `The last hand-over to ${TARGET_LABEL[failure.target]} failed: ${failure.reason}\nNothing runs now: this starts the same conversation there.`,
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
    return { target: where.target, label: where.base, title: 'Nothing is running. The conversation is handed over as it is.', readiness: 'free', tone: 'neutral', needsConfirm: false, reasons: [] };
  }
  const count = readiness.reasons.length;
  const label = readiness.state === 'busy' ? `${where.base} (interrupts ${count} running item${count === 1 ? '' : 's'})` : `${where.base} (cannot tell what runs)`;
  return { target: where.target, label, title: readiness.reasons.join('\n'), readiness: readiness.state, tone: 'warning', needsConfirm: true, reasons: readiness.reasons };
}

export type ReasonKind = 'turn' | 'waiting' | 'subagent' | 'tool' | 'queued' | 'unknown' | 'other';

export interface ReasonGroup {
  kind: ReasonKind;
  title: string;
  /** One line: what the hand-over does to this kind of thing. */
  consequence: string;
  reasons: string[];
}

const KINDS: { kind: ReasonKind; title: string; consequence: string; test: RegExp }[] = [
  { kind: 'waiting', title: 'Waiting for an answer', consequence: 'The question or permission request is not replayed after the hand-over.', test: /^Waiting on |permission request/ },
  { kind: 'turn', title: 'A turn is running', consequence: 'Its partial answer is lost; your message stays as an unanswered line.', test: /^A turn is running|shell command/ },
  { kind: 'subagent', title: 'Sub-agents', consequence: 'They are reported as not finished and their results are lost.', test: /sub-agent/i },
  { kind: 'tool', title: 'Tools and background tasks', consequence: 'Their processes may keep running unseen; their results never reach the conversation.', test: /^Tool |^Background / },
  { kind: 'queued', title: 'Queued messages', consequence: 'They stay as unanswered lines.', test: /queued message/ },
  { kind: 'unknown', title: 'Cannot tell what runs', consequence: 'agent-manager treats the session as busy.', test: /^Cannot tell/ },
];

/** Groups the free-text reasons of a readiness by what they are about (the words are the daemon's: a reason that matches nothing is kept, under "Other"). */
export function groupReasons(reasons: readonly string[]): ReasonGroup[] {
  const groups = new Map<ReasonKind, ReasonGroup>();
  for (const reason of reasons) {
    const known = KINDS.find((entry) => entry.test.test(reason));
    const kind = known?.kind ?? 'other';
    const group = groups.get(kind) ?? { kind, title: known?.title ?? 'Other', consequence: known?.consequence ?? 'See the details below.', reasons: [] };
    group.reasons.push(reason);
    groups.set(kind, group);
  }
  return [...groups.values()];
}

export const MOVE_DAEMON_DOWN = 'Daemon not running: agent-manager start --detach';

/** One short row per kind of thing a hand-over would interrupt (the title of the kind and how many), for a tooltip: the whole reasons are in the confirmation dialog, not in a hover card. */
export function moveTipRows(reasons: readonly string[]): { label: string; value: string }[] {
  return groupReasons(reasons).map((group) => ({ label: group.title, value: String(group.reasons.length) }));
}
