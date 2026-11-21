import { mergeToolCallEntries } from './merge.js';
import type { Entry, ToolCallEntry } from './types.js';

/*
 * What is in flight in the tail of a transcript, for the adopt readiness (#71): calls that have no result, background tasks (Bash with run_in_background,
 * Monitor) that have a result but no completion notice, messages queued and not yet absorbed. Pure: it reads entries, never a file.
 *
 * Measured on 9246 real transcripts (research/adopt-host-switch.md, "Phase 1 measurements"): the balance enqueue - dequeue - remove is 0 in 99.5% of the
 * files (a `dequeue` has no content and no id, so the pairing is a count); a background call is closed by a task notification that names its tool_use id in
 * `<tool-use-id>` and ends with `<status>` completed / failed / killed / stopped (94% of the Bash calls, 81% of the Monitor calls have one; a notification
 * with no status is an event of a task that goes on).
 */

export interface OpenCall {
  /** The tool_use id. */
  id: string;
  name: string;
  /** One line of what it runs (the command, the description). */
  summary: string;
  background: boolean;
  /** Epoch ms of the assistant line that started it, when it has a timestamp. */
  startedAt?: number;
}

export interface InFlightFacts {
  /** Calls with no result in the window (a running tool, a running Agent call, a permission being asked). */
  openCalls: OpenCall[];
  /** Background calls whose result came back but whose completion notice is not in the window. */
  backgroundOpen: OpenCall[];
  /** enqueue - dequeue - remove of the queue-operation lines, never below 0 at any point of the window. */
  queuedMessages: number;
  /** True when the window starts at the first line of the file, or holds a prompt that starts a turn: a call older than the window cannot hide. */
  coversLastTurn: boolean;
  /** True only when the window starts at the first line of the file: a background task started before the window (an older turn) cannot be seen otherwise. */
  reachedStart: boolean;
}

export interface ScanWindow {
  startsAtFileStart: boolean;
}

const FINAL_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed', 'killed', 'stopped']);
const TOOL_USE_ID = /<tool-use-id>([^<\s]+)<\/tool-use-id>/;
const STATUS = /<status>([^<]*)<\/status>/;
const SUMMARY_CHARS = 120;

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > SUMMARY_CHARS ? `${flat.slice(0, SUMMARY_CHARS - 3)}...` : flat;
}

function isBackground(call: ToolCallEntry): boolean {
  return call.name === 'Monitor' || call.input['run_in_background'] === true;
}

/** The tool_use ids closed by a notification found in `text`: a notice with a final status. */
function closedBy(text: string): string | undefined {
  const id = TOOL_USE_ID.exec(text)?.[1];
  const status = STATUS.exec(text)?.[1];
  return id !== undefined && status !== undefined && FINAL_STATUSES.has(status.trim()) ? id : undefined;
}

function toOpen(call: ToolCallEntry, background: boolean): OpenCall {
  return { id: call.id, name: call.name, summary: oneLine(call.inputSummary), background, ...(call.startedAt === undefined ? {} : { startedAt: call.startedAt }) };
}

/** The in-flight facts of the entries of a window (any order of pages: they are merged first). */
export function scanInFlight(entries: readonly Entry[], window: ScanWindow): InFlightFacts {
  const merged = mergeToolCallEntries(entries);
  const closed = new Set<string>();
  let queued = 0;
  let coversLastTurn = window.startsAtFileStart;
  for (const entry of merged) {
    if (entry.kind === 'queue-operation') {
      if (entry.operation === 'enqueue') {
        queued += 1;
      } else if (entry.operation === 'dequeue' || entry.operation === 'remove') {
        queued = Math.max(0, queued - 1);
      }
      if (entry.contentKind === 'task-notification' && entry.contentPreview !== undefined) {
        const id = closedBy(entry.contentPreview);
        if (id !== undefined) {
          closed.add(id);
        }
      }
    } else if (entry.kind === 'user-prompt') {
      if (entry.source === 'task-notification') {
        const id = closedBy(entry.text);
        if (id !== undefined) {
          closed.add(id);
        }
      }
      // A prompt that starts a turn (the person, a peer, a notification): what ran since is inside the window.
      if (entry.source === 'human' || entry.source === 'peer' || entry.source === 'task-notification' || (entry.source === 'other' && !entry.isMeta)) {
        coversLastTurn = true;
      }
    }
  }
  const openCalls: OpenCall[] = [];
  const backgroundOpen: OpenCall[] = [];
  for (const entry of merged) {
    if (entry.kind !== 'tool-call' || entry.orphan === true) {
      continue;
    }
    const background = isBackground(entry);
    if (entry.status === 'running') {
      // No result at all: running, whatever it is. A background call still running is one call, counted once.
      openCalls.push(toOpen(entry, background));
    } else if (background && entry.status === 'ok' && !closed.has(entry.id)) {
      backgroundOpen.push(toOpen(entry, true));
    }
  }
  return { openCalls, backgroundOpen, queuedMessages: queued, coversLastTurn, reachedStart: window.startsAtFileStart };
}
