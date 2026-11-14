import type { Entry, ToolCallEntry } from './types.js';

function mergeTwo(a: ToolCallEntry, b: ToolCallEntry): ToolCallEntry {
  // Two entries of the same call: an update (same shape, the later wins), or the two halves of a call split across windows (one is an orphan result).
  if (a.orphan === true && b.orphan !== true) {
    return completeFrom(b, a);
  }
  if (a.orphan !== true && b.orphan === true) {
    return applyOrphanResult(a, b);
  }
  const merged = { ...b };
  if (merged.subagentId === undefined && a.subagentId !== undefined) {
    merged.subagentId = a.subagentId;
  }
  return merged;
}

/**
 * A known call and an orphan result (a result whose call was not in its read window) of the same key: the call completed with every result field
 * (status, finishedAt, preview, bytes, durationMs, ...) when it is still running or unknown; a call that already has its result is kept as is.
 */
export function applyOrphanResult(call: ToolCallEntry, orphan: ToolCallEntry): ToolCallEntry {
  return call.status === 'running' || call.status === 'unknown' ? completeFrom(call, orphan) : call;
}

/** `call` with the result fields of `result`. */
function completeFrom(call: ToolCallEntry, result: ToolCallEntry): ToolCallEntry {
  const merged: ToolCallEntry = {
    ...call,
    ...(result.status !== undefined ? { status: result.status } : {}),
    ...(result.finishedAt !== undefined ? { finishedAt: result.finishedAt } : {}),
    ...(result.resultPreview !== undefined ? { resultPreview: result.resultPreview } : {}),
    ...(result.resultPreviewTruncated !== undefined ? { resultPreviewTruncated: result.resultPreviewTruncated } : {}),
    ...(result.resultBytes !== undefined ? { resultBytes: result.resultBytes } : {}),
    ...(result.resultOffset !== undefined ? { resultOffset: result.resultOffset } : {}),
    ...(result.resultImages !== undefined ? { resultImages: result.resultImages } : {}),
    ...(result.denialKind !== undefined ? { denialKind: result.denialKind } : {}),
    ...(result.agentId !== undefined ? { agentId: result.agentId } : {}),
  };
  if (merged.startedAt !== undefined && merged.finishedAt !== undefined) {
    merged.durationMs = Math.max(0, merged.finishedAt - merged.startedAt);
  }
  return merged;
}

/**
 * Folds the entries that share a key (tool calls: the running entry and its later update, or a call and its orphan result found in another
 * window) into one, at the position of the first. Order and every other entry are kept. Pure: the input entries are not changed.
 */
export function mergeToolCallEntries(entries: readonly Entry[]): Entry[] {
  const out: Entry[] = [];
  const index = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind !== 'tool-call') {
      out.push(entry);
      continue;
    }
    const at = index.get(entry.key);
    if (at === undefined) {
      index.set(entry.key, out.length);
      out.push(entry);
    } else {
      out[at] = mergeTwo(out[at] as ToolCallEntry, entry);
    }
  }
  return out;
}
