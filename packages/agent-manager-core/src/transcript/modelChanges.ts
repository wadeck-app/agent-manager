import { describeModel, describeModelName, parseModelId } from './models.js';
import type { Entry, ModelChangeEntry, ModelRef } from './types.js';

/** What the tracker carries from one list of entries to the next (a tail window, then the entries after it). Plain JSON. */
export type ModelTrackerState = {
  /** The model of the last main-session assistant entry seen, with the name Claude Code gave it when a model attachment said so. */
  current?: ModelRef;
  /** `/model` printed a change since the last assistant entry: the next assistant model change is that same change (one notice, not two). */
  commandPending?: boolean;
  /** The model attachments seen before the first message of their model (exact id with the [1m] tag, and name), by canonical id; used once. */
  names: Record<string, { modelId: string; displayName: string }>;
};

export function createModelTrackerState(): ModelTrackerState {
  return { names: {} };
}

/** "Set model to `Haiku 5.5` and saved as your default for new sessions" / "... for this session only" / "... for this session". "Kept model as `X`" is no change. */
const SET_MODEL = /Set model to `([^`]+)`(?: (for this session(?: only)?|and saved as your default for new sessions))?/;

/** Names the model of an entry that holds one: assistant text and usage of the MAIN session (a sub-agent runs its own model), never `<synthetic>`. */
function modelOf(entry: Entry): string | undefined {
  if ((entry.kind !== 'assistant-text' && entry.kind !== 'usage') || entry.ownerAgentId !== undefined) {
    return undefined;
  }
  const model = entry.model;
  return model === undefined || model === '' || model === '<synthetic>' ? undefined : model;
}

function changeText(from: ModelRef | undefined, to: ModelRef): string {
  return from === undefined ? `Model changed to ${to.displayName}` : `Model changed: ${from.displayName} -> ${to.displayName}`;
}

function notice(at: Entry, from: ModelRef | undefined, to: ModelRef, source: ModelChangeEntry['source'], scope?: ModelChangeEntry['scope']): ModelChangeEntry {
  return {
    key: `model-change:${at.offset}`,
    offset: at.offset,
    kind: 'model-change',
    ...(at.timestamp !== undefined ? { timestamp: at.timestamp } : {}),
    ...(from !== undefined ? { from } : {}),
    to,
    source,
    ...(scope !== undefined ? { scope } : {}),
    text: changeText(from, to),
  };
}

/** Where a notice goes: before the first of the entries just before `index` that belong to the same assistant message (its thinking comes first). */
function insertionIndex(out: readonly Entry[], messageId: string | undefined): number {
  let at = out.length;
  if (messageId === undefined) {
    return at;
  }
  while (at > 0) {
    const previous = out[at - 1]!;
    if ((previous.kind === 'thinking' || previous.kind === 'assistant-text') && previous.messageId === messageId) {
      at -= 1;
    } else {
      break;
    }
  }
  return at;
}

/**
 * The entries with a `model-change` notice inserted where the model of the main session changes. Pure: the input is not changed. `state` is the tracker
 * state of the entries before this list (createModelTrackerState() when the list starts the transcript); the returned state continues after it.
 *
 * Two signals: the stdout of `/model` ("Set model to `X`"), and the first assistant entry whose model (compared without region, provider, date, `[1m]`) differs
 * from the previous one. A command notice sits at the command; an assistant notice sits before the message. When a command is seen, the assistant change that
 * follows is the same change: no second notice. The first model of a list with no state is not a change. Sub-agent entries are ignored.
 *
 * A window that starts after the previous model (a page of a long transcript) cannot see a change that happened exactly at its edge: pass the state of the
 * previous window, or accept that the notice is in the neighbouring page.
 */
export function insertModelChanges(entries: readonly Entry[], state: ModelTrackerState = createModelTrackerState()): { entries: Entry[]; state: ModelTrackerState } {
  const next: ModelTrackerState = { ...state, names: { ...state.names } };
  const out: Entry[] = [];
  for (const entry of entries) {
    if (entry.kind === 'model-info') {
      const canonical = parseModelId(entry.modelId).canonical;
      // The attachment names the model Claude Code switched to: the current model gets its exact name and id (the 1M tag lives only here).
      if (next.current?.id !== undefined && parseModelId(next.current.id).canonical === canonical) {
        next.current = describeModel(entry.modelId, entry.displayName);
      } else {
        // Written before the first message of that model (session start, after /model): kept for that message.
        next.names[canonical] = { modelId: entry.modelId, displayName: entry.displayName };
      }
      out.push(entry);
      continue;
    }
    if (entry.kind === 'user-prompt' && entry.harness?.label === 'Command output') {
      const match = SET_MODEL.exec(entry.harness.detail);
      if (match !== null) {
        const to = describeModelName(match[1]!);
        const scope = match[2] === undefined ? undefined : match[2].startsWith('for this session') ? 'session' : 'default';
        out.push(entry);
        // The same name as now (Claude Code prints "Set model" for a re-selection too): nothing changed.
        if (next.current === undefined || next.current.displayName.toLowerCase() !== to.displayName.toLowerCase()) {
          out.push(notice(entry, next.current, to, 'command', scope));
          // Known by name only until the first assistant message of the model gives its id.
          next.current = to;
          next.commandPending = true;
        }
        continue;
      }
    }
    const raw = modelOf(entry);
    if (raw === undefined) {
      out.push(entry);
      continue;
    }
    const canonical = parseModelId(raw).canonical;
    const known = next.current?.id === undefined ? undefined : parseModelId(next.current.id).canonical;
    if (known !== canonical) {
      const named = next.names[canonical];
      const to = named === undefined ? describeModel(raw) : describeModel(named.modelId, named.displayName);
      // A name is used once: a later change to the same model must not inherit it (the 1M variant may differ).
      delete next.names[canonical];
      if (next.current !== undefined && next.commandPending !== true) {
        const messageId = entry.kind === 'assistant-text' || entry.kind === 'usage' ? entry.messageId : undefined;
        const at = insertionIndex(out, messageId);
        // The notice takes the offset of the entry it precedes, so the list stays ordered by offset (the log cursors and cuts rely on it).
        out.splice(at, 0, notice(out[at] ?? entry, next.current, to, 'assistant'));
      }
      next.current = to;
    }
    next.commandPending = false;
    out.push(entry);
  }
  return { entries: out, state: next };
}
