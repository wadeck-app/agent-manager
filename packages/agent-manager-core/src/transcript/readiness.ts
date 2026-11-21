import type { InFlightFacts, OpenCall } from './inFlight.js';

/*
 * The adopt readiness (#71, research/adopt-host-switch.md "Readiness for the button"): can the host of a session be changed now without losing something?
 *   free:    every signal was read and nothing runs.
 *   busy:    something runs that the switch would interrupt, kill, orphan or not restore. One reason per thing, naming WHAT would be lost.
 *   unknown: a signal could not be read. NEVER free: the caller treats it as busy.
 * Pure: the callers read the registry, the transcript, the sub-agents and the terminal, this only decides. The server evaluates it again at the moment of the
 * switch; what a page shows is a hint.
 */

export type ReadinessState = 'free' | 'busy' | 'unknown';

export interface AdoptReadiness {
  state: ReadinessState;
  /** Empty when free. Busy: what would be lost. Unknown: why it cannot be told. Busy reasons come first. */
  reasons: string[];
}

/** An idle status younger than this may still be settling (the registry says idle about 0.7 s after the last line, measured). */
export const SETTLE_MS = 3000;
/** A sub-agent that is not marked finished counts as running (a heuristic) while its transcript was written within this time. Same value as the log route. */
export const RUNNING_FRESH_MS = 10 * 60_000;

/** What the rule needs of a sub-agent (a subset of SubagentInfo). */
export interface SubagentActivity {
  agentId: string;
  finished: boolean;
  stoppedByUser: boolean;
  /** Epoch ms of the last write of its transcript. */
  lastWriteAt?: number;
  readError?: string;
  description?: string;
}

/** True when the sub-agent probably runs: not finished, not stopped by the user, written within RUNNING_FRESH_MS (or no transcript yet). */
export function isSubagentRunning(info: Pick<SubagentActivity, 'finished' | 'stoppedByUser' | 'lastWriteAt'>, now: number): boolean {
  if (info.stoppedByUser || info.finished) {
    return false;
  }
  return info.lastWriteAt === undefined || now - info.lastWriteAt <= RUNNING_FRESH_MS;
}

export interface ReadinessInput {
  now: number;
  /** The turn signal: the registry (or, for a record without one, the daemon) status, or why there is none. */
  turn: { status?: string; waitingFor?: string; ageMs?: number; alive: boolean } | { unavailable: string };
  /** The transcript tail facts, or why they could not be read. */
  transcript: { ok: true; facts: InFlightFacts } | { ok: false; reason: string };
  subagents: { ok: true; infos: readonly SubagentActivity[] } | { ok: false; reason: string };
  /** X1: the permission requests the child waits on. */
  pendingPermissions?: number;
  /** hc: the terminal of the session (`status.state` / `status.kind` of `hc get`), absent when the caller does not read it. */
  hcTerminal?: { found: true; state?: string; kind?: string } | { found: false; reason: string };
  /** bg: what `claude agents --json` says. */
  bg?: { state?: string; waitingFor?: string };
}

const TURN_RUNNING = 'A turn is running: its partial answer is lost (the message stays as an unanswered line)';

const waitingText = (what: string): string => `Waiting on ${what}: it is not replayed after the switch`;

function quote(call: OpenCall): string {
  return call.summary === '' ? call.name : `${call.name} \`${call.summary}\``;
}

function openCallText(call: OpenCall): string {
  if (call.name === 'Agent' || call.name === 'Task') {
    return `A sub-agent call is running (${quote(call)}): it is reported as not finished and its result is lost`;
  }
  return `Tool ${quote(call)} is running: its process may keep running unseen after the stop (orphan), and its result will never reach the conversation`;
}

function backgroundText(call: OpenCall): string {
  return `Background ${quote(call)} has no completion notice: it is not restored by a resume, and its result will never reach the conversation`;
}

const cannotTell = (why: string): string => `Cannot tell whether something is running (${why}). Treated as busy.`;

/** The reasons of the turn signal (registry or daemon status). `busy` and `unknown` are separate lists: busy ones are listed first. */
function turnSignal(input: ReadinessInput, busy: string[], unknown: string[]): void {
  const { turn } = input;
  if ('unavailable' in turn) {
    unknown.push(cannotTell(turn.unavailable));
    return;
  }
  if (!turn.alive) {
    unknown.push(cannotTell('the process of the session is not alive'));
    return;
  }
  switch (turn.status) {
    case 'idle':
      if (turn.ageMs === undefined) {
        unknown.push(cannotTell('the registry gives no time for the last status change'));
      } else if (turn.ageMs < SETTLE_MS) {
        unknown.push(cannotTell(`the session went idle ${Math.round(turn.ageMs / 100) / 10} s ago and is still settling`));
      }
      return;
    case 'busy':
      busy.push(TURN_RUNNING);
      return;
    case 'waiting':
      busy.push(waitingText(turn.waitingFor ?? 'an answer'));
      return;
    case 'shell':
      busy.push('A shell command typed in the session may be running: it is killed with the process');
      return;
    default:
      unknown.push(cannotTell(`the status ${JSON.stringify(turn.status ?? '(none)')} is not one this version knows`));
  }
}

/** The pure rule. Never throws. */
export function classifyReadiness(input: ReadinessInput): AdoptReadiness {
  const busy: string[] = [];
  const unknown: string[] = [];
  turnSignal(input, busy, unknown);

  if (input.pendingPermissions !== undefined && input.pendingPermissions > 0) {
    busy.push(`${input.pendingPermissions} permission request${input.pendingPermissions === 1 ? '' : 's'} wait${input.pendingPermissions === 1 ? 's' : ''} for an answer: not replayed after the switch`);
  }

  if (input.hcTerminal !== undefined) {
    const terminal = input.hcTerminal;
    if (!terminal.found) {
      unknown.push(cannotTell(`the herdr-core terminal was not found: ${terminal.reason}`));
    } else if (terminal.state === 'working') {
      busy.push(TURN_RUNNING);
    } else if (terminal.state === 'blocked') {
      busy.push(waitingText(terminal.kind === undefined ? 'a prompt of the terminal' : `a ${terminal.kind} prompt of the terminal`));
    } else if (terminal.state !== 'idle' && terminal.state !== 'done') {
      unknown.push(cannotTell(`the herdr-core terminal reports ${terminal.state === undefined ? 'no state' : `the state ${JSON.stringify(terminal.state)}`}`));
    }
  }

  if (input.bg !== undefined) {
    if (input.bg.waitingFor !== undefined) {
      busy.push(waitingText(input.bg.waitingFor));
    } else if (input.bg.state === 'working') {
      busy.push(TURN_RUNNING);
    }
  }

  if (!input.transcript.ok) {
    unknown.push(cannotTell(`the transcript cannot be read: ${input.transcript.reason}`));
  } else {
    const { facts } = input.transcript;
    for (const call of facts.openCalls) {
      busy.push(openCallText(call));
    }
    for (const call of facts.backgroundOpen) {
      busy.push(backgroundText(call));
    }
    if (facts.queuedMessages > 0) {
      busy.push(`${facts.queuedMessages} queued message${facts.queuedMessages === 1 ? '' : 's'} not yet absorbed: they stay as unanswered lines`);
    }
    if (!facts.reachedStart) {
      // A background task (run_in_background Bash, Monitor) of an older turn has its call before the window: only the start of the file proves there is none.
      unknown.push(cannotTell('older background tasks could not be checked'));
    }
    if (!facts.coversLastTurn) {
      unknown.push(cannotTell('the part of the transcript that was read does not hold the last user message, so a call started before it cannot be seen'));
    }
  }

  if (!input.subagents.ok) {
    unknown.push(cannotTell(`the sub-agents cannot be listed: ${input.subagents.reason}`));
  } else {
    const unreadable = input.subagents.infos.filter((info) => info.readError !== undefined);
    if (unreadable.length > 0) {
      unknown.push(cannotTell(`the transcript of ${unreadable.length} sub-agent${unreadable.length === 1 ? '' : 's'} cannot be read (${unreadable[0]?.readError ?? ''})`));
    }
    const active = input.subagents.infos.filter((info) => info.readError === undefined && isSubagentRunning(info, input.now));
    if (active.length > 0) {
      busy.push(`${active.length} sub-agent${active.length === 1 ? '' : 's'} active: reported as "did not finish" at the next prompt, and its work is lost`);
    }
  }

  const reasons = [...new Set([...busy, ...unknown])];
  if (busy.length > 0) {
    return { state: 'busy', reasons };
  }
  return unknown.length > 0 ? { state: 'unknown', reasons } : { state: 'free', reasons: [] };
}
